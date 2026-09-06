"use client";

/**
 * Chapter3Info.tsx
 * Chapter 3 — 일반 정보 수집 / 키워드·요약 / 저장
 * TravelDiaryApp의 "info" 탭 JSX 분리
 */

import React from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { insertInlineMediaIntoEditor, readFilesAsDataUrls, enhanceInlineImageBlocks, bindInlineImageRemoveHandler, editorHasInlineImageTrigger, removeInlineImageTrigger, dedupeImageFiles, collectClipboardImageFiles, extractTitleFromPlainText, extractGeneralInfoBodyImageSrcs, makeGeneralInfoMediaItem, hasDisplayableAiReport } from "../lib/generalInfoHelpers";
import { stepCollectFontSize } from "../lib/collectFormatPalette";
import { Card, EmptyState } from "./SharedComponents";
import { CollectFormatToolbar } from "./CollectFormatToolbar";
import { HandwritingModal } from "./HandwritingModal";
import { TextToImageModal } from "./TextToImageModal";

export interface Chapter3InfoProps {
  // Gemini API Key
  geminiApiKey: string;
  setGeminiApiKey: React.Dispatch<React.SetStateAction<string>>;

  // 탭
  generalInfoActiveTab: "storage" | "collect";
  setGeneralInfoActiveTab: React.Dispatch<React.SetStateAction<"storage" | "collect">>;

  // 레이아웃
  isGeneralInfoMobileLayout: boolean;

  // draft 상태
  generalInfoDraft: GeneralInfoDraft;
  setGeneralInfoDraft: React.Dispatch<React.SetStateAction<GeneralInfoDraft>>;
  generalInfoDraftBackup: GeneralInfoDraft | null;
  generalInfoEditingId: number | null;
  generalInfoImageLoadFailed: boolean;
  setGeneralInfoImageLoadFailed: (value: boolean) => void;
  generalInfoKeywordText: string;
  setGeneralInfoKeywordText: (value: string) => void;

  // Rich Text
  generalInfoRichTextEditorKey: number;
  generalInfoRichTextRef: React.RefObject<HTMLDivElement | null>;
  generalInfoRichTextInitialHtml: string;
  syncGeneralInfoRichTextToDraft: () => void;
  handleGeneralInfoRichPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  handleGeneralInfoRichCommand: (command: string, value?: string) => void;
  getGeneralInfoToolbarButtonStyle: () => React.CSSProperties;
  makeGeneralInfoHtmlFromText: (text: string) => string;

  // 핸들러
  handleUndoGeneralInfoDraft: () => void;
  handleResetGeneralInfoDraft: () => void;
  handleCollectGeneralInfoFromClipboard: () => void;
  isCollectingGeneralInfoClipboard: boolean;
  handleGeneralInfoFileUpload: (files: FileList | null) => void;
  handleGeneralInfoIphonePasteZonePaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  handleClearGeneralInfoCoverImage: () => void;
  handleRemoveGeneralInfoMediaItem: (index: number) => void;
  uploadInlineImageFile?: (file: File) => Promise<string>;
  handleConfirmGeneralInfo: () => void;
  handleCancelEditGeneralInfo: () => void;
  generalInfoAutoSaveStatus?: string;

  // 저장함
  generalInfoItems: GeneralInfoItem[];
  filteredGeneralInfoItems: GeneralInfoItem[];
  generalInfoSearchTerm: string;
  setGeneralInfoSearchTerm: (value: string) => void;
  generalInfoDetailId: number | null;
  setGeneralInfoDetailId: (id: number | null) => void;
  handleOpenGeneralInfoDetail?: (itemId: number) => void;
  handleOpenGeneralInfoAiReport?: (itemId: number) => void;
  handleTogglePinGeneralInfo: (itemId: number) => void;
  loadGeneralInfoItemsFromSupabase: () => Promise<void>;
  generalInfoSupabaseStatus: string;

  // 헬퍼
  normalizeGeneralInfoMediaItems: (draft: GeneralInfoDraft) => GeneralInfoMediaItem[];
  getGeneralInfoDisplayMediaItems: (item: GeneralInfoItem) => GeneralInfoMediaItem[];
  onOpenStorageImage?: (url: string, fileName?: string) => void;
}

