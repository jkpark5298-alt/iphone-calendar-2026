"use client";

/**
 * Chapter3Info.tsx
 * Chapter 3 — 일반 정보 수집 / 분류 / 저장
 * 입력: 제목 → 분류 → 키워드 → 본문(서식) → 요약 → 인포그래픽
 */

import React from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { stepCollectFontSize } from "../lib/collectFormatPalette";
import {
  enhanceRichInlineImages,
  insertImagesAtSlotOrCaret,
} from "../lib/richImageSlots";
import { readClipboardImageFiles } from "../lib/collectRichFormat";
import { extractFirstSentence, categoryKeywordsList, formatCategoryKeywords } from "../lib/generalInfoText";
import { extractMediaSrcFromHtml } from "../lib/generalInfoHelpers";
import { isParagraphEmpty } from "../lib/generalInfoParagraphs";
import { Card, EmptyState } from "./SharedComponents";
import { CollectFormatToolbar } from "./CollectFormatToolbar";
import { HandwritingModal } from "./HandwritingModal";
import { TextToImageModal } from "./TextToImageModal";

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
  handleAddGeneralInfoParagraph: () => void;
  handleRemoveGeneralInfoParagraph: (paragraphId: string) => void;
  handleGeneralInfoFileUpload: (files: FileList | null) => void;
  handleClearGeneralInfoCoverImage: () => void;
  handleRemoveGeneralInfoMediaItem: (index: number) => void;
  handleConfirmGeneralInfo: () => void;
  handleSaveTemporaryGeneralInfoDraft: () => void;
  handleCancelEditGeneralInfo: () => void;
  handleStartEditGeneralInfo: (item: GeneralInfoItem) => void;

  generalInfoItems: GeneralInfoItem[];
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
  handleAddGeneralInfoParagraph,
  handleRemoveGeneralInfoParagraph,
  handleGeneralInfoFileUpload,
  handleClearGeneralInfoCoverImage,
  handleRemoveGeneralInfoMediaItem,
  handleConfirmGeneralInfo,
  handleSaveTemporaryGeneralInfoDraft,
  handleCancelEditGeneralInfo,
  handleStartEditGeneralInfo,
  generalInfoItems,
  generalInfoDetailId,
  setGeneralInfoDetailId,
  handleTogglePinGeneralInfo,
  loadGeneralInfoItemsFromSupabase,
  generalInfoSupabaseStatus,
  generalInfoCategories,
  normalizeGeneralInfoMediaItems,
  getGeneralInfoDisplayMediaItems,
}: Chapter3InfoProps) {
  const activeTab = generalInfoActiveTab;
  const setActiveTab = setGeneralInfoActiveTab;
  const generalInfoImageFileRef = React.useRef<HTMLInputElement | null>(null);
  const infographicFileRef = React.useRef<HTMLInputElement | null>(null);
  const [showHandwritingModal, setShowHandwritingModal] = React.useState(false);
  const [showTextToImageModal, setShowTextToImageModal] = React.useState(false);
  const [collectFontSizePx, setCollectFontSizePx] = React.useState(15);

  const bodyPlain = String(generalInfoDraft.text || "").trim();
  const infographicTitle = extractFirstSentence(bodyPlain) || "본문 첫 문장이 제목으로 사용됩니다";

  const mediaItems = normalizeGeneralInfoMediaItems(generalInfoDraft);

  const bodyImageSrcs = React.useMemo(() => {
    const liveHtml = String(generalInfoRichTextRef.current?.innerHTML || "");
    const draftHtml = String(generalInfoDraft.formattedTextHtml || "");
    const srcs = [
      ...extractMediaSrcFromHtml(liveHtml),
      ...extractMediaSrcFromHtml(draftHtml),
    ];
    return Array.from(new Set(srcs.filter((src) => /^(https?:\/\/|data:|blob:)/i.test(src))));
  }, [
    generalInfoDraft.formattedTextHtml,
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

  React.useLayoutEffect(() => {
    const el = generalInfoRichTextRef.current;
    if (!el) return;
    if (el.innerHTML !== generalInfoRichTextInitialHtml) {
      el.innerHTML = generalInfoRichTextInitialHtml || "";
    }
    enhanceRichInlineImages(el);
  }, [generalInfoRichTextEditorKey, generalInfoRichTextInitialHtml, generalInfoRichTextRef]);

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
      <div className="ch3TabBar">
        <button
          type="button"
          className={`ch3TabBtn ${activeTab === "storage" ? "active" : ""}`}
          onClick={() => setActiveTab("storage")}
        >
          정보 창고
        </button>
        <button
          type="button"
          className={`ch3TabBtn ${activeTab === "collect" ? "active" : ""}`}
          onClick={() => setActiveTab("collect")}
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
            <p style={{ margin: "6px 0 0" }}>제목 · 분류 · 키워드 · 본문 · 요약 · 인포그래픽</p>
          </div>

          <Card number="1" title="일반 정보 입력" subtitle="텍스트와 이미지를 본문에 붙여넣기할 수 있습니다.">
            {generalInfoEditingId && (
              <div className="generalInfoEditNotice">
                <strong>수정 모드</strong>
                <p>저장된 항목을 수정 중입니다. 저장하면 반영됩니다.</p>
              </div>
            )}

            <label>
              제목
              <input
                value={generalInfoDraft.title}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="제목을 입력하세요"
              />
            </label>

            <div className="generalInfoGrid" style={{ marginTop: 12 }}>
              <label>
                1차 분류
                <select
                  value={generalInfoDraft.primaryCategory}
                  onChange={(e) => {
                    const primaryCategory = e.target.value;
                    setGeneralInfoDraft((prev) => {
                      const keywords = categoryKeywordsList(primaryCategory, prev.secondaryCategory);
                      setGeneralInfoKeywordText(
                        formatCategoryKeywords(primaryCategory, prev.secondaryCategory),
                      );
                      return { ...prev, primaryCategory, keywords };
                    });
                  }}
                >
                  <option value="">선택</option>
                  {generalInfoCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                  {!generalInfoCategories.includes("기타") && <option value="기타">기타</option>}
                </select>
              </label>
              <label>
                2차 분류
                <input
                  className="generalInfoEditableInput"
                  value={generalInfoDraft.secondaryCategory}
                  onChange={(e) => {
                    const secondaryCategory = e.target.value;
                    setGeneralInfoDraft((prev) => {
                      const keywords = categoryKeywordsList(prev.primaryCategory, secondaryCategory);
                      setGeneralInfoKeywordText(
                        formatCategoryKeywords(prev.primaryCategory, secondaryCategory),
                      );
                      return { ...prev, secondaryCategory, keywords };
                    });
                  }}
                  placeholder="예: 외교/해외동향"
                />
              </label>
            </div>

            <div className="generalInfoResultBox generalInfoKeywordInputBox" style={{ marginTop: 12 }}>
              <strong>키워드</strong>
              <div className="miniTags" style={{ marginTop: 8 }}>
                {generalInfoDraft.keywords.length > 0 ? (
                  <span>{formatCategoryKeywords(generalInfoDraft.primaryCategory, generalInfoDraft.secondaryCategory)}</span>
                ) : (
                  <span className="mutedText">1·2차 분류를 선택하면 #1차#2차 로 표시됩니다.</span>
                )}
              </div>
            </div>

            <div className="generalInfoTextBox generalInfoRichTextBox" style={{ marginTop: 14 }}>
              <div className="generalInfoRichTextHeader">
                <strong>본문 단락</strong>
                <span>새 단락은 위에 작성 · 이전 단락은 아래로 이동</span>
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
                <span className="mutedText" style={{ fontSize: 12 }}>
                  작성 {activeParagraph?.createdAt || "지금"}
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
              <div className="collectFormatSlotRow">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleGeneralInfoInsertImageSlot}
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
              <input
                ref={generalInfoImageFileRef}
                type="file"
                accept="image/*,.heic,.heif,.jpeg,.jpg,.png,.webp"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  handleGeneralInfoRichImagePick(e.target.files);
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
                data-paragraph-id={activeParagraph?.id || ""}
                onBlur={(e) => {
                  const rel = e.relatedTarget as HTMLElement | null;
                  if (rel && (rel.tagName === "BUTTON" || rel.closest?.("button"))) return;
                  syncGeneralInfoRichTextToDraft();
                }}
                onPaste={handleGeneralInfoRichPaste}
                onInput={handleGeneralInfoRichInput}
                onClick={handleGeneralInfoRichEditorClick}
                data-placeholder="새 단락을 입력하거나 붙여넣으세요."
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

            <div className="generalInfoCoverImageBox" style={{ marginTop: 14 }}>
              <div className="generalInfoCoverImageHeader">
                <strong>정보 창고 대표 이미지</strong>
              </div>
              <p className="mutedText" style={{ margin: "0 0 10px" }}>
                본문에 넣은 이미지 중 하나를 선택합니다. 정보 창고 카드 썸네일로 사용됩니다.
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

            <div className="generalInfoResultBox generalInfoEditableResultBox" style={{ marginTop: 14 }}>
              <strong>요약</strong>
              <textarea
                className="generalInfoEditableTextarea"
                value={generalInfoDraft.summary}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, summary: e.target.value }))}
                placeholder="핵심 내용을 짧게 요약하세요."
                rows={4}
              />
            </div>

            <div className="generalInfoUploadBox" style={{ marginTop: 14 }}>
              <div>
                <strong>인포그래픽</strong>
                <p>
                  제목: <em>{infographicTitle}</em>
                  <br />
                  차트·도표·요약 카드 이미지를 사진첩에서 선택하거나 붙여넣습니다.
                </p>
              </div>
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
            </div>

            {mediaItems.length > 0 && (
              <div className="generalInfoCoverImageBox" style={{ marginTop: 10 }}>
                <div className="generalInfoCoverImageHeader">
                  <strong>인포그래픽 {mediaItems.length}개</strong>
                  <button
                    className="secondaryButton smallActionButton"
                    type="button"
                    onClick={handleClearGeneralInfoCoverImage}
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

            <div className="generalInfoActionRow" style={{ marginTop: 16 }}>
              <button className="gradientButton" type="button" onClick={handleConfirmGeneralInfo}>
                {generalInfoEditingId ? "수정 저장" : "저장"}
              </button>
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
              {generalInfoEditingId && (
                <button className="secondaryButton" type="button" onClick={handleCancelEditGeneralInfo}>
                  수정 취소
                </button>
              )}
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
          <Card number="2" title="정보 창고" subtitle="저장된 일반 정보 목록">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <p className="mutedText" style={{ margin: 0 }}>
                전체 {generalInfoItems.length}건
              </p>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  void loadGeneralInfoItemsFromSupabase();
                }}
              >
                동기화
              </button>
            </div>
            <span className="mutedText" style={{ fontSize: 11 }}>
              {generalInfoSupabaseStatus}
            </span>

            {generalInfoItems.length === 0 ? (
              <EmptyState icon="🗂️" text="저장된 일반 정보가 없습니다." />
            ) : (
              <div className="generalInfoList">
                {generalInfoItems.map((item) => (
                  <article
                    className={`generalInfoCard ${item.isPinned ? "pinned" : ""} ${generalInfoDetailId === item.id ? "active" : ""}`}
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setGeneralInfoDetailId(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setGeneralInfoDetailId(item.id);
                    }}
                  >
                    <div
                      className="generalInfoCardThumbnail"
                      onClick={() => setGeneralInfoDetailId(item.id)}
                    >
                      {getGeneralInfoDisplayMediaItems(item).length > 0 ? (
                        <img
                          src={getGeneralInfoDisplayMediaItems(item)[0].preview}
                          alt={item.title}
                          onError={(e) => {
                            e.currentTarget.src = "/placeholder.png";
                          }}
                        />
                      ) : (
                        <div className="generalInfoCardPlaceholder">📄</div>
                      )}
                    </div>

                    <div
                      className="generalInfoCardContent"
                      onClick={() => setGeneralInfoDetailId(item.id)}
                    >
                      <strong>
                        {item.isPinned && <span className="generalInfoCardPinMark">📌</span>}
                        {item.title}
                      </strong>
                      <p className="mutedText">{item.createdAt}</p>
                      <p className="cardSummary">{item.summary || extractFirstSentence(item.text) || "요약 없음"}</p>
                    </div>

                    <div className="generalInfoCardActions">
                      <button
                        className="generalInfoCardEditButton"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEditGeneralInfo(item);
                        }}
                        title="자료 수정"
                      >
                        수정
                      </button>
                      <button
                        className="generalInfoCardDetailButton"
                        type="button"
                        title="상세보기"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGeneralInfoDetailId(item.id);
                        }}
                      >
                        상세보기
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
