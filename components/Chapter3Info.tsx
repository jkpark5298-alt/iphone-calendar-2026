"use client";

/**
 * Chapter3Info.tsx
 * Chapter 3 — 일반 정보 수집 / 분류 / 저장
 * 입력: 요약 → 본문(서식) → 분류 → 키워드 → 인포그래픽
 */

import React from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { stepCollectFontSize } from "../lib/collectFormatPalette";
import {
  enhanceRichInlineImages,
  findAwaitingSlotId,
  insertImagesAtSlotOrCaret,
} from "../lib/richImageSlots";
import { readClipboardImageFiles } from "../lib/collectRichFormat";
import { extractFirstSentence, categoryKeywordsList, formatCategoryKeywords } from "../lib/generalInfoText";
import { extractGeneralInfoBodyImageSrcs, isUsableGeneralInfoCoverSrc, getGeneralInfoInfographicItems } from "../lib/generalInfoHelpers";
import {
  extractInstagramUrls,
  INSTAGRAM_POST_URL_HINT,
  isInstagramHomeOrAccountUrl,
  isInstagramHostText,
} from "../lib/instagramMeta";
import { htmlForActiveEditor, isParagraphEmpty } from "../lib/generalInfoParagraphs";
import { Card } from "./SharedComponents";
import { CollectFormatToolbar } from "./CollectFormatToolbar";
import { HandwritingModal } from "./HandwritingModal";
import { TextToImageModal } from "./TextToImageModal";
import { InfoIndexPanel } from "./InfoIndexPanel";
import { openExternalApp, type ExternalAppTarget } from "../lib/openExternalApp";

export interface Chapter3InfoProps {
  generalInfoActiveTab: "storage" | "collect";
  setGeneralInfoActiveTab: React.Dispatch<React.SetStateAction<"storage" | "collect">>;

  generalInfoDraft: GeneralInfoDraft;
  setGeneralInfoDraft: React.Dispatch<React.SetStateAction<GeneralInfoDraft>>;
  generalInfoEditingId: number | null;
  setGeneralInfoKeywordText: (value: string) => void;

  generalInfoRichTextEditorKey: number;
  generalInfoRichTextRef: React.RefObject<HTMLDivElement | null>;
  generalInfoRichTextInitialHtml: string;
  syncGeneralInfoRichTextToDraft: () => void;
  handleGeneralInfoRichPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  handleGeneralInfoRichCommand: (command: string, value?: string) => void;
  handleGeneralInfoRichInput: () => void;
  handleGeneralInfoRichEditorClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleGeneralInfoRichImagePick: (files: FileList | null) => void;
  handleGeneralInfoInsertImageSlot: () => void;
  getGeneralInfoToolbarButtonStyle: () => React.CSSProperties;

  handleResetGeneralInfoDraft: () => void;
  handleUndoGeneralInfoDraft: () => void;
  generalInfoDraftBackup: GeneralInfoDraft | null;
  handleAddGeneralInfoParagraph: () => void;
  handleRemoveGeneralInfoParagraph: (paragraphId: string) => void;
  handleGeneralInfoFileUpload: (files: FileList | null) => void;
  handleClearGeneralInfoCoverImage: () => void;
  handleClearGeneralInfoInfographics: () => void;
  handleRemoveGeneralInfoMediaItem: (index: number) => void;
  handleConfirmGeneralInfo: (overrides?: {
    title?: string;
    primaryCategory?: string;
    secondaryCategory?: string;
  }) => void;
  handleExtractGeneralInfoUrl: (rawUrl?: string, force?: boolean) => void;
  isExtractingGeneralInfoUrl: boolean;
  generalInfoUrlMeta: {
    url: string;
    title: string;
    description: string;
    image: string;
    siteName: string;
    text: string;
  } | null;
  generalInfoUrlNotice: string;
  handleSaveTemporaryGeneralInfoDraft: () => void;
  handleCancelEditGeneralInfo: () => void;
  handleStartNewGeneralInfo: () => void;
  confirmLeaveGeneralInfoCollect: () => boolean;
  generalInfoDeleteUndo: GeneralInfoItem | null;
  handleUndoDeleteGeneralInfo: () => void;
  handleStartEditGeneralInfo: (item: GeneralInfoItem) => void;
  handleDeleteGeneralInfo: (itemId: number) => void;

  handleImportGeneralInfoAppFile: (files: FileList | null) => Promise<string | void> | string | void;
  handleExportGeneralInfoAppBundle: () => string | void;
  handleExportSelectedGeneralInfoAppFiles: (input: {
    savedIds: number[];
    commitTempDraft: boolean;
  }) => Promise<string | void>;
  handleOpenGeneralInfoTempDraft: () => void;

