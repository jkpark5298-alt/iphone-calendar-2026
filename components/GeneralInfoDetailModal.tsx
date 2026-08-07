"use client";

import type { GeneralInfoItem } from "../types/generalInfo";
import {
  getGeneralInfoDisplayMediaItems,
  getGeneralInfoFormattedHtml,
  buildFactCheckReportHtml,
  insertInlineMediaIntoEditor,
  readFilesAsDataUrls,
  htmlToPlainText,
  looksLikeHtmlContent,
  enhanceInlineImageBlocks,
  bindInlineImageRemoveHandler,
  editorHasInlineImageTrigger,
  removeInlineImageTrigger,
} from "../lib/generalInfoHelpers";
import React from "react";

function getAiVerificationReportLabel(factCheckSummary?: string, model?: string) {
  const fromModel = String(model || "").trim();
  if (fromModel) return `AI 검증 보고서(${fromModel})`;

  const text = String(factCheckSummary || "");
  const matched = text.match(/AI 검증 보고서\(([^)]+)\)/i);
  if (matched?.[1]) return `AI 검증 보고서(${matched[1]})`;

  if (text.includes("##") || text.includes("# ")) {
    return "AI 검증 보고서(Gemini)";
  }

  return "Fact Check 및 AI 보고서";
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
  onEdit: (item: GeneralInfoItem) => void;
  onDelete?: (item: GeneralInfoItem) => void;
  onSavePdf?: (item: GeneralInfoItem) => void;
  onShareReport?: (item: GeneralInfoItem) => void;
  onOpenStorageImage?: (url: string, fileName?: string) => void;
  isGeneratingReport?: boolean;
  isExportingPdf?: boolean;
  needsManualFactCheck?: boolean;
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
  onSaveManualFactCheck,
}: Props) {
  const [copyFeedback, setCopyFeedback] = React.useState<"text" | "fact" | null>(null);
  const [manualFactStatus, setManualFactStatus] =
    React.useState<GeneralInfoItem["factCheckStatus"]>("확인 필요");
  const [showFactImageInsert, setShowFactImageInsert] = React.useState(false);
  const [factEditorKey, setFactEditorKey] = React.useState(0);
  const factRichTextRef = React.useRef<HTMLDivElement | null>(null);
  const factImageFileRef = React.useRef<HTMLInputElement | null>(null);

  const factInitialHtml = React.useMemo(() => {
    const raw = String(item.factCheckSummary || "").trim();
    if (!raw) return "";
    if (looksLikeHtmlContent(raw)) return raw;
    const evidenceUrls = getGeneralInfoDisplayMediaItems(item)
      .map((media) => String(media.preview || media.fileUrl || "").trim())
      .filter(Boolean);
    return buildFactCheckReportHtml(raw, evidenceUrls);
  }, [item]);

  React.useEffect(() => {
    setManualFactStatus(item.factCheckStatus || "확인 필요");
    setFactEditorKey((prev) => prev + 1);
    setShowFactImageInsert(false);
  }, [item.id, item.factCheckSummary, item.factCheckStatus, needsManualFactCheck]);

  React.useEffect(() => {
    if (factRichTextRef.current) {
      factRichTextRef.current.innerHTML = factInitialHtml;
      enhanceInlineImageBlocks(factRichTextRef.current);
      bindInlineImageRemoveHandler(factRichTextRef.current);
    }
  }, [factEditorKey, factInitialHtml]);

  const factImagePanelRef = React.useRef<HTMLDivElement | null>(null);

  const textEndsWithImageTrigger = React.useCallback((raw: string) => {
    const text = String(raw || "").replace(/\u00a0/g, " ").replace(/\r/g, "");
    const trimmedEnd = text.replace(/[ \t\n]+$/g, "");
    return /S$/.test(trimmedEnd);
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

  const insertFactImageFiles = React.useCallback((files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const afterNode = removeTrailingImageTrigger();
    const list = files instanceof FileList ? Array.from(files) : files;
    const mediaFiles = list.filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || ""),
    );
    if (!mediaFiles.length) {
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
      }
    })();
  }, [removeTrailingImageTrigger]);

  const handleFactImagePaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const clipboardData = event.clipboardData;
    const pastedFiles: File[] = [];
    if (clipboardData?.files?.length) {
      Array.from(clipboardData.files).forEach((file) => {
        if (file.type.startsWith("image/")) pastedFiles.push(file);
      });
    }
    if (clipboardData?.items) {
      Array.from(clipboardData.items).forEach((item) => {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      });
    }
    if (pastedFiles.length > 0) insertFactImageFiles(pastedFiles);
  }, [insertFactImageFiles]);

  const saveFactCheckFromEditor = React.useCallback(() => {
    const html = String(factRichTextRef.current?.innerHTML || "").trim();
    if (!html || html === "<br>" || html === "<div><br></div>") {
      alert("Fact Check 내용을 입력해 주세요.");
      return;
    }
    onSaveManualFactCheck?.(item.id, html, manualFactStatus);
  }, [item.id, manualFactStatus, onSaveManualFactCheck]);

  const detailBodyRef = React.useRef<HTMLDivElement | null>(null);
  const hasAiReport = Boolean(String(item?.factCheckSummary || "").trim());

  React.useEffect(() => {
    if (detailBodyRef.current) {
      detailBodyRef.current.scrollTop = 0;
    }
  }, [item?.id, hasAiReport]);

  if (!item) return null;

  const mediaItems = getGeneralInfoDisplayMediaItems(item);
  const hasFactContent = Boolean(String(item.factCheckSummary || "").trim()) || needsManualFactCheck;

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
          <div>
            <span>일반 정보 상세보기</span>
            <h3>{item.title}</h3>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <div
          className="generalInfoDetailBody"
          ref={detailBodyRef}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 0 : 6 }}>
            <div className="generalInfoSectionTitleRow">
              <strong>
                {needsManualFactCheck
                  ? "Fact Check (수동 작성)"
                  : getAiVerificationReportLabel(item.factCheckSummary)}
              </strong>
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
              }}>
                <strong style={{ display: "block", marginBottom: 6, color: "#facc15" }}>
                  ⚠️ AI 크레딧 소진
                </strong>
                AI 검증 보고서를 작성하지 않습니다. <strong>수동으로 팩트 체크 작성</strong>이 필요합니다.
              </div>
            ) : null}

            <div style={{ marginTop: "10px", display: "grid", gap: "10px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <span className="miniTag" style={{
                  padding: "4px 8px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  background: needsManualFactCheck ? "rgba(250, 204, 21, 0.15)" : "rgba(56, 189, 248, 0.12)",
                  border: needsManualFactCheck ? "1px solid rgba(250, 204, 21, 0.35)" : "1px solid rgba(56, 189, 248, 0.3)",
                  color: needsManualFactCheck ? "#facc15" : "#7dd3fc",
                }}>
                  {needsManualFactCheck ? "팩트체크 작성 필요" : (item.factCheckStatus || "확인 전")}
                </span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  문자 끝에 S → 이미지 입력 · 보고서/공유에 함께 표시
                </span>
              </div>

              <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#94a3b8" }}>
                Fact Check 상태
                <select
                  value={manualFactStatus}
                  onChange={(e) =>
                    setManualFactStatus(e.target.value as GeneralInfoItem["factCheckStatus"])
                  }
                  style={{
                    minHeight: 40,
                    borderRadius: 10,
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    background: "#0f172a",
                    color: "#e2e8f0",
                    padding: "8px 10px",
                  }}
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
                data-placeholder="AI 검증 보고서 또는 수동 Fact Check를 작성하세요. 끝에 S를 붙이면 이미지를 넣을 수 있습니다."
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 220,
                  maxHeight: 480,
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
                onClick={saveFactCheckFromEditor}
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
                  아직 작성된 AI 검증 보고서가 없습니다. 하단의 [AI 검증 보고서] 버튼을 누르거나, 위 편집창에 직접 작성하세요.
                </div>
              ) : null}
            </div>
          </section>
          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 1 : 0 }}>
            <strong>대표 이미지 / 자료</strong>
            {mediaItems.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "10px" }}>
                {mediaItems.map((media, index) => (
                  <div className="generalInfoDetailMediaCard" key={media.id || index} style={{ width: "100%", padding: "12px", border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: "14px", background: "rgba(15, 23, 42, 0.45)" }}>
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
              <p>대표 이미지가 저장되지 않았습니다.</p>
            )}
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 2 : 1 }}>
            <strong>요약</strong>
            <p>{item.summary || "요약 없음"}</p>
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 3 : 2 }}>
            <div className="generalInfoSectionTitleRow">
              <strong>본문 TEXT</strong>
              <button
                type="button"
                className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                onClick={() => void copyPlainText(item.text || "", "text")}
              >
                {copyFeedback === "text" ? "✅ 복사됨" : "📋 전체 복사"}
              </button>
            </div>
            {item.text || item.formattedTextHtml ? (
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
            <p>
              {[item.primaryCategory, item.secondaryCategory, item.thirdCategory].filter(Boolean).join(" > ") || "분류 없음"}
            </p>
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 5 : 4 }}>
            <strong>키워드</strong>
            <div className="miniTags">
              {item.keywords.length > 0 ? (
                item.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)
              ) : (
                <span>키워드 없음</span>
              )}
            </div>
          </section>

          <section className="generalInfoDetailSection" style={{ order: hasAiReport ? 6 : 5 }}>
            <strong>출처 URL</strong>
            {item.sourceUrl ? (
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
          {item.factCheckSummary && onShareReport && (
            <button
              className="secondaryButton"
              type="button"
              onClick={() => onShareReport(item)}
            >
              공유하기
            </button>
          )}
          <button
            className="secondaryButton"
            type="button"
            disabled={isGeneratingReport || isExportingPdf}
            onClick={() => onGenerateReport(item)}
          >
            {isGeneratingReport ? "작성 중…" : "AI 검증 보고서"}
          </button>
          <button
            className="secondaryButton"
            type="button"
            disabled={isGeneratingReport || isExportingPdf || !item.factCheckSummary}
            onClick={() => onDownloadPdfReport(item)}
            style={{ borderColor: "rgba(74, 222, 128, 0.45)", color: "#bbf7d0" }}
          >
            {isExportingPdf ? "PDF 생성 중…" : "PDF보고서"}
          </button>
          <button
            className="primaryButton"
            type="button"
            onClick={() => onEdit(item)}
          >
            수정
          </button>
          {onDelete && (
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
