"use client";

import type { GeneralInfoItem } from "../types/generalInfo";
import {
  getGeneralInfoDisplayMediaItems,
  getGeneralInfoFormattedHtml,
  htmlToPlainText,
  enhanceInlineImageBlocks,
  bindInlineImageRemoveHandler,
  readFilesAsDataUrls,
  dedupeImageFiles,
  collectClipboardImageFiles,
  hasDisplayableAiReport,
  makeGeneralInfoMediaItem,
  normalizeGeneralInfoMediaItems,
  extractGeneralInfoBodyImageSrcs,
  extractGeneralInfoReportImageSrcs,
  looksLikeHtmlContent,
  editorHasInlineImageTrigger,
  removeInlineImageTrigger,
  insertInlineMediaIntoEditor,
} from "../lib/generalInfoHelpers";
import type { GeneralInfoMediaItem } from "../lib/generalInfoHelpers";
import React from "react";
import { CollectFormatToolbar } from "./CollectFormatToolbar";
import { HandwritingModal } from "./HandwritingModal";
import { TextToImageModal } from "./TextToImageModal";
import { stepCollectFontSize } from "../lib/collectFormatPalette";

interface Props {
  item: GeneralInfoItem;
  onClose: () => void;
  onGenerateReport: (item: GeneralInfoItem) => void | Promise<void>;
  onOpenAiReport?: (itemId: number) => void;
  onEdit?: (item: GeneralInfoItem) => void;
  onDelete?: (item: GeneralInfoItem) => void;
  onShareReport?: (item: GeneralInfoItem) => void;
  onOpenStorageImage?: (url: string, fileName?: string) => void;
  isGeneratingReport?: boolean;
  needsManualFactCheck?: boolean;
  startInEditMode?: boolean;
  onSaveItemEdit?: (item: GeneralInfoItem) => void | Promise<void>;
  onUploadInlineImage?: (file: File) => Promise<string>;
}

