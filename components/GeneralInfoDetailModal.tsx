"use client";

import type { GeneralInfoItem } from "../types/generalInfo";
import {
  getGeneralInfoDisplayMediaItems,
  getGeneralInfoFormattedHtml,
  buildFactCheckReportHtml,
  insertInlineMediaIntoEditor,
  readFilesAsDataUrls,
  htmlToPlainText,
  enhanceInlineImageBlocks,
  bindInlineImageRemoveHandler,
  editorHasInlineImageTrigger,
  removeInlineImageTrigger,
  dedupeImageFiles,
  collectClipboardImageFiles,
  isFullAiVerificationReport,
  hasDisplayableAiReport,
  makeGeneralInfoMediaItem,
  normalizeGeneralInfoMediaItems,
} from "../lib/generalInfoHelpers";
import type { GeneralInfoMediaItem } from "../lib/generalInfoHelpers";
import React from "react";
import { generalInfoCategories } from "../lib/generalInfoMock";

function getAiVerificationReportLabel(factCheckSummary?: string, model?: string) {
  const fromModel = String(model || "").trim();
  if (fromModel) return `AI 검증 보고서(${fromModel})`;

  const text = String(factCheckSummary || "");
  const matched = text.match(/AI 검증 보고서\(([^)]+)\)/i);
  if (matched?.[1]) return `AI 검증 보고서(${matched[1]})`;

  if (isFullAiVerificationReport(text)) {
    return "AI 검증 보고서(Gemini)";
  }

  if (/AI 보고서 \(본문\)/i.test(text) || hasDisplayableAiReport(text)) {
    return "AI 보고서 (본문)";
  }

  return "AI 보고서";
}

function decodeEscapedChars(str: string): string {
  if (typeof str !== "string") return "";
  return str
    .replace(/\\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function parseReportText(text: string) {
  let status = "확인 필요";
  let summary = "";
  let result = text;
  
  let cleaned = (text || "").trim();
  
  // Strip markdown code block wrapper if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  }
  
  // 1. Try standard JSON.parse
  try {
    const parsed = JSON.parse(cleaned);
    return {
      status: parsed.status || "확인 필요",
      summary: parsed.summary || "",
      result: parsed.result || text
    };
  } catch (e) {
    // Continue
  }
  
  // 2. Try JSON.parse with string repair (e.g. escaping raw newlines inside quotes)
  try {
    const repaired = cleaned.replace(/\n/g, "\\n");
    const parsed = JSON.parse(repaired);
    return {
      status: parsed.status || "확인 필요",
      summary: parsed.summary || "",
      result: parsed.result || text
    };
  } catch (e) {
    // Continue
  }
  
  // 3. Fallback: regex extraction
  const statusMatch = cleaned.match(/"status"\s*:\s*"([^"]+)"/);
  if (statusMatch) {
    status = statusMatch[1];
  }
  
  const summaryMatch = cleaned.match(/"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"result"/);
  if (summaryMatch) {
    summary = summaryMatch[1];
  } else {
    const fallbackSummaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]+)"/);
    if (fallbackSummaryMatch) {
      summary = fallbackSummaryMatch[1];
    }
  }
  
  const resultMatch = cleaned.match(/"result"\s*:\s*"([\s\S]*?)"\s*}\s*$/);
  if (resultMatch) {
    result = resultMatch[1];
  } else {
    const fallbackResultMatch = cleaned.match(/"result"\s*:\s*"([\s\S]*?)"/);
    if (fallbackResultMatch) {
      result = fallbackResultMatch[1];
    } else {
      const cutOffResultMatch = cleaned.match(/"result"\s*:\s*"([\s\S]*)$/);
      if (cutOffResultMatch) {
        result = cutOffResultMatch[1];
      }
    }
  }
  
  // Decode escaped characters (\n, \t, etc.)
  status = decodeEscapedChars(status);
  summary = decodeEscapedChars(summary);
  result = decodeEscapedChars(result);
  
  return { status, summary, result };
}

function parseMarkdownSections(markdown: string) {
  const sections: Array<{ title: string; content: string[] }> = [];
  const lines = markdown.split("\n");
  let currentSection: { title: string; content: string[] } | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    
    if (line.startsWith("# ") && !line.includes("##")) {
      // 메인 타이틀 라인은 건너뜀
      continue;
    } else if (line.startsWith("## ")) {
      const title = line.replace("## ", "").trim();
      currentSection = { title, content: [] };
      sections.push(currentSection);
    } else {
      if (currentSection) {
        currentSection.content.push(rawLine);
      } else if (line !== "") {
        currentSection = { title: "개요", content: [rawLine] };
        sections.push(currentSection);
      }
    }
  }
  return sections;
}

