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
} from "../lib/generalInfoHelpers";
import type { GeneralInfoMediaItem } from "../lib/generalInfoHelpers";
import React from "react";
import { generalInfoCategories } from "../lib/generalInfoMock";

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
}

export default function GeneralInfoDetailModal({
  item,
  onClose,
  onGenerateReport: _onGenerateReport,
  onOpenAiReport,
  onDelete,
  onShareReport,
  onOpenStorageImage,
  isGeneratingReport = false,
  needsManualFactCheck = false,
  startInEditMode = false,
  onSaveItemEdit,
}: Props) {
  void _onGenerateReport;
  const [copyFeedback, setCopyFeedback] = React.useState<"text" | null>(null);
  const [isEditing, setIsEditing] = React.useState(Boolean(startInEditMode));
  const [editTitle, setEditTitle] = React.useState(item.title || "");
  const [editSummary, setEditSummary] = React.useState(item.summary || "");
  const [editSourceUrl, setEditSourceUrl] = React.useState(item.sourceUrl || "");
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
  const detailBodyRef = React.useRef<HTMLDivElement | null>(null);

  const hasAiReport = hasDisplayableAiReport(String(item?.factCheckSummary || ""));

  React.useEffect(() => {
    setEditTitle(item.title || "");
    setEditSummary(item.summary || "");
    setEditSourceUrl(item.sourceUrl || "");
    setEditPrimary(item.primaryCategory || "");
    setEditSecondary(item.secondaryCategory || "");
    setEditKeywordsText((item.keywords || []).join(", "));
    setEditMediaItems(getGeneralInfoDisplayMediaItems(item));
    setBodyEditorKey((prev) => prev + 1);
    setIsEditing(Boolean(startInEditMode));
  }, [item.id, item.factCheckSummary, item.factCheckStatus, startInEditMode]);

  React.useEffect(() => {
    if (!isEditing || !bodyRichTextRef.current) return;
    bodyRichTextRef.current.innerHTML = getGeneralInfoFormattedHtml(item);
    enhanceInlineImageBlocks(bodyRichTextRef.current);
    bindInlineImageRemoveHandler(bodyRichTextRef.current);
  }, [isEditing, bodyEditorKey, item]);

  React.useEffect(() => {
    if (detailBodyRef.current) {
      detailBodyRef.current.scrollTop = 0;
    }
  }, [item?.id, hasAiReport]);

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
    setEditKeywordsText((item.keywords || []).join(", "));
    setEditMediaItems(getGeneralInfoDisplayMediaItems(item));
    setBodyEditorKey((prev) => prev + 1);
    setIsEditing(false);
  }, [item]);

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

  const saveAllEdits = React.useCallback(async () => {
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
      sourceUrl: editSourceUrl.trim() || undefined,
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
    setIsEditing(false);
  }, [
    editKeywordsText,
    editMediaItems,
    editPrimary,
    editSecondary,
    editSourceUrl,
    editSummary,
    editTitle,
    item,
    onSaveItemEdit,
  ]);

  const handleAiReportAction = React.useCallback(() => {
    // 일반정보수집에서는 AI 생성 대신 수동 보고서 편집 화면만 연다.
    onOpenAiReport?.(item.id);
  }, [item, onOpenAiReport]);

  if (!item) return null;

  const mediaItems = isEditing ? editMediaItems : getGeneralInfoDisplayMediaItems(item);
  const statusLabel = needsManualFactCheck
    ? "팩트체크 작성 필요"
    : item.factCheckStatus || "확인 전";

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
            <span>Source DATA{isEditing ? " · 수정" : ""}</span>
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
          <section className="generalInfoDetailSection generalInfoAiReportEntrySection">
            <div className="generalInfoSectionTitleRow">
              <strong>검증 보고서</strong>
              <span
                className="miniTag"
                style={{
                  padding: "5px 10px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 700,
                  background: needsManualFactCheck
                    ? "rgba(250, 204, 21, 0.15)"
                    : hasAiReport
                      ? "rgba(74, 222, 128, 0.12)"
                      : "rgba(56, 189, 248, 0.12)",
                  border: needsManualFactCheck
                    ? "1px solid rgba(250, 204, 21, 0.35)"
                    : hasAiReport
                      ? "1px solid rgba(74, 222, 128, 0.35)"
                      : "1px solid rgba(56, 189, 248, 0.3)",
                  color: needsManualFactCheck
                    ? "#facc15"
                    : hasAiReport
                      ? "#86efac"
                      : "#7dd3fc",
                }}
              >
                {statusLabel}
              </span>
            </div>
            {isGeneratingReport ? (
              <div
                style={{
                  marginTop: 8,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(56, 189, 248, 0.35)",
                  background: "rgba(14, 165, 233, 0.08)",
                  color: "#bae6fd",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                📄 보고서 준비 중…
              </div>
            ) : (
              <p className="mutedText" style={{ margin: "8px 0 10px", fontSize: 13 }}>
                {hasAiReport
                  ? "저장된 검증 보고서를 열어 편집·팩트체크·PDF 저장할 수 있습니다."
                  : "아직 보고서가 없습니다. 보고서 작성으로 직접 입력할 수 있습니다."}
              </p>
            )}
            <button
              type="button"
              className="primaryButton"
              disabled={isGeneratingReport}
              onClick={handleAiReportAction}
            >
              {isGeneratingReport
                ? "작성 중…"
                : hasAiReport
                  ? "보고서 열기"
                  : "보고서 작성"}
            </button>
          </section>

          <section className="generalInfoDetailSection">
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
                {isEditing && mediaItems.length > 0 && (
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
                  Fact Check/보고서에 넣은 사진을 대표 이미지로 쓸 수 있습니다.
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

          <section className="generalInfoDetailSection">
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

          <section className="generalInfoDetailSection">
            <div className="generalInfoSectionTitleRow">
              <strong>본문 TEXT</strong>
              {!isEditing && (
                <button
                  type="button"
                  className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                  onClick={() => void copyPlainText(item.text || "")}
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
                onInput={() => setBodyImageTick((prev) => prev + 1)}
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

          <section className="generalInfoDetailSection">
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
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <input
                  value={editSecondary}
                  onChange={(e) => setEditSecondary(e.target.value)}
                  placeholder="2차 분류"
                  className="generalInfoFactCheckStatusSelect"
                />
              </div>
            ) : (
              <p>
                {[item.primaryCategory, item.secondaryCategory]
                  .filter(Boolean)
                  .join(" > ") || "분류 없음"}
              </p>
            )}
          </section>

          <section className="generalInfoDetailSection">
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

          <section className="generalInfoDetailSection">
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
              disabled={isGeneratingReport}
              onClick={handleAiReportAction}
            >
              {isGeneratingReport
                ? "작성 중…"
                : hasAiReport
                  ? "보고서 열기"
                  : "보고서 작성"}
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