export default function GeneralInfoDetailModal({
  item,
  onClose,
  onGenerateReport: _onGenerateReport,
  onOpenAiReport,
  onDelete,
  onShareReport: _onShareReport,
  onOpenStorageImage,
  isGeneratingReport = false,
  needsManualFactCheck = false,
  startInEditMode = false,
  onSaveItemEdit,
  onUploadInlineImage,
}: Props) {
  void needsManualFactCheck;
  void _onGenerateReport;
  void _onShareReport;
  const [copyFeedback, setCopyFeedback] = React.useState<"text" | null>(null);
  const [isEditing, setIsEditing] = React.useState(Boolean(startInEditMode));
  const [editTitle, setEditTitle] = React.useState(item.title || "");
  const [editSummary, setEditSummary] = React.useState(item.summary || "");
  const [editPrimary, setEditPrimary] = React.useState(item.primaryCategory || "");
  const [editSecondary, setEditSecondary] = React.useState(item.secondaryCategory || "");
  const [editKeywordsText, setEditKeywordsText] = React.useState(
    (item.keywords || []).join(", "),
  );
  const [bodyImageTick, setBodyImageTick] = React.useState(0);
  const [bodyEditorKey, setBodyEditorKey] = React.useState(0);
  const [editMediaItems, setEditMediaItems] = React.useState<GeneralInfoMediaItem[]>(() =>
    getGeneralInfoDisplayMediaItems(item),
  );
  const bodyRichTextRef = React.useRef<HTMLDivElement | null>(null);
  const coverImageFileRef = React.useRef<HTMLInputElement | null>(null);
  const bodyImageFileRef = React.useRef<HTMLInputElement | null>(null);
  const bodyImageInsertPanelRef = React.useRef<HTMLDivElement | null>(null);
  const detailBodyRef = React.useRef<HTMLDivElement | null>(null);
  const [showBodyImageInsert, setShowBodyImageInsert] = React.useState(false);
  const [showHandwritingModal, setShowHandwritingModal] = React.useState(false);
  const [showTextToImageModal, setShowTextToImageModal] = React.useState(false);
  const [collectFontSizePx, setCollectFontSizePx] = React.useState(15);
  const [autoSaveStatus, setAutoSaveStatus] = React.useState("");
  const [autoSaveTick, setAutoSaveTick] = React.useState(0);
  const restoreDoneRef = React.useRef(false);
  const toolbarFileRef = React.useRef<HTMLInputElement | null>(null);

  const hasAiReport = hasDisplayableAiReport(String(item?.factCheckSummary || ""));

  React.useEffect(() => {
    setEditTitle(item.title || "");
    setEditSummary(item.summary || "");
    setEditPrimary(item.primaryCategory || "");
    setEditSecondary(item.secondaryCategory || "");
    setEditKeywordsText((item.keywords || []).join(", "));
    setEditMediaItems(getGeneralInfoDisplayMediaItems(item));
    setBodyEditorKey((prev) => prev + 1);
    setIsEditing(true);
    restoreDoneRef.current = false;
    window.setTimeout(() => {
      restoreDoneRef.current = true;
    }, 400);
  }, [item.id, item.factCheckSummary, item.factCheckStatus, startInEditMode]);

  React.useEffect(() => {
    if (!isEditing || !bodyRichTextRef.current) return;
    bodyRichTextRef.current.innerHTML = getGeneralInfoFormattedHtml(item);
    enhanceInlineImageBlocks(bodyRichTextRef.current);
    bindInlineImageRemoveHandler(bodyRichTextRef.current);
    setShowBodyImageInsert(false);
  }, [isEditing, bodyEditorKey, item]);

  const textEndsWithImageTrigger = React.useCallback((raw: string) => {
    const text = String(raw || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\r/g, "");
    const trimmedEnd = text.replace(/[ \t\n]+$/g, "");
    return /[Ss]$/.test(trimmedEnd);
  }, []);

  const checkBodyImageTrigger = React.useCallback(() => {
    const editor = bodyRichTextRef.current;
    const plain = String(editor?.innerText || "");
    setShowBodyImageInsert(
      editorHasInlineImageTrigger(editor) || textEndsWithImageTrigger(plain),
    );
  }, [textEndsWithImageTrigger]);

  const insertBodyImageFiles = React.useCallback(
    (files: FileList | File[] | null) => {
      if (!files || (files instanceof FileList ? files.length === 0 : files.length === 0)) return;
      const afterNode = removeInlineImageTrigger(bodyRichTextRef.current);
      const list = dedupeImageFiles(files instanceof FileList ? Array.from(files) : files);
      const mediaFiles = list.filter(
        (file) =>
          file.type.startsWith("image/") ||
          file.type.startsWith("video/") ||
          /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov|webm|m4v)$/i.test(file.name || ""),
      );
      if (!mediaFiles.length) {
        alert("이미지/동영상 파일을 선택해 주세요.");
        return;
      }

      void (async () => {
        try {
          const editor = bodyRichTextRef.current;
          if (!editor) return;

          const uploaded: Array<{ src: string; name: string; type: "image" | "video" }> = [];
          for (const [index, file] of mediaFiles.entries()) {
            const isVideo =
              file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name || "");
            let src = "";
            if (!isVideo && onUploadInlineImage) {
              try {
                src = String((await onUploadInlineImage(file)) || "").trim();
              } catch (error) {
                console.error("body inline image upload failed", error);
              }
            }
            if (!src) {
              const loaded = await readFilesAsDataUrls([file]);
              src = String(loaded[0]?.dataUrl || "").trim();
            }
            if (!src) continue;
            uploaded.push({
              src,
              name: file.name || `inline-${index + 1}`,
              type: isVideo ? "video" : "image",
            });
          }

          if (!uploaded.length) {
            alert("이미지를 넣지 못했습니다. 다시 시도해 주세요.");
            return;
          }

          insertInlineMediaIntoEditor(editor, uploaded, { afterNode });
          enhanceInlineImageBlocks(editor);
          bindInlineImageRemoveHandler(editor);
          setBodyImageTick((prev) => prev + 1);
        } catch (error) {
          console.error("inline image insert failed", error);
          alert("이미지를 본문 TEXT에 넣지 못했습니다. 다시 시도해 주세요.");
        } finally {
          setShowBodyImageInsert(false);
        }
      })();
    },
    [onUploadInlineImage],
  );

  const handleBodyImageInsertPaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const pastedFiles = collectClipboardImageFiles(event.clipboardData);
      if (pastedFiles.length > 0) {
        insertBodyImageFiles(pastedFiles);
      }
    },
    [insertBodyImageFiles],
  );

  const handleBodyEditorPaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const pastedFiles = collectClipboardImageFiles(event.clipboardData);
      if (pastedFiles.length > 0) {
        event.preventDefault();
        insertBodyImageFiles(pastedFiles);
        return;
      }
      requestAnimationFrame(checkBodyImageTrigger);
    },
    [checkBodyImageTrigger, insertBodyImageFiles],
  );

  React.useEffect(() => {
    if (!isEditing) return;
    const editor = bodyRichTextRef.current;
    if (!editor) return;
    const recheck = () => checkBodyImageTrigger();
    editor.addEventListener("keyup", recheck);
    editor.addEventListener("compositionend", recheck);
    editor.addEventListener("input", recheck);
    return () => {
      editor.removeEventListener("keyup", recheck);
      editor.removeEventListener("compositionend", recheck);
      editor.removeEventListener("input", recheck);
    };
  }, [isEditing, bodyEditorKey, checkBodyImageTrigger]);

  React.useEffect(() => {
    if (!showBodyImageInsert) return;
    const el = bodyImageInsertPanelRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [showBodyImageInsert]);

  React.useEffect(() => {
    if (detailBodyRef.current) {
      detailBodyRef.current.scrollTop = 0;
    }
  }, [item?.id, hasAiReport]);

  const persistRepresentativeMedia = React.useCallback(
    async (nextMedia: GeneralInfoMediaItem[]) => {
      setEditMediaItems(nextMedia);
      if (isEditing || !onSaveItemEdit) {
        setIsEditing(true);
        return;
      }
      const main = nextMedia[0];
      await onSaveItemEdit({
        ...item,
        mediaItems: nextMedia,
        filePreview: main?.preview || "",
        fileName: main?.name || item.fileName || "",
        fileType: main?.type || item.fileType || "image",
      });
    },
    [isEditing, item, onSaveItemEdit],
  );

  const addCoverMediaFiles = React.useCallback(
    async (files: FileList | File[] | null, asRepresentative = false) => {
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
      const current = isEditing ? editMediaItems : getGeneralInfoDisplayMediaItems(item);
      const merged = asRepresentative
        ? [...nextItems, ...current]
        : [...current, ...nextItems];
      await persistRepresentativeMedia(merged);
    },
    [editMediaItems, isEditing, item, persistRepresentativeMedia],
  );

  const handleCoverFileChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      const asRepresentative = event.currentTarget.dataset.mode === "replace";
      void addCoverMediaFiles(files, asRepresentative);
      event.target.value = "";
    },
    [addCoverMediaFiles],
  );

  const handleCoverPaste = React.useCallback(
    (event: React.ClipboardEvent) => {
      const files = collectClipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void addCoverMediaFiles(dedupeImageFiles(files), true);
    },
    [addCoverMediaFiles],
  );

  const setMediaAsRepresentative = React.useCallback(
    (index: number) => {
      const current = isEditing ? editMediaItems : getGeneralInfoDisplayMediaItems(item);
      if (index <= 0 || index >= current.length) return;
      const next = [...current];
      const [picked] = next.splice(index, 1);
      void persistRepresentativeMedia([picked, ...next]);
    },
    [editMediaItems, isEditing, item, persistRepresentativeMedia],
  );

  const removeEditMediaItem = React.useCallback(
    (index: number) => {
      const current = isEditing ? editMediaItems : getGeneralInfoDisplayMediaItems(item);
      const next = current.filter((_, i) => i !== index);
      void persistRepresentativeMedia(next);
    },
    [editMediaItems, isEditing, item, persistRepresentativeMedia],
  );

  const applyHtmlImageAsRepresentative = React.useCallback(
    async (src: string, label: string) => {
      const url = String(src || "").trim();
      if (!url) return;

      const current = isEditing ? editMediaItems : getGeneralInfoDisplayMediaItems(item);
      const existingIndex = current.findIndex(
        (media) => media.preview === url || media.fileUrl === url,
      );
      let nextMedia: GeneralInfoMediaItem[];
      if (existingIndex === 0) {
        return;
      }
      if (existingIndex > 0) {
        nextMedia = [...current];
        const [picked] = nextMedia.splice(existingIndex, 1);
        nextMedia = [picked, ...nextMedia];
      } else {
        nextMedia = [makeGeneralInfoMediaItem(label, "image", url), ...current];
      }

      await persistRepresentativeMedia(nextMedia);
    },
    [editMediaItems, isEditing, item, persistRepresentativeMedia],
  );

  const bodyImageSrcs = React.useMemo(() => {
    const liveBodyHtml = isEditing ? String(bodyRichTextRef.current?.innerHTML || "") : "";
    return extractGeneralInfoBodyImageSrcs(
      liveBodyHtml,
      item.formattedTextHtml,
      looksLikeHtmlContent(item.text || "") ? item.text : "",
    );
  }, [isEditing, item.formattedTextHtml, item.text, bodyEditorKey, bodyImageTick]);

  const reportImageSrcs = React.useMemo(() => {
    return extractGeneralInfoReportImageSrcs(String(item.factCheckSummary || ""));
  }, [item.factCheckSummary]);

  const saveAllEdits = React.useCallback(async (opts?: { keepEditing?: boolean }) => {
    const keepEditing = opts?.keepEditing !== false;
    const bodyHtml = String(bodyRichTextRef.current?.innerHTML || item.formattedTextHtml || "").trim();
    const bodyText = htmlToPlainText(bodyHtml) || String(item.text || "");
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
      sourceUrl: item.sourceUrl,
      primaryCategory: editPrimary.trim() || item.primaryCategory,
      secondaryCategory: editSecondary.trim() || item.secondaryCategory,
      thirdCategory: "",
      keywords,
      text: bodyText,
      formattedTextHtml: bodyHtml,
      mediaItems,
      filePreview: mainMedia?.preview || "",
      fileName: mainMedia?.name || "",
    };

    if (onSaveItemEdit) {
      await onSaveItemEdit(updated);
    }
    setShowBodyImageInsert(false);
    if (!keepEditing) setIsEditing(false);
  }, [
    editKeywordsText,
    editMediaItems,
    editPrimary,
    editSecondary,
    editSummary,
    editTitle,
    item,
    onSaveItemEdit,
  ]);

  // Source 수정 자동 저장 (수집 화면과 동일하게 debounce)
  React.useEffect(() => {
    if (!isEditing || !onSaveItemEdit) return;
    const timer = window.setTimeout(() => {
      if (!restoreDoneRef.current) return;
      void (async () => {
        try {
          await saveAllEdits({ keepEditing: true });
          setAutoSaveStatus(
            `💾 자동 저장 ${new Date().toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}`,
          );
        } catch (error) {
          console.error(error);
          setAutoSaveStatus("⚠️ 자동 저장 실패");
        }
      })();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    autoSaveTick,
    bodyImageTick,
    editKeywordsText,
    editMediaItems,
    editSummary,
    editTitle,
    isEditing,
    onSaveItemEdit,
    saveAllEdits,
  ]);

  const runBodyRichCommand = React.useCallback((command: string, value?: string) => {
    const editor = bodyRichTextRef.current;
    editor?.focus();

    const wrapSelectionWithSpan = (styles: Record<string, string>) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        const span = document.createElement("span");
        Object.assign(span.style, styles);
        span.appendChild(document.createTextNode("\u200b"));
        range.insertNode(span);
        range.setStart(span.firstChild!, 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      try {
        const span = document.createElement("span");
        Object.assign(span.style, styles);
        range.surroundContents(span);
        return true;
      } catch {
        document.execCommand("styleWithCSS", false, "true");
        if (styles.fontSize) {
          document.execCommand("fontSize", false, "7");
          editor?.querySelectorAll('font[size="7"]').forEach((node) => {
            const el = node as HTMLElement;
            const span = document.createElement("span");
            span.style.fontSize = styles.fontSize!;
            while (el.firstChild) span.appendChild(el.firstChild);
            el.replaceWith(span);
          });
          return true;
        }
        return false;
      }
    };

    if (command === "insertText" && value) {
      const ok = document.execCommand("insertText", false, value);
      if (!ok) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(value));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    } else if (command === "fontSizePx" && value) {
      wrapSelectionWithSpan({ fontSize: `${value}px` });
    } else if (command === "highlight" && value) {
      document.execCommand("styleWithCSS", false, "true");
      const ok =
        document.execCommand("hiliteColor", false, value) ||
        document.execCommand("backColor", false, value);
      if (!ok) wrapSelectionWithSpan({ backgroundColor: value });
    } else if (command === "foreColor" && value) {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, value);
    } else {
      document.execCommand(command, false, value);
    }
    setBodyImageTick((prev) => prev + 1);
    setAutoSaveTick((prev) => prev + 1);
  }, []);

  const insertDataUrlIntoBody = React.useCallback(
    (dataUrl: string, name: string) => {
      const editor = bodyRichTextRef.current;
      if (!editor || !dataUrl) return;
      removeInlineImageTrigger(editor);
      insertInlineMediaIntoEditor(editor, [{ src: dataUrl, name, type: "image" }]);
      enhanceInlineImageBlocks(editor);
      bindInlineImageRemoveHandler(editor);
      setShowBodyImageInsert(false);
      setBodyImageTick((prev) => prev + 1);
      setAutoSaveTick((prev) => prev + 1);
    },
    [],
  );

  const handleToolbarPasteImage = React.useCallback(async () => {
    try {
      if (!navigator.clipboard?.read) {
        alert("이 브라우저는 클립보드 이미지 읽기를 지원하지 않습니다. 본문에 직접 붙여넣기 하세요.");
        return;
      }
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clipboardItem of items) {
        const type = clipboardItem.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await clipboardItem.getType(type);
        files.push(new File([blob], `clipboard-${Date.now()}.png`, { type }));
      }
      if (!files.length) {
        alert("클립보드에서 이미지를 찾지 못했습니다.");
        return;
      }
      insertBodyImageFiles(files);
    } catch {
      alert("클립보드 접근에 실패했습니다. 본문 칸에 Ctrl+V / ⌘V로 붙여넣기 하세요.");
    }
  }, [insertBodyImageFiles]);

  const handleAiReportAction = React.useCallback(() => {
    // 저장 후 Report 화면 열기
    void (async () => {
      try {
        await saveAllEdits({ keepEditing: true });
      } catch {
        /* ignore */
      }
      onOpenAiReport?.(item.id);
    })();
  }, [item.id, onOpenAiReport, saveAllEdits]);

  if (!item) return null;

  const mediaItems = isEditing ? editMediaItems : getGeneralInfoDisplayMediaItems(item);

  const copyPlainText = async (text: string) => {
    const value = String(text || "").trim();
    if (!value) {
      alert("복사할 Text가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback("text");
      window.setTimeout(() => {
        setCopyFeedback((prev) => (prev === "text" ? null : prev));
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
            <span>Source DATA · 수정</span>
            <p className="mutedText" style={{ margin: "4px 0 0", fontSize: 12 }}>
              일반 정보 수집과 같은 형식으로 수정합니다. 입력 내용은 자동 저장됩니다.
            </p>
          </div>
          <div className="generalInfoDetailHeaderActions">
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
          <section className="generalInfoDetailSection" style={{ order: 0 }}>
            <strong>정보 제목</strong>
            <input
              value={editTitle}
              onChange={(e) => {
                setEditTitle(e.target.value);
                setAutoSaveTick((prev) => prev + 1);
              }}
              placeholder="제목을 입력하세요"
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
          </section>

          <section className="generalInfoDetailSection" style={{ order: 1 }}>
            <div className="generalInfoSectionTitleRow">
              <strong>Text 입력 / 편집</strong>
              <button
                type="button"
                className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                onClick={() =>
                  void copyPlainText(
                    String(bodyRichTextRef.current?.innerText || item.text || ""),
                  )
                }
              >
                {copyFeedback === "text" ? "✅ 복사됨" : "📋 전체 복사"}
              </button>
            </div>
            <p className="mutedText" style={{ margin: "0 0 8px", fontSize: 12 }}>
              줄바꿈, 띄어쓰기, 글자색, 굵게, 밑줄, 형광, 크기 편집 가능
            </p>
            <CollectFormatToolbar
              onUndo={() => runBodyRichCommand("undo")}
              onRedo={() => runBodyRichCommand("redo")}
              onBold={() => runBodyRichCommand("bold")}
              onUnderline={() => runBodyRichCommand("underline")}
              onFontSize={(px) => {
                setCollectFontSizePx(px);
                runBodyRichCommand("fontSizePx", String(px));
              }}
              onFontSizeStep={(delta) => {
                const next = stepCollectFontSize(collectFontSizePx, delta);
                setCollectFontSizePx(next);
                runBodyRichCommand("fontSizePx", String(next));
              }}
              onColor={(c) => runBodyRichCommand("foreColor", c)}
              onHighlight={(c) => runBodyRichCommand("highlight", c)}
              onInsertChar={(ch) => runBodyRichCommand("insertText", ch)}
              onImage={() => {
                setShowBodyImageInsert(true);
                window.setTimeout(() => toolbarFileRef.current?.click(), 0);
              }}
              onPasteImage={() => {
                void handleToolbarPasteImage();
              }}
              onTextImage={() => setShowTextToImageModal(true)}
              onHandwriting={() => setShowHandwritingModal(true)}
            />
            <input
              ref={toolbarFileRef}
              type="file"
              accept="image/*,image/heic,image/heif,video/*"
              multiple
              hidden
              onChange={(e) => {
                insertBodyImageFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div
              key={bodyEditorKey}
              ref={bodyRichTextRef}
              className="generalInfoRichTextEditor collectPaperEditor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              onInput={() => {
                setBodyImageTick((prev) => prev + 1);
                setAutoSaveTick((prev) => prev + 1);
                checkBodyImageTrigger();
              }}
              onKeyUp={checkBodyImageTrigger}
              onCompositionEnd={checkBodyImageTrigger}
              onPaste={handleBodyEditorPaste}
              data-placeholder="본문 TEXT를 수정하세요. 문장 끝에 S를 붙이면 이미지를 넣을 수 있습니다."
              style={{
                display: "block",
                width: "100%",
                minHeight: 220,
                maxHeight: 480,
                overflowY: "auto",
                boxSizing: "border-box",
                borderRadius: 14,
                border: "1px solid #e2e8f0",
                background: "#ffffff",
                color: "#1a2430",
                padding: "14px 15px",
                fontSize: 15,
                lineHeight: 1.8,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            />
            {showBodyImageInsert && (
              <div ref={bodyImageInsertPanelRef} className="generalInfoTextImageInsertPanel">
                <div className="generalInfoTextImageInsertHead">
                  <strong>이미지 붙여넣기</strong>
                  <span>S 감지 · 사진첩 또는 복사 붙여넣기</span>
                  <button
                    type="button"
                    className="secondaryButton smallActionButton"
                    onClick={() => {
                      removeInlineImageTrigger(bodyRichTextRef.current);
                      setShowBodyImageInsert(false);
                    }}
                  >
                    닫기
                  </button>
                </div>
                <div className="generalInfoTextImageInsertActions">
                  <label className="primaryLabel generalInfoTextImageFileLabel">
                    🖼 사진첩 · 파일 선택
                    <input
                      ref={bodyImageFileRef}
                      type="file"
                      accept="image/*,image/heic,image/heif,video/*"
                      multiple
                      onChange={(e) => {
                        insertBodyImageFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <div
                    className="generalInfoTextImagePasteZone"
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    tabIndex={0}
                    onPaste={handleBodyImageInsertPaste}
                  >
                    📋 아이폰·PC 이미지 여기 붙여넣기 (Ctrl+V / ⌘V)
                  </div>
                </div>
              </div>
            )}
            <p className="mutedText" style={{ margin: "8px 0 0", fontSize: 12 }}>
              문장 끝에 <strong>S</strong>를 붙이면 이미지 붙여넣기가 열립니다.
            </p>
          </section>

          <section className="generalInfoDetailSection" style={{ order: 2 }}>
            <div className="generalInfoSectionTitleRow">
              <strong>대표 이미지 / 자료</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="secondaryButton smallActionButton"
                  onClick={() => {
                    if (coverImageFileRef.current) {
                      coverImageFileRef.current.dataset.mode = "replace";
                      coverImageFileRef.current.click();
                    }
                  }}
                >
                  {mediaItems.length === 0 ? "대표 이미지 추가" : "대표 이미지 교체"}
                </button>
                {mediaItems.length > 0 && (
                  <button
                    type="button"
                    className="secondaryButton smallActionButton"
                    onClick={() => {
                      if (coverImageFileRef.current) {
                        coverImageFileRef.current.dataset.mode = "append";
                        coverImageFileRef.current.click();
                      }
                    }}
                  >
                    이미지 추가
                  </button>
                )}
                {mediaItems.length > 0 && (
                  <button
                    type="button"
                    className="secondaryButton smallActionButton dangerSmallButton"
                    onClick={() => void persistRepresentativeMedia([])}
                  >
                    전체 삭제
                  </button>
                )}
              </div>
            </div>
            <input
              ref={coverImageFileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={handleCoverFileChange}
            />
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
              <strong>대표 이미지 붙여넣기(교체)</strong>
            </div>
            {mediaItems.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "10px" }}>
                {mediaItems.map((media, index) => (
                  <div
                    className="generalInfoDetailMediaCard"
                    key={media.id || index}
                    style={{
                      width: "100%",
                      padding: "12px",
                      border:
                        index === 0
                          ? "2px solid rgba(250, 204, 21, 0.65)"
                          : "1px solid rgba(148, 163, 184, 0.22)",
                      borderRadius: "14px",
                      background: "rgba(15, 23, 42, 0.45)",
                      position: "relative",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      {index === 0 ? (
                        <span className="generalInfoDraftMediaBadge representative">★ 대표</span>
                      ) : (
                        <button
                          type="button"
                          className="secondaryButton smallActionButton"
                          onClick={() => setMediaAsRepresentative(index)}
                        >
                          ★ 대표로 교체
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
                    {media.type === "video" ? (
                      <video
                        src={media.preview}
                        controls
                        style={{
                          width: "100%",
                          maxHeight: "500px",
                          objectFit: "contain",
                          borderRadius: "10px",
                          display: "block",
                        }}
                      />
                    ) : (
                      <img
                        src={media.preview}
                        alt={media.name || item.title || `자료 이미지 ${index + 1}`}
                        style={{
                          width: "100%",
                          maxHeight: "500px",
                          objectFit: "contain",
                          borderRadius: "10px",
                          background: "rgba(2, 6, 23, 0.55)",
                          display: "block",
                          cursor: onOpenStorageImage ? "zoom-in" : "default",
                        }}
                        onClick={() => {
                          if (!onOpenStorageImage) return;
                          onOpenStorageImage(
                            media.preview,
                            media.name || `${item.title || "general_info"}_${index + 1}.jpg`,
                          );
                        }}
                      />
                    )}
                    <p className="mutedText" style={{ margin: "8px 0 4px", wordBreak: "break-all" }}>
                      {media.name || `자료 이미지 ${index + 1}`}
                      {index === 0 ? " · 창고 카드 썸네일" : ""}
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
                대표 이미지가 저장되지 않았습니다. [대표 이미지 추가] 또는 붙여넣기로 등록하세요.
              </p>
            )}
            {mediaItems.length > 0 && (
              <p className="mutedText" style={{ marginTop: 8, fontSize: 12 }}>
                ★ 대표로 교체하면 바로 반영됩니다. 본문·보고서 이미지에서도 고를 수 있습니다.
              </p>
            )}

            {bodyImageSrcs.length > 0 && (
              <div className="generalInfoBodyImagePickBox" style={{ marginTop: 14 }}>
                <strong style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#7dd3fc" }}>
                  본문 이미지에서 대표 선택
                </strong>
                <p className="mutedText" style={{ margin: "0 0 10px", fontSize: 12 }}>
                  본문 TEXT에 넣은 사진을 대표 이미지로 쓸 수 있습니다.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 10,
                  }}
                >
                  {bodyImageSrcs.map((src, index) => {
                    const isRep =
                      mediaItems[0] &&
                      (mediaItems[0].preview === src || mediaItems[0].fileUrl === src);
                    return (
                      <div
                        key={`body-img-${index}`}
                        style={{
                          border: isRep
                            ? "2px solid #facc15"
                            : "1px solid rgba(148, 163, 184, 0.28)",
                          borderRadius: 12,
                          overflow: "hidden",
                          background: "rgba(2, 6, 23, 0.55)",
                        }}
                      >
                        <img
                          src={src}
                          alt={`본문 이미지 ${index + 1}`}
                          style={{
                            display: "block",
                            width: "100%",
                            height: 100,
                            objectFit: "cover",
                            background: "#020617",
                          }}
                        />
                        <button
                          type="button"
                          className="secondaryButton smallActionButton"
                          style={{ width: "100%", borderRadius: 0, fontSize: 11 }}
                          disabled={Boolean(isRep)}
                          onClick={() => void applyHtmlImageAsRepresentative(src, "본문 이미지")}
                        >
                          {isRep ? "★ 대표" : "★ 대표로 설정"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {reportImageSrcs.length > 0 && (
              <div className="generalInfoBodyImagePickBox" style={{ marginTop: 14 }}>
                <strong style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#7dd3fc" }}>
                  보고서 이미지에서 대표 선택
                </strong>
                <p className="mutedText" style={{ margin: "0 0 10px", fontSize: 12 }}>
                  보고서에 넣은 사진을 대표 이미지로 쓸 수 있습니다.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 10,
                  }}
                >
                  {reportImageSrcs.map((src, index) => {
                    const isRep =
                      mediaItems[0] &&
                      (mediaItems[0].preview === src || mediaItems[0].fileUrl === src);
                    return (
                      <div
                        key={`report-img-${index}`}
                        style={{
                          border: isRep
                            ? "2px solid #facc15"
                            : "1px solid rgba(148, 163, 184, 0.28)",
                          borderRadius: 12,
                          overflow: "hidden",
                          background: "rgba(2, 6, 23, 0.55)",
                        }}
                      >
                        <img
                          src={src}
                          alt={`보고서 이미지 ${index + 1}`}
                          style={{
                            display: "block",
                            width: "100%",
                            height: 100,
                            objectFit: "cover",
                            background: "#020617",
                          }}
                        />
                        <button
                          type="button"
                          className="secondaryButton smallActionButton"
                          style={{ width: "100%", borderRadius: 0, fontSize: 11 }}
                          disabled={Boolean(isRep)}
                          onClick={() => void applyHtmlImageAsRepresentative(src, "보고서 이미지")}
                        >
                          {isRep ? "★ 대표" : "★ 대표로 설정"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          <section className="generalInfoDetailSection" style={{ order: 3 }}>
            <strong>키워드 / 요약</strong>
            <p className="mutedText" style={{ margin: "4px 0 10px", fontSize: 12 }}>
              키워드와 요약을 직접 입력하세요. 입력 내용은 자동 저장됩니다.
            </p>
            <div className="generalInfoResultBox generalInfoKeywordInputBox" style={{ marginBottom: 10 }}>
              <strong>키워드 직접 입력</strong>
              <input
                value={editKeywordsText}
                onChange={(e) => {
                  setEditKeywordsText(e.target.value);
                  setAutoSaveTick((prev) => prev + 1);
                }}
                placeholder="예: #npm, #run, #dev 또는 npm, run, dev"
                className="generalInfoFactCheckStatusSelect"
                style={{ width: "100%" }}
              />
            </div>
            <div className="generalInfoResultBox" style={{ marginBottom: 10 }}>
              <strong>키워드</strong>
              <div className="miniTags">
                {editKeywordsText
                  .split(/[,，#\n]+/)
                  .map((k) => k.trim().replace(/^#+/, ""))
                  .filter(Boolean).length > 0 ? (
                  editKeywordsText
                    .split(/[,，#\n]+/)
                    .map((k) => k.trim().replace(/^#+/, ""))
                    .filter(Boolean)
                    .map((keyword) => <span key={keyword}>#{keyword}</span>)
                ) : (
                  <span>위에서 키워드를 입력하면 표시됩니다.</span>
                )}
              </div>
            </div>
            <div className="generalInfoResultBox generalInfoEditableResultBox">
              <strong>요약</strong>
              <textarea
                value={editSummary}
                onChange={(e) => {
                  setEditSummary(e.target.value);
                  setAutoSaveTick((prev) => prev + 1);
                }}
                rows={4}
                placeholder="요약 내용을 직접 입력하세요."
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
            </div>
            <div className="generalInfoActionRow" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="gradientButton"
                disabled={isGeneratingReport}
                onClick={handleAiReportAction}
              >
                {isGeneratingReport
                  ? "작성 중…"
                  : hasAiReport
                    ? "Report 열기"
                    : "Report 작성"}
              </button>
            </div>
            {autoSaveStatus ? (
              <p className="mutedText" style={{ margin: "8px 0 0", fontSize: 12 }}>
                {autoSaveStatus}
              </p>
            ) : (
              <p className="mutedText" style={{ margin: "8px 0 0", fontSize: 12 }}>
                입력 내용은 자동 저장됩니다. [Report]를 누르면 보고서 화면을 엽니다.
              </p>
            )}
          </section>
        </div>

        <div className="modalFooter">
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

      {showHandwritingModal && (
        <HandwritingModal
          onCancel={() => setShowHandwritingModal(false)}
          onInsert={(dataUrl) => {
            insertDataUrlIntoBody(dataUrl, `handwriting-${Date.now()}.png`);
            setShowHandwritingModal(false);
          }}
        />
      )}
      {showTextToImageModal && (
        <TextToImageModal
          initialText={String(bodyRichTextRef.current?.innerText || item.text || "").slice(0, 800)}
          onCancel={() => setShowTextToImageModal(false)}
          onInsert={(dataUrl) => {
            insertDataUrlIntoBody(dataUrl, `text-image-${Date.now()}.png`);
            setShowTextToImageModal(false);
          }}
        />
      )}
    </div>
  );
}