function MarkdownViewer({ text }: { text: string }) {
  const lines = text.split("\n");
  let insideList = false;
  let listItems: string[] = [];
  const elements: React.ReactNode[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${key++}`} className="report-ul" style={{ paddingLeft: "20px", margin: "8px 0" }}>
          {listItems.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: formatBold(item) }} style={{ listStyleType: "disc", marginBottom: "4px" }} />
          ))}
        </ul>
      );
      listItems = [];
      insideList = false;
    }
  };

  const formatBold = (str: string) => {
    return str
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (line === "") {
      flushList();
      continue;
    }

    if (line.startsWith("* ") || line.startsWith("- ")) {
      insideList = true;
      listItems.push(line.substring(2));
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      flushList();
      elements.push(
        <p key={key++} className="report-list-item" style={{ margin: "6px 0", lineHeight: "1.6" }} dangerouslySetInnerHTML={{ __html: formatBold(rawLine) }} />
      );
      continue;
    } else {
      flushList();
    }

    if (line.startsWith("# ") && !line.includes("##")) {
      elements.push(<h3 key={key++} className="report-h1" style={{ fontSize: "18px", margin: "14px 0 8px", color: "#bae6fd" }}>{line.replace("# ", "")}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h4 key={key++} className="report-h2" style={{ fontSize: "16px", margin: "12px 0 6px", color: "#38bdf8" }}>{line.replace("## ", "")}</h4>);
    } else if (line.startsWith("### ")) {
      elements.push(<h5 key={key++} className="report-h3" style={{ fontSize: "14px", margin: "10px 0 4px", color: "#7dd3fc" }}>{line.replace("### ", "")}</h5>);
    } else {
      elements.push(
        <p key={key++} className="report-p" style={{ margin: "8px 0", lineHeight: "1.7" }} dangerouslySetInnerHTML={{ __html: formatBold(rawLine) }} />
      );
    }
  }
  flushList();

  return <div className="report-markdown-body" style={{ overflowX: "hidden", wordBreak: "break-all", overflowWrap: "anywhere" }}>{elements}</div>;
}


interface Props {
  item: GeneralInfoItem;
  onClose: () => void;
  onGenerateReport: (item: GeneralInfoItem) => void;
  onDownloadPdfReport: (item: GeneralInfoItem) => void;
  onEdit?: (item: GeneralInfoItem) => void;
  onDelete?: (item: GeneralInfoItem) => void;
  onSavePdf?: (item: GeneralInfoItem) => void;
  onShareReport?: (item: GeneralInfoItem) => void;
  onOpenStorageImage?: (url: string, fileName?: string) => void;
  isGeneratingReport?: boolean;
  isExportingPdf?: boolean;
  needsManualFactCheck?: boolean;
  startInEditMode?: boolean;
  onSaveItemEdit?: (item: GeneralInfoItem) => void | Promise<void>;
  onSaveManualFactCheck?: (
    itemId: number,
    text: string,
    status: GeneralInfoItem["factCheckStatus"],
  ) => void;
}

export default function GeneralInfoDetailModal({
  item,
  onClose,
  onGenerateReport,
  onDownloadPdfReport,
  onEdit,
  onDelete,
  onSavePdf,
  onShareReport,
  onOpenStorageImage,
  isGeneratingReport = false,
  isExportingPdf = false,
  needsManualFactCheck = false,
  startInEditMode = false,
  onSaveItemEdit,
  onSaveManualFactCheck,
}: Props) {
  const [copyFeedback, setCopyFeedback] = React.useState<"text" | "fact" | null>(null);
  const [isEditing, setIsEditing] = React.useState(Boolean(startInEditMode));
  const [editTitle, setEditTitle] = React.useState(item.title || "");
  const [editSummary, setEditSummary] = React.useState(item.summary || "");
  const [editSourceUrl, setEditSourceUrl] = React.useState(item.sourceUrl || "");
  const [editPrimary, setEditPrimary] = React.useState(item.primaryCategory || "");
  const [editSecondary, setEditSecondary] = React.useState(item.secondaryCategory || "");
  const [editThird, setEditThird] = React.useState(item.thirdCategory || "");
  const [editKeywordsText, setEditKeywordsText] = React.useState(
    (item.keywords || []).join(", "),
  );
  const [manualFactStatus, setManualFactStatus] =
    React.useState<GeneralInfoItem["factCheckStatus"]>("확인 필요");
  const [showFactImageInsert, setShowFactImageInsert] = React.useState(false);
  const [factEditorKey, setFactEditorKey] = React.useState(0);
  const [bodyEditorKey, setBodyEditorKey] = React.useState(0);
  const [editMediaItems, setEditMediaItems] = React.useState<GeneralInfoMediaItem[]>(() =>
    getGeneralInfoDisplayMediaItems(item),
  );
  const bodyRichTextRef = React.useRef<HTMLDivElement | null>(null);
  const factRichTextRef = React.useRef<HTMLDivElement | null>(null);
  const factImageFileRef = React.useRef<HTMLInputElement | null>(null);
  const coverImageFileRef = React.useRef<HTMLInputElement | null>(null);
  const factImageInsertLockRef = React.useRef(false);

  const factInitialHtml = React.useMemo(() => {
    const raw = String(item.factCheckSummary || "").trim();
    if (!raw || !hasDisplayableAiReport(raw)) return "";
    // 인라인 이미지가 있는 편집 HTML은 그대로 유지
    if (/<(?:img|video)\b[^>]*\bsrc=/i.test(raw)) {
      return /<\/?[a-z][\s\S]*>/i.test(raw) ? raw : buildFactCheckReportHtml(raw, []);
    }
    if (isFullAiVerificationReport(raw)) return buildFactCheckReportHtml(raw, []);
    // 본문 기반 보고서(HTML)는 그대로 표시
    if (/<\/?[a-z][\s\S]*>/i.test(raw)) return raw;
    return buildFactCheckReportHtml(raw, []);
  }, [item.factCheckSummary]);

  React.useEffect(() => {
    setManualFactStatus(item.factCheckStatus || "확인 필요");
    setFactEditorKey((prev) => prev + 1);
    setShowFactImageInsert(false);
    setEditTitle(item.title || "");
    setEditSummary(item.summary || "");
    setEditSourceUrl(item.sourceUrl || "");
    setEditPrimary(item.primaryCategory || "");
    setEditSecondary(item.secondaryCategory || "");
    setEditThird(item.thirdCategory || "");
    setEditKeywordsText((item.keywords || []).join(", "));
    setEditMediaItems(getGeneralInfoDisplayMediaItems(item));
    setBodyEditorKey((prev) => prev + 1);
    setIsEditing(Boolean(startInEditMode));
  }, [item.id, item.factCheckSummary, item.factCheckStatus, needsManualFactCheck, startInEditMode]);

  React.useEffect(() => {
    if (factRichTextRef.current) {
      factRichTextRef.current.innerHTML = factInitialHtml;
      enhanceInlineImageBlocks(factRichTextRef.current);
      bindInlineImageRemoveHandler(factRichTextRef.current);
    }
  }, [factEditorKey, factInitialHtml]);

  React.useEffect(() => {
    if (!isEditing || !bodyRichTextRef.current) return;
    bodyRichTextRef.current.innerHTML = getGeneralInfoFormattedHtml(item);
    enhanceInlineImageBlocks(bodyRichTextRef.current);
    bindInlineImageRemoveHandler(bodyRichTextRef.current);
  }, [isEditing, bodyEditorKey, item]);

  const factImagePanelRef = React.useRef<HTMLDivElement | null>(null);

  const textEndsWithImageTrigger = React.useCallback((raw: string) => {
    const text = String(raw || "").replace(/\u00a0/g, " ").replace(/\r/g, "");
    const trimmedEnd = text.replace(/[ \t\n]+$/g, "");
    return /[Ss]$/.test(trimmedEnd);
  }, []);

  const removeTrailingImageTrigger = React.useCallback(() => {
    return removeInlineImageTrigger(factRichTextRef.current);
  }, []);

  const checkFactImageTrigger = React.useCallback(() => {
    const editor = factRichTextRef.current;
    const plain = String(editor?.innerText || "");
    const shouldShow =
      editorHasInlineImageTrigger(editor) || textEndsWithImageTrigger(plain);
    setShowFactImageInsert(shouldShow);
    if (shouldShow) {
      requestAnimationFrame(() => {
        factImagePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }, [textEndsWithImageTrigger]);

  const openFactImageInsertPanel = React.useCallback(() => {
    setShowFactImageInsert(true);
    requestAnimationFrame(() => {
      factImagePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  const insertFactPlainText = React.useCallback((text: string) => {
    const editor = factRichTextRef.current;
    if (!editor || !text) return;
    editor.focus();
    const ok = document.execCommand("insertText", false, text);
    if (!ok) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editor.appendChild(document.createTextNode(text));
      }
    }
    checkFactImageTrigger();
  }, [checkFactImageTrigger]);

  const handleFactRichCommand = React.useCallback((command: string, value?: string) => {
    const editor = factRichTextRef.current;
    if (!editor) return;
    editor.focus();
    if (command === "insertText" && value) {
      insertFactPlainText(value);
      return;
    }
    document.execCommand(command, false, value);
    checkFactImageTrigger();
  }, [checkFactImageTrigger, insertFactPlainText]);

  const insertFactImageFiles = React.useCallback((files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    if (factImageInsertLockRef.current) return;
    factImageInsertLockRef.current = true;

    const afterNode = removeTrailingImageTrigger();
    const list = dedupeImageFiles(files instanceof FileList ? Array.from(files) : files);
    const mediaFiles = list.filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || ""),
    );
    if (!mediaFiles.length) {
      factImageInsertLockRef.current = false;
      alert("이미지 파일을 선택해 주세요.");
      return;
    }

    void (async () => {
      try {
        const loaded = await readFilesAsDataUrls(mediaFiles);
        const editor = factRichTextRef.current;
        if (editor) {
          insertInlineMediaIntoEditor(
            editor,
            loaded
              .filter((entry) => entry.dataUrl)
              .map(({ file, dataUrl }) => ({
                src: dataUrl,
                name: file.name,
                type: "image" as const,
              })),
            { afterNode },
          );
        }
      } catch (error) {
        console.error("factcheck inline image insert failed", error);
        alert("이미지를 Fact Check에 넣지 못했습니다.");
      } finally {
        setShowFactImageInsert(false);
        factImageInsertLockRef.current = false;
      }
    })();
  }, [removeTrailingImageTrigger]);

  const handleFactImagePaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const pastedFiles = collectClipboardImageFiles(event.clipboardData);
    if (pastedFiles.length > 0) insertFactImageFiles(pastedFiles);
  }, [insertFactImageFiles]);

  const saveFactCheckFromEditor = React.useCallback(async () => {
    const html = String(factRichTextRef.current?.innerHTML || "").trim();
    if (!html || html === "<br>" || html === "<div><br></div>") {
      alert("Fact Check 내용을 입력해 주세요.");
      return;
    }
    await onSaveManualFactCheck?.(item.id, html, manualFactStatus);
  }, [item.id, manualFactStatus, onSaveManualFactCheck]);

  const beginEditing = React.useCallback(() => {
    setEditMediaItems(getGeneralInfoDisplayMediaItems(item));
    setIsEditing(true);
  }, [item]);

  const cancelEditing = React.useCallback(() => {
    setEditTitle(item.title || "");
    setEditSummary(item.summary || "");
    setEditSourceUrl(item.sourceUrl || "");
    setEditPrimary(item.primaryCategory || "");
    setEditSecondary(item.secondaryCategory || "");
    setEditThird(item.thirdCategory || "");
    setEditKeywordsText((item.keywords || []).join(", "));
    setManualFactStatus(item.factCheckStatus || "확인 필요");
    setEditMediaItems(getGeneralInfoDisplayMediaItems(item));
    setBodyEditorKey((prev) => prev + 1);
    setFactEditorKey((prev) => prev + 1);
    setIsEditing(false);
  }, [item]);

  const addCoverMediaFiles = React.useCallback(async (files: FileList | File[] | null) => {
    const list = files instanceof FileList ? Array.from(files) : Array.isArray(files) ? files : [];
    const imageOrVideo = list.filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (imageOrVideo.length === 0) return;

    const loaded = await readFilesAsDataUrls(imageOrVideo);
    const nextItems = loaded.map(({ file, dataUrl }) =>
      makeGeneralInfoMediaItem(
        file.name || `대표 이미지 ${Date.now()}`,
        file.type.startsWith("video/") ? "video" : "image",
        dataUrl,
      ),
    );
    setEditMediaItems((prev) => [...prev, ...nextItems]);
    setIsEditing(true);
  }, []);

  const handleCoverFileChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      void addCoverMediaFiles(files);
      event.target.value = "";
    },
    [addCoverMediaFiles],
  );

  const handleCoverPaste = React.useCallback(
    (event: React.ClipboardEvent) => {
      const files = collectClipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void addCoverMediaFiles(dedupeImageFiles(files));
    },
    [addCoverMediaFiles],
  );

  const setMediaAsRepresentative = React.useCallback((index: number) => {
    setEditMediaItems((prev) => {
      if (index <= 0 || index >= prev.length) return prev;
      const next = [...prev];
      const [picked] = next.splice(index, 1);
      return [picked, ...next];
    });
  }, []);

  const removeEditMediaItem = React.useCallback((index: number) => {
    setEditMediaItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const saveAllEdits = React.useCallback(async () => {
    const bodyHtml = String(bodyRichTextRef.current?.innerHTML || item.formattedTextHtml || "").trim();
    const bodyText = htmlToPlainText(bodyHtml) || String(item.text || "");
    const factHtml = String(factRichTextRef.current?.innerHTML || "").trim();
    const keywords = editKeywordsText
      .split(/[,，#\n]+/)
      .map((k) => k.trim().replace(/^#+/, ""))
      .filter(Boolean);
    const mediaItems = normalizeGeneralInfoMediaItems({ mediaItems: editMediaItems });
    const mainMedia = mediaItems[0];

    const updated: GeneralInfoItem = {
      ...item,
      title: editTitle.trim() || item.title,
      summary: editSummary.trim(),
      sourceUrl: editSourceUrl.trim() || undefined,
      primaryCategory: editPrimary.trim() || item.primaryCategory,
      secondaryCategory: editSecondary.trim() || item.secondaryCategory,
      thirdCategory: editThird.trim() || item.thirdCategory,
      keywords,
      text: bodyText,
      formattedTextHtml: bodyHtml,
      factCheckStatus: manualFactStatus,
      factCheckSummary: factHtml || item.factCheckSummary,
      mediaItems,
      filePreview: mainMedia?.preview || "",
      fileName: mainMedia?.name || "",
    };

    if (onSaveItemEdit) {
      await onSaveItemEdit(updated);
    } else if (factHtml) {
      onSaveManualFactCheck?.(item.id, factHtml, manualFactStatus);
    }
    setIsEditing(false);
  }, [
    bodyRichTextRef,
    editKeywordsText,
    editMediaItems,
    editPrimary,
    editSecondary,
    editSourceUrl,
    editSummary,
    editThird,
    editTitle,
    item,
    manualFactStatus,
    onSaveItemEdit,
    onSaveManualFactCheck,
  ]);

  const detailBodyRef = React.useRef<HTMLDivElement | null>(null);
  const hasAiReport = hasDisplayableAiReport(String(item?.factCheckSummary || ""));

  React.useEffect(() => {
    if (detailBodyRef.current) {
      detailBodyRef.current.scrollTop = 0;
    }
  }, [item?.id, hasAiReport]);

  if (!item) return null;

  const mediaItems = isEditing ? editMediaItems : getGeneralInfoDisplayMediaItems(item);
  const hasFactContent =
    Boolean(String(factInitialHtml || "").trim()) ||
    hasAiReport ||
    needsManualFactCheck;

  const copyPlainText = async (text: string, kind: "text" | "fact") => {
    const value = String(text || "").trim();
    if (!value) {
      alert(kind === "text" ? "복사할 Text가 없습니다." : "복사할 Fact Check 결과가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(kind);
      window.setTimeout(() => {
        setCopyFeedback((prev) => (prev === kind ? null : prev));
      }, 1800);
    } catch {
      alert("클립보드 복사에 실패했습니다.");
    }
  };

  return (
    <div 
      className="overlay" 
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(2, 6, 23, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
        overflowY: "auto",
      }}
    >
      <div
        className="modalCard generalInfoDetailModal"
        onClick={(event) => event.stopPropagation()}
        style={{
          margin: "auto",
          maxHeight: "90vh",
        }}
      >
        <div className="modalHeader">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span>일반 정보 상세보기{isEditing ? " · 수정" : ""}</span>
            {isEditing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="제목"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 6,
                  boxSizing: "border-box",
                  borderRadius: 10,
                  border: "1px solid rgba(56, 189, 248, 0.45)",
                  background: "#020617",
                  color: "#e2e8f0",
                  padding: "10px 12px",
                  fontSize: 16,
                  fontWeight: 700,
                }}
              />
            ) : (
              <h3>
                {item.confirmed === false && (
                  <span className="generalInfoTempBadge" style={{ marginRight: 8 }}>
                    임시저장
                  </span>
                )}
                {item.title}
              </h3>
            )}
          </div>
          <div className="generalInfoDetailHeaderActions">
            {isEditing ? (
              <>
                <button
                  className="primaryButton smallActionButton"
                  type="button"
                  onClick={() => void saveAllEdits()}
                >
                  변경 저장
                </button>
                <button
                  className="secondaryButton smallActionButton"
                  type="button"
                  onClick={cancelEditing}
                >
                  편집 취소
                </button>
              </>
            ) : (
              <button
                className="primaryButton smallActionButton"
                type="button"
                onClick={beginEditing}
              >
                ✏️ 수정
              </button>
            )}
            <button className="iconButton" type="button" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div
          className="generalInfoDetailBody"
          ref={detailBodyRef}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <section
            className="generalInfoDetailSection generalInfoFactCheckReportSection"
            style={{ order: hasAiReport ? 0 : 6 }}
          >
            <strong className="generalInfoFactCheckReportTitle">
              {needsManualFactCheck
                ? "Fact Check 보고서 (수동 작성)"
                : getAiVerificationReportLabel(item.factCheckSummary)}
            </strong>

            {isGeneratingReport || isExportingPdf ? (
              <div style={{
                marginTop: "8px",
                padding: "14px",
                borderRadius: "10px",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                background: "rgba(14, 165, 233, 0.08)",
                color: "#bae6fd",
                fontSize: "13px",
                fontWeight: 700,
              }}>
                {isGeneratingReport ? "📄 AI 검증 보고서 작성 중…" : "📄 PDF 보고서 생성 중…"}
              </div>
            ) : null}

            {needsManualFactCheck ? (
              <div style={{
                marginTop: "10px",
                padding: "14px 16px",
                borderRadius: "12px",
                border: "1px solid rgba(250, 204, 21, 0.45)",
                background: "rgba(250, 204, 21, 0.1)",
                color: "#fde68a",
                fontSize: "13px",
                lineHeight: 1.6,
                wordBreak: "keep-all",
              }}>
                <strong style={{ display: "block", marginBottom: 6, color: "#facc15" }}>
                  ⚠️ AI 크레딧 소진
                </strong>
                AI 검증 보고서를 작성하지 않습니다. <strong>수동으로 팩트 체크 작성</strong>이 필요합니다.
              </div>
            ) : null}

            <div className="generalInfoFactCheckPanel">
              <div className="generalInfoFactCheckToolbar">
                <span className="miniTag" style={{
                  padding: "5px 10px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 700,
                  background: needsManualFactCheck ? "rgba(250, 204, 21, 0.15)" : "rgba(56, 189, 248, 0.12)",
                  border: needsManualFactCheck ? "1px solid rgba(250, 204, 21, 0.35)" : "1px solid rgba(56, 189, 248, 0.3)",
                  color: needsManualFactCheck ? "#facc15" : "#7dd3fc",
                }}>
                  {needsManualFactCheck ? "팩트체크 작성 필요" : (item.factCheckStatus || "확인 전")}
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                    onClick={openFactImageInsertPanel}
                  >
                    🖼 이미지 추가
                  </button>
                  <button
                    type="button"
                    className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                    onClick={() => {
                      const status = String(item.factCheckStatus || "확인 전").trim();
                      const summary = htmlToPlainText(String(item.factCheckSummary || "").trim())
                        || String(item.factCheckSummary || "").trim();
                      void copyPlainText([`[Fact Check 상태] ${status}`, summary].filter(Boolean).join("\n\n"), "fact");
                    }}
                  >
                    {copyFeedback === "fact" ? "✅ 복사됨" : "📋 전체 복사"}
                  </button>
                </div>
              </div>

              <div
                className="generalInfoRichToolbar"
                aria-label="AI 보고서 서식 도구"
                style={{ marginTop: 8 }}
              >
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("bold")}>B 굵게</button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("underline")}>U 밑줄</button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("removeFormat")}>서식 지우기</button>
                <button type="button" className="generalInfoRichColorDefault" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("foreColor", "#e2e8f0")}>● 기본</button>
                <button type="button" className="generalInfoRichColorRed" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("foreColor", "#f87171")}>● 빨강</button>
                <button type="button" className="generalInfoRichColorYellow" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("foreColor", "#facc15")}>● 노랑</button>
                <button type="button" className="generalInfoRichColorBlue" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("foreColor", "#60a5fa")}>● 파랑</button>
                <button type="button" className="generalInfoRichColorGreen" onMouseDown={(e) => e.preventDefault()} onClick={() => handleFactRichCommand("foreColor", "#4ade80")}>● 초록</button>
              </div>

              <div
                className="generalInfoRichToolbar generalInfoCircledNumberToolbar"
                aria-label="원형 번호 삽입"
                style={{ marginTop: 8 }}
              >
                {["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"].map((mark) => (
                  <button
                    key={mark}
                    type="button"
                    className="generalInfoCircledNumberBtn"
                    title={`${mark} 삽입`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertFactPlainText(mark)}
                  >
                    {mark}
                  </button>
                ))}
              </div>

              <p className="generalInfoFactCheckHint">
                굵게·밑줄·글자색·①~⑩으로 보고서 본문을 편집할 수 있습니다. 문장 끝 S(또는 s) 또는 [이미지 추가]로 사진 삽입.
              </p>

              <label className="generalInfoFactCheckStatusLabel">
                Fact Check 상태
                <select
                  className="generalInfoFactCheckStatusSelect"
                  value={manualFactStatus}
                  onChange={(e) =>
                    setManualFactStatus(e.target.value as GeneralInfoItem["factCheckStatus"])
                  }
                >
                  <option value="확인 필요">확인 필요</option>
                  <option value="확인 완료">확인 완료</option>
                  <option value="오류 가능성">오류 가능성</option>
                  <option value="확인 전">확인 전</option>
                </select>
              </label>

              <div
                key={factEditorKey}
                ref={factRichTextRef}
                className="generalInfoRichTextEditor generalInfoFactCheckEditor"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                tabIndex={0}
                onInput={checkFactImageTrigger}
                onKeyUp={checkFactImageTrigger}
                onBlur={checkFactImageTrigger}
                onCompositionEnd={checkFactImageTrigger}
                data-placeholder="AI 검증 보고서 또는 수동 Fact Check를 작성하세요. 끝에 S(또는 s)를 붙이거나 [이미지 추가]를 누르세요."
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 420,
                  maxHeight: "72vh",
                  overflowY: "auto",
                  boxSizing: "border-box",
                  borderRadius: 14,
                  border: "1px solid rgba(56, 189, 248, 0.55)",
                  background: "#020617",
                  color: "#f1f5f9",
                  padding: "18px 18px",
                  fontSize: 16,
                  lineHeight: 1.85,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              />

              {showFactImageInsert && (
                <div className="generalInfoTextImageInsertPanel" ref={factImagePanelRef}>
                  <div className="generalInfoTextImageInsertHead">
                    <strong>Fact Check 이미지 붙여넣기</strong>
                    <span>S 바로 아래에 이미지가 들어갑니다 · 편집창 아래에 선택 패널이 열립니다</span>
                    <button
                      type="button"
                      className="secondaryButton smallActionButton"
                      onClick={() => {
                        removeTrailingImageTrigger();
                        setShowFactImageInsert(false);
                      }}
                    >
                      닫기
                    </button>
                  </div>
                  <div className="generalInfoTextImageInsertActions">
                    <label className="primaryLabel generalInfoTextImageFileLabel">
                      🖼 사진첩 · 파일 선택
                      <input
                        ref={factImageFileRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          insertFactImageFiles(e.target.files);
                          e.target.value = "";
                        }}
                        style={{ display: "none" }}
                      />
                    </label>
                    <div
                      className="generalInfoTextImagePasteZone"
                      contentEditable
                      suppressContentEditableWarning
                      onPaste={handleFactImagePaste}
                    >
                      📋 여기 눌러 이미지 붙여넣기
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                className="primaryButton"
                onClick={() => void saveFactCheckFromEditor()}
              >
                {needsManualFactCheck ? "수동 Fact Check 저장" : "Fact Check / 보고서 저장"}
              </button>

              {!hasFactContent ? (
                <div style={{
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.7",
                  background: "rgba(15, 23, 42, 0.4)",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid rgba(148, 163, 184, 0.15)",
                  color: "#94a3b8",
                  fontSize: "13px"
                }}>
                  아직 AI 보고서가 없습니다. Confirm 저장 시 Text 본문이 보고서로 들어가며,
                  하단 <strong>[AI 검증 보고서]</strong>로 Gemini 구조화 보고서를 만들 수도 있습니다.
                </div>
              ) : null}
            </div>
          </section>
          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 1 : 0 }}>
            <div className="generalInfoSectionTitleRow">
              <strong>대표 이미지 / 자료</strong>
              {(isEditing || mediaItems.length === 0) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondaryButton smallActionButton"
                    onClick={() => coverImageFileRef.current?.click()}
                  >
                    {mediaItems.length === 0 ? "대표 이미지 추가" : "이미지 추가"}
                  </button>
                  {isEditing && mediaItems.length > 0 && (
                    <button
                      type="button"
                      className="secondaryButton smallActionButton dangerSmallButton"
                      onClick={() => setEditMediaItems([])}
                    >
                      전체 삭제
                    </button>
                  )}
                </div>
              )}
            </div>
            <input
              ref={coverImageFileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={handleCoverFileChange}
            />
            {isEditing && (
              <div
                className="generalInfoIphonePasteZone"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                tabIndex={0}
                onPaste={handleCoverPaste}
                style={{
                  textAlign: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "12px",
                  marginTop: 8,
                  cursor: "pointer",
                  minHeight: 48,
                }}
              >
                <strong>이미지를 여기에 붙여넣기</strong>
              </div>
            )}
            {mediaItems.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "10px" }}>
                {mediaItems.map((media, index) => (
                  <div
                    className="generalInfoDetailMediaCard"
                    key={media.id || index}
                    style={{
                      width: "100%",
                      padding: "12px",
                      border: "1px solid rgba(148, 163, 184, 0.22)",
                      borderRadius: "14px",
                      background: "rgba(15, 23, 42, 0.45)",
                      position: "relative",
                    }}
                  >
                    {isEditing && (
                      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                        {index === 0 ? (
                          <span className="generalInfoDraftMediaBadge representative">★ 대표</span>
                        ) : (
                          <button
                            type="button"
                            className="secondaryButton smallActionButton"
                            onClick={() => setMediaAsRepresentative(index)}
                          >
                            ★ 대표 설정
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondaryButton smallActionButton dangerSmallButton"
                          onClick={() => removeEditMediaItem(index)}
                        >
                          삭제
                        </button>
                      </div>
                    )}
                    {media.type === "video" ? (
                      <video src={media.preview} controls style={{ width: "100%", maxHeight: "500px", objectFit: "contain", borderRadius: "10px", display: "block" }} />
                    ) : (
                      <img
                        src={media.preview}
                        alt={media.name || item.title || `자료 이미지 ${index + 1}`}
                        style={{ width: "100%", maxHeight: "500px", objectFit: "contain", borderRadius: "10px", background: "rgba(2, 6, 23, 0.55)", display: "block", cursor: onOpenStorageImage ? "zoom-in" : "default" }}
                        onClick={() => {
                          if (!onOpenStorageImage) return;
                          onOpenStorageImage(media.preview, media.name || `${item.title || "general_info"}_${index + 1}.jpg`);
                        }}
                      />
                    )}
                    <p className="mutedText" style={{ margin: "8px 0 4px", wordBreak: "break-all" }}>
                      {media.name || `자료 이미지 ${index + 1}`}
                    </p>
                    {media.memo?.trim() && (
                      <div className="generalInfoDetailMediaMemo">
                        <span className="generalInfoDetailMediaMemoIcon">📝</span>
                        <span className="generalInfoDetailMediaMemoText">{media.memo}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ marginTop: 8 }}>
                대표 이미지가 저장되지 않았습니다.
                {!isEditing && " [대표 이미지 추가]로 파일 선택 후 [변경 저장]하세요."}
                {isEditing && " 파일 선택 또는 붙여넣기 후 [변경 저장]하세요."}
              </p>
            )}
            {isEditing && editMediaItems.length > 0 && (
              <p className="mutedText" style={{ marginTop: 8, fontSize: 12 }}>
                맨 앞(★ 대표) 이미지가 대표 이미지입니다. 저장을 눌러야 반영됩니다.
              </p>
            )}
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 2 : 1 }}>
            <strong>요약</strong>
            {isEditing ? (
              <textarea
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                rows={4}
                placeholder="요약을 입력하세요"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 10,
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  background: "#020617",
                  color: "#e2e8f0",
                  padding: "10px 12px",
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: "vertical",
                }}
              />
            ) : (
              <p>{item.summary || "요약 없음"}</p>
            )}
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 3 : 2 }}>
            <div className="generalInfoSectionTitleRow">
              <strong>본문 TEXT</strong>
              {!isEditing && (
                <button
                  type="button"
                  className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                  onClick={() => void copyPlainText(item.text || "", "text")}
                >
                  {copyFeedback === "text" ? "✅ 복사됨" : "📋 전체 복사"}
                </button>
              )}
            </div>
            {isEditing ? (
              <div
                key={bodyEditorKey}
                ref={bodyRichTextRef}
                className="generalInfoRichTextEditor"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                tabIndex={0}
                data-placeholder="본문 TEXT를 수정하세요. 이미지에 ×로 삭제할 수 있습니다."
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 180,
                  maxHeight: 420,
                  overflowY: "auto",
                  boxSizing: "border-box",
                  borderRadius: 14,
                  border: "1px solid rgba(56, 189, 248, 0.45)",
                  background: "#020617",
                  color: "#e2e8f0",
                  padding: "14px 15px",
                  fontSize: 14,
                  lineHeight: 1.75,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              />
            ) : item.text || item.formattedTextHtml ? (
              <div
                className="generalInfoFormattedTextView"
                dangerouslySetInnerHTML={{
                  __html: getGeneralInfoFormattedHtml(item),
                }}
              />
            ) : (
              <pre>본문 TEXT 없음</pre>
            )}
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 4 : 3 }}>
            <strong>분류</strong>
            {isEditing ? (
              <div style={{ display: "grid", gap: 8 }}>
                <select
                  value={editPrimary}
                  onChange={(e) => setEditPrimary(e.target.value)}
                  className="generalInfoFactCheckStatusSelect"
                >
                  <option value="">1차 분류</option>
                  {generalInfoCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <input
                  value={editSecondary}
                  onChange={(e) => setEditSecondary(e.target.value)}
                  placeholder="2차 분류"
                  className="generalInfoFactCheckStatusSelect"
                />
                <input
                  value={editThird}
                  onChange={(e) => setEditThird(e.target.value)}
                  placeholder="3차 분류"
                  className="generalInfoFactCheckStatusSelect"
                />
              </div>
            ) : (
              <p>
                {[item.primaryCategory, item.secondaryCategory, item.thirdCategory].filter(Boolean).join(" > ") || "분류 없음"}
              </p>
            )}
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 5 : 4 }}>
            <strong>키워드</strong>
            {isEditing ? (
              <input
                value={editKeywordsText}
                onChange={(e) => setEditKeywordsText(e.target.value)}
                placeholder="키워드를 쉼표로 구분"
                className="generalInfoFactCheckStatusSelect"
                style={{ width: "100%" }}
              />
            ) : (
              <div className="miniTags">
                {item.keywords.length > 0 ? (
                  item.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)
                ) : (
                  <span>키워드 없음</span>
                )}
              </div>
            )}
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 6 : 5 }}>
            <strong>출처 URL</strong>
            {isEditing ? (
              <input
                value={editSourceUrl}
                onChange={(e) => setEditSourceUrl(e.target.value)}
                placeholder="https://"
                className="generalInfoFactCheckStatusSelect"
                style={{ width: "100%" }}
              />
            ) : item.sourceUrl ? (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  wordBreak: "break-all",
                  overflowWrap: "anywhere",
                  display: "inline-block",
                  maxWidth: "100%",
                }}
              >
                {item.sourceUrl}
              </a>
            ) : (
              <p>출처 URL 없음</p>
            )}
          </section>
        </div>

        <div className="modalFooter">
          {item.factCheckSummary && onShareReport && !isEditing && (
            <button
              className="secondaryButton"
              type="button"
              onClick={() => onShareReport(item)}
            >
              공유하기
            </button>
          )}
          {!isEditing && (
            <button
              className="secondaryButton"
              type="button"
              disabled={isGeneratingReport || isExportingPdf}
              onClick={() => onGenerateReport(item)}
            >
              {isGeneratingReport ? "작성 중…" : "AI 검증 보고서"}
            </button>
          )}
          {!isEditing && (
            <button
              className="secondaryButton"
              type="button"
              disabled={isGeneratingReport || isExportingPdf || !hasDisplayableAiReport(String(item.factCheckSummary || ""))}
              onClick={() => onDownloadPdfReport(item)}
              style={{ borderColor: "rgba(74, 222, 128, 0.45)", color: "#bbf7d0" }}
            >
              {isExportingPdf ? "PDF 생성 중…" : "PDF보고서"}
            </button>
          )}
          {onDelete && !isEditing && (
            <button
              className="secondaryButton"
              style={{ color: "#ef4444" }}
              type="button"
              onClick={() => {
                onDelete(item);
                onClose();
              }}
            >
              삭제
            </button>
          )}
          <button className="secondaryButton" type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