export function Chapter3Info({
  geminiApiKey: _geminiApiKey,
  setGeminiApiKey: _setGeminiApiKey,
  generalInfoActiveTab,
  setGeneralInfoActiveTab,
  isGeneralInfoMobileLayout,
  generalInfoDraft,
  setGeneralInfoDraft,
  generalInfoDraftBackup,
  generalInfoEditingId,
  generalInfoImageLoadFailed,
  setGeneralInfoImageLoadFailed,
  generalInfoKeywordText,
  setGeneralInfoKeywordText,
  generalInfoRichTextEditorKey,
  generalInfoRichTextRef,
  generalInfoRichTextInitialHtml,
  syncGeneralInfoRichTextToDraft,
  handleGeneralInfoRichPaste,
  handleGeneralInfoRichCommand,
  getGeneralInfoToolbarButtonStyle: _getGeneralInfoToolbarButtonStyle,
  makeGeneralInfoHtmlFromText: _makeGeneralInfoHtmlFromText,
  handleUndoGeneralInfoDraft,
  handleResetGeneralInfoDraft,
  handleCollectGeneralInfoFromClipboard,
  isCollectingGeneralInfoClipboard,
  handleGeneralInfoFileUpload,
  handleGeneralInfoIphonePasteZonePaste,
  handleClearGeneralInfoCoverImage,
  handleRemoveGeneralInfoMediaItem,
  uploadInlineImageFile,
  handleConfirmGeneralInfo,
  handleCancelEditGeneralInfo,
  generalInfoAutoSaveStatus = "",
  generalInfoItems,
  filteredGeneralInfoItems,
  generalInfoSearchTerm,
  setGeneralInfoSearchTerm,
  generalInfoDetailId,
  setGeneralInfoDetailId,
  handleOpenGeneralInfoDetail,
  handleOpenGeneralInfoAiReport,
  handleTogglePinGeneralInfo,
  loadGeneralInfoItemsFromSupabase,
  generalInfoSupabaseStatus,
  normalizeGeneralInfoMediaItems,
  getGeneralInfoDisplayMediaItems,
  onOpenStorageImage,
}: Chapter3InfoProps) {
  void _geminiApiKey;
  void _setGeminiApiKey;
  void isGeneralInfoMobileLayout;
  void _getGeneralInfoToolbarButtonStyle;
  void _makeGeneralInfoHtmlFromText;
  void generalInfoItems;
  void generalInfoDetailId;

  const activeTab = generalInfoActiveTab;
  const setActiveTab = setGeneralInfoActiveTab;
  const [memoEditIndex, setMemoEditIndex] = React.useState<number | null>(null);

  // 미디어 아이템 메모 업데이트
  const handleUpdateMediaMemo = React.useCallback((index: number, memo: string) => {
    setGeneralInfoDraft(prev => {
      const items = normalizeGeneralInfoMediaItems(prev);
      const updated = items.map((m, i) => i === index ? { ...m, memo } : m);
      const main = updated[0];
      return {
        ...prev,
        fileName: main?.name || prev.fileName,
        filePreview: main?.preview || prev.filePreview,
        fileType: main?.type || prev.fileType,
        mediaItems: updated,
      };
    });
  }, [normalizeGeneralInfoMediaItems, setGeneralInfoDraft]);

  // 대표 미디어 아이템 설정 (Swap 방식)
  const handleSetMediaAsRepresentative = React.useCallback((index: number) => {
    setGeneralInfoDraft(prev => {
      const items = normalizeGeneralInfoMediaItems(prev);
      if (index <= 0 || index >= items.length) return prev;
      
      const updated = [...items];
      const temp = updated[0];
      updated[0] = updated[index];
      updated[index] = temp;
      
      const main = updated[0];
      return {
        ...prev,
        fileName: main?.name || prev.fileName,
        filePreview: main?.preview || prev.filePreview,
        fileType: main?.type || prev.fileType,
        mediaItems: updated,
      };
    });
  }, [normalizeGeneralInfoMediaItems, setGeneralInfoDraft]);

  const handleSetHtmlImageAsRepresentative = React.useCallback((src: string, label: string) => {
    const url = String(src || "").trim();
    if (!url) return;
    setGeneralInfoDraft((prev) => {
      const items = normalizeGeneralInfoMediaItems(prev);
      const existingIndex = items.findIndex(
        (media) => media.preview === url || media.fileUrl === url,
      );
      let updated: GeneralInfoMediaItem[];
      if (existingIndex === 0) return prev;
      if (existingIndex > 0) {
        updated = [...items];
        const [picked] = updated.splice(existingIndex, 1);
        updated = [picked, ...updated];
      } else {
        updated = [makeGeneralInfoMediaItem(label, "image", url), ...items];
      }
      const main = updated[0];
      return {
        ...prev,
        fileName: main?.name || prev.fileName,
        filePreview: main?.preview || prev.filePreview,
        fileType: main?.type || "image",
        mediaItems: updated,
      };
    });
  }, [normalizeGeneralInfoMediaItems, setGeneralInfoDraft]);

  const [showTextImageInsert, setShowTextImageInsert] = React.useState(false);
  const [copyFeedback, setCopyFeedback] = React.useState<"text" | null>(null);
  const [isSelectingCoverImage, setIsSelectingCoverImage] = React.useState(false);
  const [isKeywordInputFocused, setIsKeywordInputFocused] = React.useState(false);
  const [showHandwritingModal, setShowHandwritingModal] = React.useState(false);
  const [showTextToImageModal, setShowTextToImageModal] = React.useState(false);
  const [collectFontSizePx, setCollectFontSizePx] = React.useState(15);
  const textImageFileRef = React.useRef<HTMLInputElement | null>(null);

  // remount(key) 후 InitialHtml을 contentEditable에 반영 (미적용 시 URL 가져오기 본문이 비는 버그)
  React.useEffect(() => {
    const editor = generalInfoRichTextRef.current;
    if (!editor) return;
    const html = String(generalInfoRichTextInitialHtml || "");
    if (editor.innerHTML !== html) {
      editor.innerHTML = html;
    }
    const plain = String(editor.innerText || "");
    const titleFromText = extractTitleFromPlainText(plain);
    if (titleFromText) {
      setGeneralInfoDraft((prev) =>
        prev.title.trim() ? prev : { ...prev, title: titleFromText },
      );
    }
  }, [
    generalInfoRichTextEditorKey,
    generalInfoRichTextInitialHtml,
    generalInfoRichTextRef,
    setGeneralInfoDraft,
  ]);

  const collectBodyImageSrcs = React.useMemo(() => {
    const liveHtml = String(generalInfoRichTextRef.current?.innerHTML || "");
    return extractGeneralInfoBodyImageSrcs(
      liveHtml,
      generalInfoDraft.formattedTextHtml,
      generalInfoRichTextInitialHtml,
    );
  }, [
    generalInfoDraft.formattedTextHtml,
    generalInfoDraft.mediaItems,
    generalInfoRichTextEditorKey,
    generalInfoRichTextInitialHtml,
    generalInfoRichTextRef,
    showTextImageInsert,
  ]);

  const textEndsWithImageTrigger = React.useCallback((raw: string) => {
    const text = String(raw || "").replace(/\u00a0/g, " ").replace(/\r/g, "");
    const trimmedEnd = text.replace(/[ \t\n]+$/g, "");
    // 문자 끝에 S/s를 붙이면 이미지 붙여넣기 패널 표시
    return /[Ss]$/.test(trimmedEnd);
  }, []);

  const removeTrailingImageTrigger = React.useCallback(() => {
    return removeInlineImageTrigger(generalInfoRichTextRef.current);
  }, [generalInfoRichTextRef]);

  const checkTextImageTrigger = React.useCallback(() => {
    const editor = generalInfoRichTextRef.current;
    const plain = String(editor?.innerText || "");
    setShowTextImageInsert(
      editorHasInlineImageTrigger(editor) || textEndsWithImageTrigger(plain),
    );
    const titleFromText = extractTitleFromPlainText(plain);
    if (titleFromText) {
      setGeneralInfoDraft((prev) =>
        prev.title.trim() ? prev : { ...prev, title: titleFromText },
      );
    }
    syncGeneralInfoRichTextToDraft();
  }, [generalInfoRichTextRef, textEndsWithImageTrigger, setGeneralInfoDraft, syncGeneralInfoRichTextToDraft]);

  const insertImageFilesFromTextTrigger = React.useCallback((files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const afterNode = removeTrailingImageTrigger();

    const list = dedupeImageFiles(files instanceof FileList ? Array.from(files) : files);
    const mediaFiles = list.filter(
      (file) =>
        file.type.startsWith("image/") ||
        file.type.startsWith("video/") ||
        /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov|webm)$/i.test(file.name || ""),
    );
    if (!mediaFiles.length) {
      alert("이미지/동영상 파일을 선택해 주세요.");
      return;
    }

    void (async () => {
      try {
        const editor = generalInfoRichTextRef.current;
        if (!editor) return;

        const uploaded: Array<{ src: string; name: string; type: "image" | "video" }> = [];
        for (const [index, file] of mediaFiles.entries()) {
          const isVideo =
            file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name || "");
          let src = "";
          if (!isVideo && uploadInlineImageFile) {
            try {
              src = String(await uploadInlineImageFile(file) || "").trim();
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
          alert("이미지를 넣지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
          return;
        }

        insertInlineMediaIntoEditor(editor, uploaded, { afterNode });
        syncGeneralInfoRichTextToDraft();
      } catch (error) {
        console.error("inline image insert failed", error);
        alert("이미지를 본문 TEXT에 넣지 못했습니다. 다시 시도해 주세요.");
      } finally {
        setShowTextImageInsert(false);
      }
    })();
  }, [generalInfoRichTextRef, removeTrailingImageTrigger, syncGeneralInfoRichTextToDraft, uploadInlineImageFile]);

  const handleTextImageInsertPaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const pastedFiles = collectClipboardImageFiles(event.clipboardData);
    if (pastedFiles.length > 0) {
      insertImageFilesFromTextTrigger(pastedFiles);
    }
  }, [insertImageFilesFromTextTrigger]);

  const copyPlainTextToClipboard = React.useCallback(async (text: string) => {
    const value = String(text || "").replace(/\u00a0/g, " ").trim();
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
  }, []);

  const handleCopyGeneralInfoText = React.useCallback(() => {
    syncGeneralInfoRichTextToDraft();
    const fromEditor = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");
    void copyPlainTextToClipboard(fromEditor || generalInfoDraft.text || "");
  }, [copyPlainTextToClipboard, generalInfoDraft.text, generalInfoRichTextRef, syncGeneralInfoRichTextToDraft]);

  const insertDataUrlIntoEditor = React.useCallback(
    (dataUrl: string, name: string) => {
      const editor = generalInfoRichTextRef.current;
      if (!editor || !dataUrl) return;
      removeTrailingImageTrigger();
      insertInlineMediaIntoEditor(editor, [{ src: dataUrl, name, type: "image" }]);
      syncGeneralInfoRichTextToDraft();
      setShowTextImageInsert(false);
    },
    [generalInfoRichTextRef, removeTrailingImageTrigger, syncGeneralInfoRichTextToDraft],
  );

  const handleCollectPasteImage = React.useCallback(async () => {
    try {
      if (!navigator.clipboard?.read) {
        alert("이 브라우저는 클립보드 이미지 읽기를 지원하지 않습니다. 본문에 직접 붙여넣기 하세요.");
        return;
      }
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], `clipboard-${Date.now()}.png`, { type }));
      }
      if (!files.length) {
        alert("클립보드에서 이미지를 찾지 못했습니다. 이미지를 복사한 뒤 다시 눌러 주세요.");
        return;
      }
      insertImageFilesFromTextTrigger(files);
    } catch {
      alert("클립보드 접근에 실패했습니다. 본문 칸에 Ctrl+V / ⌘V로 붙여넣기 하세요.");
    }
  }, [insertImageFilesFromTextTrigger]);

  const handleCollectFontSizeStep = React.useCallback(
    (delta: number) => {
      const next = stepCollectFontSize(collectFontSizePx, delta);
      setCollectFontSizePx(next);
      handleGeneralInfoRichCommand("fontSizePx", String(next));
    },
    [collectFontSizePx, handleGeneralInfoRichCommand],
  );

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
      {/* ===== 탭 버튼 ===== */}
      <div className="ch3TabBar">
        <button
          type="button"
          className={`ch3TabBtn ${activeTab === "storage" ? "active" : ""}`}
          onClick={() => {
            setShowTextImageInsert(false);
            setActiveTab("storage");
          }}
        >
          🗂️ 정보 창고
        </button>
        <button
          type="button"
          className={`ch3TabBtn ${activeTab === "collect" ? "active" : ""}`}
          onClick={() => setActiveTab("collect")}
        >
          ✍️ 일반 정보 수집
        </button>
      </div>

      {/* ===== 정보 수집 탭 ===== */}
      {activeTab === "collect" && (
      <section className="leftColumn generalInfoLeftColumn" style={{ position: "relative", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        {/* Scroll to Top Button */}
        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            if (window.innerWidth <= 1100) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              e.currentTarget.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="맨위로"
        >맨 위로 ↑</button>

        <div className="chapterTitleBox" style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
          <p style={{ margin: "4px 0 0 0" }}>
            일반 정보를 입력하고 키워드·요약과 함께 저장하는 보관함입니다.
          </p>
        </div>

        <Card
          number="1"
          title="일반 정보 수집"
          subtitle="Text / 이미지 / 동영상을 단독 또는 복수로 입력합니다."
          actions={
            <>
              <button
                className="secondaryButton cardHeaderActionBtn"
                type="button"
                onClick={handleUndoGeneralInfoDraft}
                disabled={!generalInfoDraftBackup}
                style={{
                  borderColor: generalInfoDraftBackup ? "rgba(234, 179, 8, 0.4)" : "rgba(148, 163, 184, 0.2)",
                  background: generalInfoDraftBackup ? "rgba(234, 179, 8, 0.15)" : "rgba(148, 163, 184, 0.05)",
                  color: generalInfoDraftBackup ? "#facc15" : "#64748b",
                  cursor: generalInfoDraftBackup ? "pointer" : "not-allowed",
                }}
              >
                되돌리기
              </button>
              <button
                className="dangerButton cardHeaderActionBtn"
                type="button"
                onClick={handleResetGeneralInfoDraft}
              >
                삭제
              </button>
            </>
          }
        >
          {generalInfoEditingId && (
            <div className="generalInfoEditNotice">
              <strong>수정 모드</strong>
              <p>
                저장된 일반 정보를 불러왔습니다. 제목, Text, 이미지, 키워드·요약을
                수정한 뒤 [저장]을 누르세요.
              </p>
            </div>
          )}

          <label className="generalInfoFieldLabel">
            정보 제목
            <input
              value={generalInfoDraft.title}
              onChange={(e) =>
                setGeneralInfoDraft((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="제목을 입력하세요 (비우면 Text 첫 줄이 자동 반영)"
              title="직접 수정할 수 있습니다. 비어 있으면 Text 첫 줄이 제목으로 사용됩니다."
            />
            <span className="mutedText" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
              제목을 직접 수정할 수 있습니다. 비어 있으면 Text 입력 <strong>첫 줄</strong>이 자동 반영됩니다.
            </span>
          </label>

          {/* Rich Text Editor */}
          <div className="generalInfoTextBox generalInfoRichTextBox">
            <div className="generalInfoRichTextHeader">
              <div className="generalInfoSectionTitleRow">
                <strong>Text 입력 / 편집</strong>
                <button
                  type="button"
                  className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                  onClick={handleCopyGeneralInfoText}
                >
                  {copyFeedback === "text" ? "✅ 복사됨" : "📋 전체 복사"}
                </button>
              </div>
              <span>아래 큰 입력칸에 내용을 입력하세요. 줄바꿈, 띄어쓰기, 글자색, 굵게, 밑줄, 형광, 크기 편집 가능</span>
            </div>

            <CollectFormatToolbar
              onUndo={() => handleGeneralInfoRichCommand("undo")}
              onRedo={() => handleGeneralInfoRichCommand("redo")}
              onBold={() => handleGeneralInfoRichCommand("bold")}
              onUnderline={() => handleGeneralInfoRichCommand("underline")}
              onFontSize={(px) => {
                setCollectFontSizePx(px);
                handleGeneralInfoRichCommand("fontSizePx", String(px));
              }}
              onFontSizeStep={handleCollectFontSizeStep}
              onColor={(c) => handleGeneralInfoRichCommand("foreColor", c)}
              onHighlight={(c) => handleGeneralInfoRichCommand("highlight", c)}
              onInsertChar={(ch) => handleGeneralInfoRichCommand("insertText", ch)}
              onImage={() => {
                setShowTextImageInsert(true);
                window.setTimeout(() => textImageFileRef.current?.click(), 0);
              }}
              onPasteImage={() => {
                void handleCollectPasteImage();
              }}
              onTextImage={() => setShowTextToImageModal(true)}
              onHandwriting={() => setShowHandwritingModal(true)}
            />
            <input
              ref={textImageFileRef}
              type="file"
              accept="image/*,image/heic,image/heif,video/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                insertImageFilesFromTextTrigger(e.target.files);
                e.target.value = "";
              }}
            />

            <div
              key={generalInfoRichTextEditorKey}
              ref={generalInfoRichTextRef}
              className="generalInfoRichTextEditor collectPaperEditor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              onInput={checkTextImageTrigger}
              onKeyUp={checkTextImageTrigger}
              onCompositionEnd={checkTextImageTrigger}
              onBlur={(e) => {
                // 포커스가 버튼으로 이동할 때는 sync 생략 (버튼 핸들러가 직접 최신 텍스트를 읽음)
                const rel = e.relatedTarget as HTMLElement | null;
                if (rel && (rel.tagName === "BUTTON" || rel.closest?.("button"))) return;
                syncGeneralInfoRichTextToDraft();
                checkTextImageTrigger();
              }}
              onPaste={(event) => {
                const pastedFiles = collectClipboardImageFiles(event.clipboardData);
                if (pastedFiles.length > 0) {
                  event.preventDefault();
                  insertImageFilesFromTextTrigger(pastedFiles);
                  return;
                }
                handleGeneralInfoRichPaste(event);
                requestAnimationFrame(checkTextImageTrigger);
              }}
              data-placeholder="복사한 텍스트, 메모, 정리할 내용을 입력하세요."
              style={{
                display: "block",
                width: "100%",
                minHeight: 260,
                maxHeight: 560,
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

            {showTextImageInsert && (
              <div className="generalInfoTextImageInsertPanel">
                <div className="generalInfoTextImageInsertHead">
                  <strong>이미지 붙여넣기</strong>
                  <span>문자 끝 S 감지 · 본문 TEXT 안에 이미지가 들어갑니다</span>
                  <button
                    type="button"
                    className="secondaryButton smallActionButton"
                    onClick={() => {
                      removeTrailingImageTrigger();
                      setShowTextImageInsert(false);
                    }}
                  >
                    닫기
                  </button>
                </div>
                <div className="generalInfoTextImageInsertActions">
                  <label className="primaryLabel generalInfoTextImageFileLabel">
                    🖼 사진첩 · 파일 선택
                    <input
                      type="file"
                      accept="image/*,image/heic,image/heif,video/*"
                      multiple
                      onChange={(e) => {
                        insertImageFilesFromTextTrigger(e.target.files);
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
                    onPaste={handleTextImageInsertPaste}
                  >
                    📋 아이폰·PC 이미지 여기 붙여넣기 (Ctrl+V / ⌘V)
                  </div>
                </div>
              </div>
            )}

            <p className="generalInfoRichTextNote">
              저장함에는 편집된 색상/강조가 함께 표시됩니다.
              문장 끝에 <strong>S</strong>를 붙이면 이미지 붙여넣기가 열리고, 선택한 이미지는 본문 TEXT 안에 들어갑니다.
            </p>
          </div>

          <div className="generalInfoClipboardBox">
            <div>
              <strong>복사 붙여넣기 자동 수집</strong>
              <p>
                외부 앱이나 웹페이지에서 복사한 Text, 이미지를 자동으로
                일반 정보 입력칸에 반영합니다.
              </p>
            </div>
            <button
              className="secondaryButton"
              type="button"
              onClick={handleCollectGeneralInfoFromClipboard}
              disabled={isCollectingGeneralInfoClipboard}
            >
              {isCollectingGeneralInfoClipboard ? "클립보드 확인 중..." : "📋 클립보드에서 일반 정보 붙여넣기"}
            </button>
          </div>

          {/* 이미지/동영상 업로드 */}
          <div className="generalInfoUploadBox">
            <div>
              <strong>이미지 / 동영상 자료</strong>
              <p>이미지+Text, 동영상+Text 조합으로 저장할 수 있습니다.</p>
            </div>
            <label className="primaryLabel">
              이미지/동영상 선택
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(e) => handleGeneralInfoFileUpload(e.target.files)}
              />
            </label>
          </div>

          {/* 아이폰 붙여넣기 존 */}
          <div
            className="generalInfoIphonePasteZone"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            tabIndex={0}
            onPaste={handleGeneralInfoIphonePasteZonePaste}
            style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", padding: "15px", cursor: "pointer" }}
          >
            <strong>📱 아이폰 이미지 붙여넣기</strong>
          </div>

          {/* 대표 이미지 */}
          <div className="generalInfoCoverImageBox">
            <div className="generalInfoCoverImageHeader">
              <strong>대표 이미지 / 자료</strong>
              {normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0 && (
                <span className="generalInfoMediaCount">
                  총 {normalizeGeneralInfoMediaItems(generalInfoDraft).length}개
                </span>
              )}
              {normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0 ? (
                <button
                  className="secondaryButton smallActionButton"
                  type="button"
                  onClick={handleClearGeneralInfoCoverImage}
                >
                  전체 삭제
                </button>
              ) : (
                <button
                  className="secondaryButton smallActionButton"
                  type="button"
                  onClick={() => setIsSelectingCoverImage((prev) => !prev)}
                  style={{
                    borderColor: isSelectingCoverImage
                      ? "rgba(125, 211, 252, 0.55)"
                      : undefined,
                    color: isSelectingCoverImage ? "#bae6fd" : undefined,
                  }}
                >
                  {isSelectingCoverImage ? "선택 닫기" : "대표 이미지 / 자료 선택"}
                </button>
              )}
            </div>

            {normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0 ? (
              <div className="generalInfoDraftMediaGrid">
                {normalizeGeneralInfoMediaItems(generalInfoDraft).map((media, index) => {
                  const isEditingMemo = memoEditIndex === index;
                  const hasMemo = !!media.memo?.trim();
                  return (
                    <div className={`generalInfoDraftMediaCard ${index === 0 ? "representative-card" : ""}`} key={media.id || index}>
                      {index === 0 ? (
                        <div className="generalInfoDraftMediaBadge representative">
                          ★ 대표
                        </div>
                      ) : (
                        <div
                          className="generalInfoDraftMediaBadge select-representative"
                          onClick={() => handleSetMediaAsRepresentative(index)}
                          title="대표 이미지로 설정"
                        >
                          ★ 대표 설정
                        </div>
                      )}
                      {/* 이미지/동영상 — 클릭 시 메모 입력 토글 */}
                      <div
                        className="generalInfoDraftMediaThumb"
                        onClick={() => setMemoEditIndex(isEditingMemo ? null : index)}
                        title="클릭하면 메모 입력/수정"
                      >
                        {media.type === "video" ? (
                          <video src={media.preview} controls onClick={e => e.stopPropagation()} />
                        ) : generalInfoImageLoadFailed && index === 0 ? (
                          <div className="generalInfoImageFallback">
                            <strong>이미지 로드 실패</strong>
                            <p>이미지를 다시 복사해 붙여넣기로 교체하세요.</p>
                          </div>
                        ) : (
                          <img
                            src={media.preview}
                            alt={media.name || `자료 이미지 ${index + 1}`}
                            onError={() => { if (index === 0) setGeneralInfoImageLoadFailed(true); }}
                            onClick={(e) => {
                              if (!onOpenStorageImage || media.type === "video") return;
                              e.stopPropagation();
                              onOpenStorageImage(media.preview, media.name || `general_info_${index + 1}.jpg`);
                            }}
                            style={{ cursor: onOpenStorageImage ? "zoom-in" : undefined }}
                          />
                        )}
                        <div className="generalInfoDraftMediaHint">
                          {isEditingMemo ? "▲ 닫기" : (hasMemo ? "✏️ 메모 수정" : "＋ 메모 추가")}
                        </div>
                      </div>

                      {/* 메모 입력 영역 */}
                      {isEditingMemo && (
                        <div className="generalInfoMediaMemoEdit">
                          <textarea
                            className="generalInfoMediaMemoTextarea"
                            value={media.memo || ""}
                            onChange={e => handleUpdateMediaMemo(index, e.target.value)}
                            placeholder="이미지에 대한 간단한 메모를 입력하세요..."
                            rows={3}
                            autoFocus
                          />
                          <div className="generalInfoMediaMemoEditActions">
                            <button
                              type="button"
                              className="generalInfoMediaMemoBtnOk"
                              onClick={() => setMemoEditIndex(null)}
                            >
                              ✓ 완료
                            </button>
                            {hasMemo && (
                              <button
                                type="button"
                                className="generalInfoMediaMemoBtnDelete"
                                onClick={() => { handleUpdateMediaMemo(index, ""); setMemoEditIndex(null); }}
                              >
                                ✕ 메모 삭제
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 저장된 메모 표시 (편집 모드 아닐 때) */}
                      {!isEditingMemo && hasMemo && (
                        <div className="generalInfoMediaMemoDisplay">
                          <span className="generalInfoMediaMemoText">{media.memo}</span>
                          <div className="generalInfoMediaMemoActions">
                            <button
                              type="button"
                              className="generalInfoMediaMemoBtn generalInfoMediaMemoBtnEdit"
                              onClick={() => setMemoEditIndex(index)}
                              title="메모 수정"
                            >
                              (0)
                            </button>
                            <button
                              type="button"
                              className="generalInfoMediaMemoBtn generalInfoMediaMemoBtnDel"
                              onClick={() => handleUpdateMediaMemo(index, "")}
                              title="메모 삭제"
                            >
                              (-)
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 파일명 + 삭제 버튼 */}
                      <div className="generalInfoDraftMediaFooter">
                        <span className="generalInfoDraftMediaName">{media.name || `자료 이미지 ${index + 1}`}</span>
                        <button
                          className="secondaryButton smallActionButton dangerSmallButton"
                          type="button"
                          onClick={() => handleRemoveGeneralInfoMediaItem(index)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : isSelectingCoverImage ? (
              <div className="generalInfoNoCoverImage">
                <strong>대표 이미지 없음</strong>
                <p>
                  아직 이미지를 추가하지 않았습니다.
                  웹페이지나 사진앱에서 이미지를 복사한 뒤
                  [클립보드에서 일반 정보 붙여넣기]를 누르면 대표 이미지로 등록됩니다.
                  또는 아래 본문 이미지에서 선택할 수 있습니다.
                </p>
              </div>
            ) : null}

            {collectBodyImageSrcs.length > 0 &&
              (isSelectingCoverImage ||
                normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0) && (
              <div style={{ marginTop: 14 }}>
                <strong style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#7dd3fc" }}>
                  본문 이미지에서 대표 선택
                </strong>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                    gap: 10,
                  }}
                >
                  {collectBodyImageSrcs.map((src, index) => {
                    const coverItems = normalizeGeneralInfoMediaItems(generalInfoDraft);
                    const isRep =
                      coverItems[0] &&
                      (coverItems[0].preview === src || coverItems[0].fileUrl === src);
                    return (
                      <div
                        key={`collect-body-img-${index}`}
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
                            height: 96,
                            objectFit: "cover",
                          }}
                        />
                        <button
                          type="button"
                          className="secondaryButton smallActionButton"
                          style={{ width: "100%", borderRadius: 0, fontSize: 11 }}
                          disabled={Boolean(isRep)}
                          onClick={() => handleSetHtmlImageAsRepresentative(src, "본문 이미지")}
                        >
                          {isRep ? "★ 대표" : "★ 대표로 설정"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Card 2: 키워드 / 요약 */}
        <Card
          number="2"
          title="키워드 / 요약"
          subtitle="키워드와 요약을 직접 입력하세요. 입력 내용은 자동 저장됩니다."
        >
          <div className="generalInfoResultBox generalInfoKeywordInputBox">
            <strong>키워드 직접 입력</strong>
            <input
              value={generalInfoKeywordText}
              onChange={(e) => {
                const value = e.target.value;
                const parsedKeywords = Array.from(
                  new Set(
                    value
                      .split(/[,#\n]+/)
                      .map((kw) => kw.replace(/^#+/, "").trim())
                      .filter(Boolean),
                  ),
                ).slice(0, 12);
                setGeneralInfoKeywordText(value);
                setGeneralInfoDraft((prev) => ({ ...prev, keywords: parsedKeywords }));
              }}
              onFocus={() => setIsKeywordInputFocused(true)}
              onBlur={() => setIsKeywordInputFocused(false)}
              placeholder="예: #npm, #run, #dev 또는 npm, run, dev"
            />
            {isKeywordInputFocused && (
              <p className="mutedText">
                쉼표, #, 줄바꿈으로 여러 키워드를 입력할 수 있습니다. 입력창에는 원문이 유지되고, 아래 태그에는 분리되어 표시됩니다.
              </p>
            )}
          </div>

          <div className="generalInfoResultBox">
            <strong>키워드</strong>
            <div className="miniTags">
              {generalInfoDraft.keywords.length > 0 ? (
                generalInfoDraft.keywords.map((kw) => (
                  <span key={kw}>#{String(kw).replace(/^#+/, "")}</span>
                ))
              ) : (
                <span>위에서 키워드를 입력하면 표시됩니다.</span>
              )}
            </div>
          </div>

          <div className="generalInfoResultBox generalInfoEditableResultBox">
            <strong>요약</strong>
            <textarea
              className="generalInfoEditableTextarea"
              value={generalInfoDraft.summary}
              onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, summary: e.target.value }))}
              placeholder="요약 내용을 직접 입력하세요."
              rows={4}
            />
          </div>

          <div className="generalInfoActionRow">
            <button className="gradientButton" type="button" onClick={handleConfirmGeneralInfo}>
              {generalInfoEditingId ? "수정 저장" : "저장"}
            </button>
            {generalInfoEditingId && (
              <button className="secondaryButton" type="button" onClick={handleCancelEditGeneralInfo}>
                수정 취소
              </button>
            )}
          </div>
          {generalInfoAutoSaveStatus ? (
            <p className="mutedText" style={{ margin: "8px 0 0", fontSize: 12 }}>
              {generalInfoAutoSaveStatus}
            </p>
          ) : (
            <p className="mutedText" style={{ margin: "8px 0 0", fontSize: 12 }}>
              입력 내용은 이 기기에 자동 저장됩니다. [저장]을 누르면 정보 창고에 보관됩니다.
            </p>
          )}
        </Card>
      </section>
      )} {/* end activeTab === "collect" */}

      {/* ===== 정보 창고 탭 (저장함) ===== */}
      {activeTab === "storage" && (
      <aside className="rightColumn generalInfoRightColumn" style={{ position: "relative", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        {/* Scroll to Top Button */}
        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            if (window.innerWidth <= 1100) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              const listEl = e.currentTarget.parentElement?.querySelector('.generalInfoList');
              if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="맨위로"
        >맨 위로 ↑</button>
        <Card
          number="3"
          title="정보 창고"
          subtitle="저장된 정보를 분류·키워드·본문 기준으로 검색합니다."
        >
          <div className="searchBox" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                value={generalInfoSearchTerm}
                onChange={(e) => setGeneralInfoSearchTerm(e.target.value)}
                placeholder="제목, 본문, 키워드, 요약 검색"
                style={{ flex: 1 }}
              />
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  void loadGeneralInfoItemsFromSupabase();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "0 12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  borderRadius: "10px",
                  borderColor: "rgba(56, 189, 248, 0.4)",
                  background: "linear-gradient(180deg, rgba(30,41,59,0.98), rgba(15,23,42,0.98))",
                  color: "#38bdf8",
                  cursor: "pointer",
                }}
                title="Supabase에서 최신 데이터 불러오기"
              >
                🔄 동기화
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
              <p className="mutedText" style={{ margin: 0 }}>
                검색 결과 {filteredGeneralInfoItems.length}건 / 전체 {generalInfoItems.length}건
              </p>
              <span className="mutedText" style={{ fontSize: "11px", color: "#38bdf8" }}>
                {generalInfoSupabaseStatus}
              </span>
            </div>
          </div>

          {filteredGeneralInfoItems.length === 0 ? (
            <EmptyState icon="🗂️" text="저장된 일반 정보가 없습니다." />
          ) : (
            <div className="generalInfoList">
              {filteredGeneralInfoItems.map((item) => (
                <article
                  className={`generalInfoCard ${item.isPinned ? "pinned" : ""} ${generalInfoDetailId === item.id ? "active" : ""}`}
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id); }}
                >
                  {/* 이미지 — 2/5 */}
                  <div
                    className="generalInfoCardThumbnail"
                    onClick={() => (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id)}
                  >
                    {getGeneralInfoDisplayMediaItems(item).length > 0 ? (
                      <img
                        src={getGeneralInfoDisplayMediaItems(item)[0].preview}
                        alt={item.title}
                        onError={(e) => { e.currentTarget.src = "/placeholder.png"; }}
                        onClick={(e) => {
                          if (!onOpenStorageImage) return;
                          const media = getGeneralInfoDisplayMediaItems(item)[0];
                          if (!media?.preview || media.type === "video") return;
                          e.stopPropagation();
                          onOpenStorageImage(media.preview, media.name || `${item.title || "general_info"}.jpg`);
                        }}
                        style={{ cursor: onOpenStorageImage ? "zoom-in" : undefined }}
                      />
                    ) : (
                      <div className="generalInfoCardPlaceholder">📄</div>
                    )}
                  </div>

                  {/* 제목/날짜/요약 — 2/5 */}
                  <div
                    className="generalInfoCardContent"
                    onClick={() => (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id)}
                  >
                    <strong>
                      {item.isPinned && <span className="generalInfoCardPinMark">📌</span>}
                      {item.confirmed === false && (
                        <span className="generalInfoTempBadge">임시저장</span>
                      )}
                      {item.title}
                    </strong>
                    <p className="mutedText">{item.createdAt}</p>
                    <p className="cardSummary">{item.summary || "클립보드 이미지 자료"}</p>
                  </div>

                  {/* Report / Source DATA / 고정 */}
                  <div className="generalInfoCardActions">
                    {hasDisplayableAiReport(String(item.factCheckSummary || "")) && (
                      <button
                        className="generalInfoCardAiReportButton"
                        type="button"
                        title="Report"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenGeneralInfoAiReport?.(item.id);
                        }}
                      >
                        Report
                      </button>
                    )}
                    <button
                      className="generalInfoCardDetailButton"
                      type="button"
                      title="Source DATA"
                      onClick={(e) => {
                        e.stopPropagation();
                        (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id);
                      }}
                    >
                      Source DATA
                    </button>
                    <button
                      className={`generalInfoCardPinButton ${item.isPinned ? "pinned" : ""}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePinGeneralInfo(item.id);
                      }}
                      title={item.isPinned ? "고정 해제" : "상단 고정"}
                    >
                      📌
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </aside>
      )} {/* end activeTab === "storage" */}

      {showHandwritingModal && (
        <HandwritingModal
          onCancel={() => setShowHandwritingModal(false)}
          onInsert={(dataUrl) => {
            insertDataUrlIntoEditor(dataUrl, `handwriting-${Date.now()}.png`);
            setShowHandwritingModal(false);
          }}
        />
      )}
      {showTextToImageModal && (
        <TextToImageModal
          initialText={String(generalInfoRichTextRef.current?.innerText || generalInfoDraft.text || "").slice(0, 800)}
          onCancel={() => setShowTextToImageModal(false)}
          onInsert={(dataUrl) => {
            insertDataUrlIntoEditor(dataUrl, `text-image-${Date.now()}.png`);
            setShowTextToImageModal(false);
          }}
        />
      )}
    </div>
  );
}