  generalInfoItems: GeneralInfoItem[];
  filteredGeneralInfoItems: GeneralInfoItem[];
  generalInfoSearchTerm: string;
  setGeneralInfoSearchTerm: (value: string) => void;
  generalInfoDetailId: number | null;
  setGeneralInfoDetailId: (id: number | null) => void;
  handleTogglePinGeneralInfo: (itemId: number) => void;
  loadGeneralInfoItemsFromSupabase: () => Promise<void>;
  generalInfoSupabaseStatus: string;

  generalInfoCategories: string[];
  normalizeGeneralInfoMediaItems: (draft: GeneralInfoDraft) => GeneralInfoMediaItem[];
  getGeneralInfoDisplayMediaItems: (item: GeneralInfoItem) => GeneralInfoMediaItem[];
}

export function Chapter3Info({
  generalInfoActiveTab,
  setGeneralInfoActiveTab,
  generalInfoDraft,
  setGeneralInfoDraft,
  generalInfoEditingId,
  setGeneralInfoKeywordText,
  generalInfoRichTextEditorKey,
  generalInfoRichTextRef,
  generalInfoRichTextInitialHtml,
  syncGeneralInfoRichTextToDraft,
  handleGeneralInfoRichPaste,
  handleGeneralInfoRichCommand,
  handleGeneralInfoRichInput,
  handleGeneralInfoRichEditorClick,
  handleGeneralInfoRichImagePick,
  handleGeneralInfoInsertImageSlot,
  getGeneralInfoToolbarButtonStyle,
  handleResetGeneralInfoDraft,
  handleUndoGeneralInfoDraft,
  generalInfoDraftBackup,
  handleAddGeneralInfoParagraph,
  handleRemoveGeneralInfoParagraph,
  handleGeneralInfoFileUpload,
  handleClearGeneralInfoCoverImage,
  handleClearGeneralInfoInfographics,
  handleRemoveGeneralInfoMediaItem,
  handleConfirmGeneralInfo,
  handleExtractGeneralInfoUrl,
  isExtractingGeneralInfoUrl,
  generalInfoUrlMeta,
  generalInfoUrlNotice,
  handleSaveTemporaryGeneralInfoDraft,
  handleCancelEditGeneralInfo,
  handleStartNewGeneralInfo,
  confirmLeaveGeneralInfoCollect,
  generalInfoDeleteUndo,
  handleUndoDeleteGeneralInfo,
  handleStartEditGeneralInfo: _handleStartEditGeneralInfo,
  handleDeleteGeneralInfo: _handleDeleteGeneralInfo,
  handleImportGeneralInfoAppFile,
  handleExportGeneralInfoAppBundle,
  handleExportSelectedGeneralInfoAppFiles,
  handleOpenGeneralInfoTempDraft,
  generalInfoItems,
  filteredGeneralInfoItems: _filteredGeneralInfoItems,
  generalInfoSearchTerm: _generalInfoSearchTerm,
  setGeneralInfoSearchTerm: _setGeneralInfoSearchTerm,
  generalInfoDetailId: _generalInfoDetailId,
  setGeneralInfoDetailId,
  handleTogglePinGeneralInfo,
  loadGeneralInfoItemsFromSupabase: _loadGeneralInfoItemsFromSupabase,
  generalInfoSupabaseStatus,
  generalInfoCategories,
  normalizeGeneralInfoMediaItems: _normalizeGeneralInfoMediaItems,
  getGeneralInfoDisplayMediaItems: _getGeneralInfoDisplayMediaItems,
}: Chapter3InfoProps) {
  const activeTab = generalInfoActiveTab;
  const setActiveTab = setGeneralInfoActiveTab;
  const generalInfoImageFileRef = React.useRef<HTMLInputElement | null>(null);
  const infographicFileRef = React.useRef<HTMLInputElement | null>(null);
  const [showHandwritingModal, setShowHandwritingModal] = React.useState(false);
  const [showTextToImageModal, setShowTextToImageModal] = React.useState(false);
  const [collectFontSizePx, setCollectFontSizePx] = React.useState(15);
  const [showMoreCollectActions, setShowMoreCollectActions] = React.useState(false);
  const [indexComposeOpen, setIndexComposeOpen] = React.useState(false);
  const [copyBodyState, setCopyBodyState] = React.useState("");
  const [imageSlotPrompt, setImageSlotPrompt] = React.useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = React.useState(0);

  const bodyPlain = String(generalInfoDraft.text || "").trim();
  const infographicTitle = extractFirstSentence(bodyPlain) || "본문 첫 문장이 제목으로 사용됩니다";

  const mediaItems = getGeneralInfoInfographicItems(
    generalInfoDraft,
    String(generalInfoRichTextRef.current?.innerHTML || ""),
  );
  const bodyImageSrcs = React.useMemo(() => {
    const liveHtml = String(generalInfoRichTextRef.current?.innerHTML || "");
    const draftHtml = String(generalInfoDraft.formattedTextHtml || "");
    const paragraphHtml = (Array.isArray(generalInfoDraft.paragraphs)
      ? generalInfoDraft.paragraphs
      : []
    ).map((paragraph) => String(paragraph.html || ""));
    return extractGeneralInfoBodyImageSrcs(liveHtml, draftHtml, ...paragraphHtml).filter(
      isUsableGeneralInfoCoverSrc,
    );
  }, [
    generalInfoDraft.formattedTextHtml,
    generalInfoDraft.paragraphs,
    generalInfoDraft.text,
    generalInfoRichTextEditorKey,
    generalInfoRichTextRef,
  ]);

  const selectedCover = String(generalInfoDraft.filePreview || "").trim();
  const paragraphs = Array.isArray(generalInfoDraft.paragraphs)
    ? generalInfoDraft.paragraphs
    : [];
  const activeParagraph = paragraphs[0];
  const olderParagraphs = paragraphs.slice(1);

  const handleSelectBodyCover = React.useCallback(
    (src: string) => {
      setGeneralInfoDraft((prev) => ({
        ...prev,
        filePreview: src,
        fileType: "image",
        fileName: prev.fileName || "본문 대표 이미지",
      }));
    },
    [setGeneralInfoDraft],
  );

  React.useEffect(() => {
    if (!bodyImageSrcs.length) return;
    const current = String(generalInfoDraft.filePreview || "").trim();
    if (current && bodyImageSrcs.includes(current)) return;
    handleSelectBodyCover(bodyImageSrcs[0]);
  }, [bodyImageSrcs, generalInfoDraft.filePreview, handleSelectBodyCover]);

  const handleCopyEntireBody = React.useCallback(async () => {
    const editor = generalInfoRichTextRef.current;
    const liveHtml = String(editor?.innerHTML || "").trim();
    const liveText = String(editor?.innerText || "").replace(/\u00a0/g, " ").trim();
    const olderHtml = olderParagraphs
      .map((paragraph) => String(paragraph.html || "").trim())
      .filter(Boolean);
    const olderText = olderParagraphs
      .map((paragraph) =>
        String(paragraph.text || paragraph.html || "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    const html = [liveHtml, ...olderHtml].filter(Boolean).join("");
    const text = [liveText, ...olderText].filter(Boolean).join("\n\n");
    if (!html && !text) {
      setCopyBodyState("복사할 본문이 없습니다.");
      return;
    }
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html || text], { type: "text/html" }),
            "text/plain": new Blob([text || html.replace(/<[^>]+>/g, " ")], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text || html.replace(/<[^>]+>/g, " ").trim());
      }
      setCopyBodyState("본문을 복사했습니다.");
    } catch {
      try {
        await navigator.clipboard.writeText(text || html.replace(/<[^>]+>/g, " ").trim());
        setCopyBodyState("본문을 복사했습니다.");
      } catch {
        setCopyBodyState("복사하지 못했습니다.");
      }
    }
  }, [generalInfoRichTextRef, olderParagraphs]);

  const insertDataUrlIntoEditor = React.useCallback(
    (dataUrl: string) => {
      const editor = generalInfoRichTextRef.current;
      if (!editor || !dataUrl) return;
      editor.focus();
      enhanceRichInlineImages(editor);
      const inserted = insertImagesAtSlotOrCaret(editor, [{ src: dataUrl }]);
      if (inserted) enhanceRichInlineImages(editor);
      syncGeneralInfoRichTextToDraft();
    },
    [generalInfoRichTextRef, syncGeneralInfoRichTextToDraft],
  );

  const handleCollectPasteImage = React.useCallback(async () => {
    try {
      const files = await readClipboardImageFiles();
      if (!files.length) {
        alert("클립보드에서 이미지를 찾지 못했습니다. 이미지를 복사한 뒤 다시 눌러 주세요.");
        return;
      }
      const list = new DataTransfer();
      files.forEach((f) => list.items.add(f));
      handleGeneralInfoRichImagePick(list.files);
    } catch {
      alert("클립보드 이미지 읽기를 지원하지 않습니다. 본문에 직접 붙여넣기 하세요.");
    }
  }, [handleGeneralInfoRichImagePick]);

  const handleCollectFontSizeStep = React.useCallback(
    (delta: number) => {
      const next = stepCollectFontSize(collectFontSizePx, delta);
      setCollectFontSizePx(next);
      handleGeneralInfoRichCommand("fontSizePx", String(next));
    },
    [collectFontSizePx, handleGeneralInfoRichCommand],
  );

  React.useEffect(() => {
    if (!imageSlotPrompt) {
      setKeyboardInset(0);
      return;
    }
    const update = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        setKeyboardInset(0);
        return;
      }
      setKeyboardInset(Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop)));
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [imageSlotPrompt]);

  const noteNewImageSlot = React.useCallback(() => {
    const id = findAwaitingSlotId(generalInfoRichTextRef.current);
    if (id) setImageSlotPrompt(id);
  }, [generalInfoRichTextRef]);

  const handleCollectEditorInput = React.useCallback(() => {
    const before = findAwaitingSlotId(generalInfoRichTextRef.current);
    handleGeneralInfoRichInput();
    const after = findAwaitingSlotId(generalInfoRichTextRef.current);
    if (after && after !== before) setImageSlotPrompt(after);
  }, [generalInfoRichTextRef, handleGeneralInfoRichInput]);

  const handleCollectEditorClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      handleGeneralInfoRichEditorClick(event);
      const slot = (event.target as HTMLElement).closest?.(".rich-img-slot");
      const id = slot?.getAttribute("data-img-slot");
      if (id) setImageSlotPrompt(id);
    },
    [handleGeneralInfoRichEditorClick],
  );

  const fillSlotFromFiles = React.useCallback(
    (files: FileList | null) => {
      const chosen = Array.from(files || []);
      const images = chosen.filter((file) => {
        if (file.type.startsWith("image/")) return true;
        return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name);
      });
      if (chosen.length && !images.length) {
        alert("이미지 파일만 넣을 수 있습니다.");
        return;
      }
      if (!images.length) return;
      const transfer = new DataTransfer();
      images.forEach((file) => transfer.items.add(file));
      handleGeneralInfoRichImagePick(transfer.files);
      setImageSlotPrompt(null);
    },
    [handleGeneralInfoRichImagePick],
  );

  React.useLayoutEffect(() => {
    const el = generalInfoRichTextRef.current;
    if (!el) return;
    const next = htmlForActiveEditor(generalInfoRichTextInitialHtml || "");
    if (el.innerHTML !== next) {
      el.innerHTML = next;
    }
    enhanceRichInlineImages(el);
  }, [generalInfoRichTextEditorKey, generalInfoRichTextInitialHtml, generalInfoRichTextRef]);

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
      <div className="ch3TabBar">
        <div className="infoIndexTabWithAdd">
          <button
            type="button"
            className={`ch3TabBtn ${activeTab === "storage" ? "active" : ""}`}
            onClick={() => {
              if (!confirmLeaveGeneralInfoCollect()) return;
              setActiveTab("storage");
            }}
          >
            정보 인덱스
          </button>
          <button
            type="button"
            className="infoIndexPlusBtn"
            aria-label="인덱스 입력"
            title="인덱스 입력"
            onClick={() => {
              if (!confirmLeaveGeneralInfoCollect()) return;
              setActiveTab("storage");
              setIndexComposeOpen(true);
            }}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className={`ch3TabBtn ${activeTab === "collect" ? "active" : ""}`}
          onClick={handleStartNewGeneralInfo}
        >
          일반 정보 수집
        </button>
      </div>

      {activeTab === "collect" && (
        <section
          className="leftColumn generalInfoLeftColumn"
          style={{ position: "relative", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
        >
          <button
            type="button"
            className="scroll-to-top-btn"
            onClick={(e) => {
              if (window.innerWidth <= 1100) {
                window.scrollTo({ top: 0, behavior: "smooth" });
              } else {
                e.currentTarget.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            title="맨위로"
          >
            맨 위로 ↑
          </button>

          <div className="chapterTitleBox" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>일반 정보 수집</h2>
            <p style={{ margin: "6px 0 0" }}>
              본문을 먼저 작성하고, 분류·제목은 정보 인덱스와 같은 칸으로 입력합니다. 저장하면 정보 인덱스에 올라갑니다.
            </p>
          </div>

          <Card number="1" title="일반 정보 입력" subtitle="본문 단락에 글·사진·Instagram URL 메타보기를 넣습니다.">
            <div className="collectPcLayout">
            <div className="collectPcBody">
            {generalInfoEditingId && (
              <div className="generalInfoEditNotice">
                <strong>수정 모드</strong>
                <p>지금 화면은 저장된 글을 고치는 중입니다. 새로 쓰려면 새 입력을 누르세요.</p>
                <button
                  type="button"
                  className="primaryButton"
                  style={{ marginTop: 8 }}
                  onClick={handleStartNewGeneralInfo}
                >
                  새 정보 입력
                </button>
              </div>
            )}

            <div className="generalInfoResultBox generalInfoEditableResultBox collectSummaryBox">
              <strong>요약</strong>
              <textarea
                className="generalInfoEditableTextarea collectSummaryEditor"
                value={generalInfoDraft.summary}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, summary: e.target.value }))}
                placeholder="직접 작성하세요. 자동으로 채우지 않습니다."
                rows={4}
              />
            </div>

            <div className="generalInfoTextBox generalInfoRichTextBox" style={{ marginTop: 14 }}>
              <div className="generalInfoRichTextHeader">
                <strong>본문 단락</strong>
                <span>새 단락은 위에 작성 · 이전 단락은 아래로 이동 · 사진은 본문에 붙여넣거나 이미지 버튼으로 넣기</span>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", marginBottom: 6 }}>
                  Instagram URL
                  <input
                    value={generalInfoDraft.sourceUrl}
                    onChange={(e) =>
                      setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: e.target.value }))
                    }
                    placeholder="https://www.instagram.com/p/…"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text") || "";
                      if (
                        extractInstagramUrls(text).length > 0 ||
                        isInstagramHostText(text)
                      ) {
                        e.preventDefault();
                        void handleExtractGeneralInfoUrl(text);
                      }
                    }}
                    onBlur={(e) => {
                      const text = e.currentTarget.value;
                      if (extractInstagramUrls(text).length > 0) {
                        void handleExtractGeneralInfoUrl(text);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleExtractGeneralInfoUrl(generalInfoDraft.sourceUrl, true);
                      }
                    }}
                  />
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    className="primaryButton"
                    disabled={isExtractingGeneralInfoUrl}
                    onClick={() => handleExtractGeneralInfoUrl(generalInfoDraft.sourceUrl, true)}
                  >
                    {isExtractingGeneralInfoUrl ? "가져오는 중..." : "메타 보기"}
                  </button>
                  {Boolean(generalInfoDraft.sourceUrl.trim()) && (
                    <button
                      type="button"
                      className="secondaryButton"
                      onClick={() => {
                        const raw = generalInfoDraft.sourceUrl.trim();
                        const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                        window.open(href, "_blank", "noopener,noreferrer");
                      }}
                    >
                      원문 열기
                    </button>
                  )}
                </div>
                {(generalInfoUrlNotice || isInstagramHomeOrAccountUrl(generalInfoDraft.sourceUrl)) && (
                  <p
                    className="mutedText"
                    style={{
                      margin: "10px 0 0",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      background: "rgba(245, 158, 11, 0.12)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {generalInfoUrlNotice || INSTAGRAM_POST_URL_HINT}
                  </p>
                )}
                {generalInfoUrlMeta && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(148,163,184,0.28)",
                      background: "rgba(15,23,42,0.28)",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: 8 }}>메타 미리보기</strong>
                    {generalInfoUrlMeta.image && (
                      <img
                        src={generalInfoUrlMeta.image}
                        alt={generalInfoUrlMeta.title || "미리보기"}
                        style={{
                          width: "100%",
                          maxHeight: 220,
                          objectFit: "contain",
                          borderRadius: 10,
                          background: "rgba(2,6,23,0.4)",
                          marginBottom: 8,
                        }}
                      />
                    )}
                    <p style={{ margin: "0 0 4px" }}>
                      {generalInfoUrlMeta.title || generalInfoUrlMeta.siteName || "제목 없음"}
                    </p>
                    <p className="mutedText" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                      {generalInfoUrlMeta.description || generalInfoUrlMeta.text || "설명 없음"}
                    </p>
                  </div>
                )}
              </div>

              <div className="collectFormatSlotRow" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="primaryButton"
                  onClick={handleAddGeneralInfoParagraph}
                  style={{ minHeight: 36 }}
                >
                  단락 추가
                </button>
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => void handleCopyEntireBody()}
                  style={{ minHeight: 36 }}
                >
                  본문 전체 복사
                </button>
                {(
                  [
                    ["gemini", "제미나이"],
                    ["daglo", "다글로"],
                    ["chatgpt", "ChatGPT"],
                  ] as const
                ).map(([target, label]) => (
                  <button
                    key={target}
                    type="button"
                    className="secondaryButton"
                    onClick={() => openExternalApp(target as ExternalAppTarget)}
                    style={{ minHeight: 36 }}
                    title={`${label} 앱으로 이동`}
                  >
                    {label}
                  </button>
                ))}
                <span className="mutedText" style={{ fontSize: 12 }}>
                  작성 {activeParagraph?.createdAt || "지금"}
                  {copyBodyState ? ` · ${copyBodyState}` : ""}
                </span>
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
                onImage={() => generalInfoImageFileRef.current?.click()}
                onPasteImage={() => {
                  void handleCollectPasteImage();
                }}
                onTextImage={() => setShowTextToImageModal(true)}
                onHandwriting={() => setShowHandwritingModal(true)}
              />
              <p className="mutedText collectImageSourceHint">사진보관함과 파일 선택에서 사진을 여러 장 고르면 모두 본문에 들어갑니다.</p>
              <div className="collectImageSourceRow">
                <label className="collectImageSourceBtn">
                  사진보관함
                  <input
                    ref={generalInfoImageFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    title="사진보관함에서 여러 장을 선택할 수 있습니다"
                    onChange={(e) => {
                      handleGeneralInfoRichImagePick(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="collectImageSourceBtn">
                  파일 선택
                  <input
                    type="file"
                    accept="image/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.bmp,.tif,.tiff"
                    multiple
                    title="파일에서 여러 장을 선택할 수 있습니다"
                    onChange={(e) => {
                      const chosen = Array.from(e.target.files || []);
                      const images = chosen.filter((file) => {
                        if (file.type.startsWith("image/")) return true;
                        return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name);
                      });
                      if (chosen.length && !images.length) {
                        alert("이미지 파일만 넣을 수 있습니다.");
                      } else if (images.length) {
                        const transfer = new DataTransfer();
                        images.forEach((file) => transfer.items.add(file));
                        handleGeneralInfoRichImagePick(transfer.files);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <div className="collectFormatSlotRow">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    handleGeneralInfoInsertImageSlot();
                    noteNewImageSlot();
                  }}
                  title="이미지 칸 추가"
                >
                  ＋ 칸
                </button>
                <button
                  type="button"
                  style={getGeneralInfoToolbarButtonStyle()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleGeneralInfoRichCommand("removeFormat")}
                >
                  서식 지우기
                </button>
              </div>
              <div
                key={generalInfoRichTextEditorKey}
                ref={generalInfoRichTextRef}
                className="generalInfoRichTextEditor collectPaperEditor"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                tabIndex={0}
                data-paragraph-id={activeParagraph?.id || ""}
                onBlur={(e) => {
                  const rel = e.relatedTarget as HTMLElement | null;
                  if (rel && (rel.tagName === "BUTTON" || rel.closest?.("button"))) return;
                  syncGeneralInfoRichTextToDraft();
                }}
                onPaste={(event) => {
                  const hasImage = Array.from(event.clipboardData?.files || []).some((file) =>
                    file.type.startsWith("image/"),
                  );
                  handleGeneralInfoRichPaste(event);
                  if (hasImage) setImageSlotPrompt(null);
                }}
                onInput={handleCollectEditorInput}
                onClick={handleCollectEditorClick}
                data-placeholder="새 항목을 입력하거나 붙여넣으세요."
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 220,
                  height: "auto",
                  maxHeight: "none",
                  overflowX: "hidden",
                  overflowY: "visible",
                  overflowWrap: "anywhere",
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

              {imageSlotPrompt ? (
                <div
                  className="collectSlotImagePanel"
                  role="dialog"
                  aria-label={`${imageSlotPrompt} 이미지 넣기`}
                  style={{ bottom: keyboardInset + 8 }}
                >
                  <div className="collectSlotImagePanelHead">
                    <strong>{imageSlotPrompt}</strong>
                    <span>여러 장을 고르면 이 칸부터 모두 들어갑니다. 복사한 사진은 본문에 붙여넣어도 됩니다.</span>
                    <button type="button" className="secondaryButton" onClick={() => setImageSlotPrompt(null)}>
                      닫기
                    </button>
                  </div>
                  <div className="collectImageSourceRow">
                    <label className="collectImageSourceBtn">
                      사진보관함
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        title="사진보관함에서 여러 장을 선택할 수 있습니다"
                        onChange={(event) => {
                          fillSlotFromFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <label className="collectImageSourceBtn">
                      파일 선택
                      <input
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.bmp,.tif,.tiff"
                        multiple
                        title="파일에서 여러 장을 선택할 수 있습니다"
                        onChange={(event) => {
                          fillSlotFromFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {olderParagraphs.length > 0 && (
                <div className="giParagraphList" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  {olderParagraphs.map((paragraph, index) => (
                    <article
                      key={paragraph.id}
                      className="giParagraphCard"
                      style={{
                        border: "1px solid rgba(148,163,184,0.25)",
                        borderRadius: 12,
                        padding: 12,
                        background: "rgba(15,23,42,0.35)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>작성 {paragraph.createdAt}</strong>
                        <button
                          type="button"
                          className="secondaryButton smallActionButton dangerSmallButton"
                          onClick={() => handleRemoveGeneralInfoParagraph(paragraph.id)}
                        >
                          삭제
                        </button>
                      </div>
                      <div
                        className="generalInfoFormattedTextView"
                        dangerouslySetInnerHTML={{
                          __html: paragraph.html || "<p></p>",
                        }}
                      />
                      {isParagraphEmpty(paragraph) && (
                        <p className="mutedText" style={{ margin: 0 }}>빈 단락</p>
                      )}
                      <p className="mutedText" style={{ margin: "8px 0 0", fontSize: 11 }}>
                        이전 단락 {index + 1}
                      </p>
                    </article>
                  ))}
                </div>
              )}

              </div>
            </div>

            <div className="collectPcSide">
              <div className="generalInfoResultBox" style={{ marginTop: 0 }}>
                <strong>분류 · 제목</strong>
                <div className="infoIndexCollectMetaRow">
                  <label>
                    분류
                    <select
                      value={generalInfoDraft.primaryCategory}
                      onChange={(e) =>
                        setGeneralInfoDraft((prev) => ({
                          ...prev,
                          primaryCategory: e.target.value,
                        }))
                      }
                    >
                      <option value="">선택</option>
                      {generalInfoCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                      {generalInfoDraft.primaryCategory &&
                        !generalInfoCategories.includes(generalInfoDraft.primaryCategory) && (
                          <option value={generalInfoDraft.primaryCategory}>
                            {generalInfoDraft.primaryCategory}
                          </option>
                        )}
                    </select>
                  </label>
                  <label>
                    제목
                    <input
                      value={generalInfoDraft.title}
                      onChange={(e) =>
                        setGeneralInfoDraft((prev) => ({ ...prev, title: e.target.value }))
                      }
                      placeholder="제목을 입력하세요"
                    />
                  </label>
                </div>
                <label style={{ display: "block", marginTop: 10 }}>
                  태그
                  <input
                    className="generalInfoEditableInput"
                    value={generalInfoDraft.secondaryCategory}
                    onChange={(e) =>
                      setGeneralInfoDraft((prev) => ({
                        ...prev,
                        secondaryCategory: e.target.value,
                      }))
                    }
                    placeholder="예: 우주, 과학"
                  />
                </label>
                <p className="mutedText" style={{ margin: "8px 0 0" }}>
                  {generalInfoDraft.primaryCategory || generalInfoDraft.secondaryCategory
                    ? formatCategoryKeywords(
                        generalInfoDraft.primaryCategory,
                        generalInfoDraft.secondaryCategory,
                      )
                    : "분류·태그를 넣으면 정보 인덱스에 같은 칸으로 표시됩니다."}
                </p>
              </div>

            <div className="generalInfoCoverImageBox" style={{ marginTop: 14 }}>
              <div className="generalInfoCoverImageHeader">
                <strong>정보 인덱스 대표 이미지</strong>
              </div>
              <p className="mutedText" style={{ margin: "0 0 10px" }}>
                본문에 넣은 이미지 중 하나를 선택합니다. 정보 인덱스 우선 표시용 썸네일로 사용됩니다.
              </p>
              {bodyImageSrcs.length === 0 ? (
                <div className="generalInfoNoCoverImage">
                  <strong>본문 이미지 없음</strong>
                  <p>본문에 이미지를 붙여넣거나 추가하면 여기서 대표 이미지를 고를 수 있습니다.</p>
                </div>
              ) : (
                <div className="generalInfoDraftMediaGrid">
                  {bodyImageSrcs.map((src, index) => {
                    const isSelected = selectedCover === src || (!selectedCover && index === 0);
                    return (
                      <div
                        className={`generalInfoDraftMediaCard ${isSelected ? "representative-card" : ""}`}
                        key={`${index}-${src.slice(0, 48)}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectBodyCover(src)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") handleSelectBodyCover(src);
                        }}
                      >
                        {isSelected && (
                          <div className="generalInfoDraftMediaBadge representative">★ 대표</div>
                        )}
                        {!isSelected && (
                          <div className="generalInfoDraftMediaBadge select-representative">
                            ★ 대표 설정
                          </div>
                        )}
                        <div className="generalInfoDraftMediaThumb">
                          <img src={src} alt={`본문 이미지 ${index + 1}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <details className="generalInfoUploadBox" style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer" }}>
                <strong>인포그래픽 (선택)</strong>
                {mediaItems.length > 0 ? ` · ${mediaItems.length}개` : ""}
              </summary>
              <p className="mutedText" style={{ marginTop: 8 }}>
                제목: <em>{infographicTitle}</em>
                <br />
                차트·도표만 여기에 올립니다. 일반 사진은 위 본문에 붙여넣거나 이미지 버튼으로 넣으세요.
              </p>
              <label className="primaryLabel">
                이미지 선택
                <input
                  ref={infographicFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    handleGeneralInfoFileUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </details>

            {mediaItems.length > 0 && (
              <div className="generalInfoCoverImageBox" style={{ marginTop: 10 }}>
                <div className="generalInfoCoverImageHeader">
                  <strong>인포그래픽 {mediaItems.length}개</strong>
                  <button
                    className="secondaryButton smallActionButton"
                    type="button"
                    onClick={handleClearGeneralInfoInfographics}
                  >
                    전체 삭제
                  </button>
                </div>
                <div className="generalInfoDraftMediaGrid">
                  {mediaItems.map((media, index) => (
                    <div className="generalInfoDraftMediaCard" key={media.id || index}>
                      <div className="generalInfoDraftMediaThumb">
                        {media.type === "video" ? (
                          <video src={media.preview} controls />
                        ) : (
                          <img src={media.preview} alt={media.name || `인포그래픽 ${index + 1}`} />
                        )}
                      </div>
                      <div className="generalInfoDraftMediaFooter">
                        <span className="generalInfoDraftMediaName">
                          {media.memo || media.name || extractFirstSentence(bodyPlain) || `인포그래픽 ${index + 1}`}
                        </span>
                        <button
                          className="secondaryButton smallActionButton dangerSmallButton"
                          type="button"
                          onClick={() => handleRemoveGeneralInfoMediaItem(index)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="generalInfoActionRow" style={{ marginTop: 16, flexWrap: "wrap", gap: 8 }}>
              <button
                className="gradientButton"
                type="button"
                onClick={() => {
                  syncGeneralInfoRichTextToDraft();
                  const title =
                    generalInfoDraft.title.trim() ||
                    extractFirstSentence(bodyPlain) ||
                    "";
                  const nextKeywords = categoryKeywordsList(
                    generalInfoDraft.primaryCategory,
                    generalInfoDraft.secondaryCategory,
                  );
                  setGeneralInfoKeywordText(
                    formatCategoryKeywords(
                      generalInfoDraft.primaryCategory,
                      generalInfoDraft.secondaryCategory,
                    ),
                  );
                  setGeneralInfoDraft((prev) => ({
                    ...prev,
                    title,
                    keywords: nextKeywords,
                  }));
                  void handleConfirmGeneralInfo({
                    title,
                    primaryCategory: generalInfoDraft.primaryCategory,
                    secondaryCategory: generalInfoDraft.secondaryCategory,
                  });
                }}
              >
                {generalInfoEditingId ? "수정 저장" : "저장"}
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  if (generalInfoEditingId) {
                    handleCancelEditGeneralInfo();
                    return;
                  }
                  if (!confirmLeaveGeneralInfoCollect()) return;
                  setActiveTab("storage");
                }}
              >
                취소
              </button>
              {generalInfoDraftBackup && (
                <button className="secondaryButton" type="button" onClick={handleUndoGeneralInfoDraft}>
                  되돌리기
                </button>
              )}
              <button
                className="secondaryButton"
                type="button"
                onClick={() => setShowMoreCollectActions((prev) => !prev)}
              >
                {showMoreCollectActions ? "더보기 닫기" : "더보기"}
              </button>
            </div>
            {showMoreCollectActions && (
              <div className="generalInfoActionRow" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={handleSaveTemporaryGeneralInfoDraft}
                >
                  임시 저장
                </button>
                <button className="dangerButton" type="button" onClick={handleResetGeneralInfoDraft}>
                  입력 삭제
                </button>
              </div>
            )}
            </div>
            </div>
          </Card>
        </section>
      )}

      {activeTab === "storage" && (
        <aside
          className="rightColumn generalInfoRightColumn"
          style={{ position: "relative", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
        >
          <button
            type="button"
            className="scroll-to-top-btn"
            onClick={(e) => {
              if (window.innerWidth <= 1100) {
                window.scrollTo({ top: 0, behavior: "smooth" });
              } else {
                const listEl = e.currentTarget.parentElement?.querySelector(".generalInfoList");
                if (listEl) listEl.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            title="맨위로"
          >
            맨 위로 ↑
          </button>
          {generalInfoDeleteUndo && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(122,184,255,0.12)",
                flexWrap: "wrap",
              }}
            >
              <span className="mutedText" style={{ fontSize: 13 }}>
                방금 삭제한 “{generalInfoDeleteUndo.title || "제목 없음"}”을 되돌릴 수 있습니다.
              </span>
              <button className="secondaryButton" type="button" onClick={handleUndoDeleteGeneralInfo}>
                되돌리기
              </button>
            </div>
          )}
          <InfoIndexPanel
            localItems={generalInfoItems}
            localStatus={generalInfoSupabaseStatus}
            onOpenLocalDetail={setGeneralInfoDetailId}
            onToggleLocalPin={handleTogglePinGeneralInfo}
            onExportLocalAppFiles={handleExportGeneralInfoAppBundle}
            onExportSelectedAppFiles={handleExportSelectedGeneralInfoAppFiles}
            onImportLocalAppFiles={handleImportGeneralInfoAppFile}
            onOpenTempDraft={handleOpenGeneralInfoTempDraft}
            composeOpen={indexComposeOpen}
            onComposeOpenChange={setIndexComposeOpen}
          />
        </aside>
      )}

      {showHandwritingModal && (
        <HandwritingModal
          onCancel={() => setShowHandwritingModal(false)}
          onInsert={(dataUrl) => {
            insertDataUrlIntoEditor(dataUrl);
            setShowHandwritingModal(false);
          }}
        />
      )}
      {showTextToImageModal && (
        <TextToImageModal
          initialText={String(generalInfoRichTextRef.current?.innerText || generalInfoDraft.text || "").slice(0, 800)}
          onCancel={() => setShowTextToImageModal(false)}
          onInsert={(dataUrl) => {
            insertDataUrlIntoEditor(dataUrl);
            setShowTextToImageModal(false);
          }}
        />
      )}
    </div>
  );
}
