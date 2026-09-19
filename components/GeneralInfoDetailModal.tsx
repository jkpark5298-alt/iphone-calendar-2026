"use client";

import type { GeneralInfoItem } from "../types/generalInfo";
import {
  getGeneralInfoDisplayMediaItems,
  getGeneralInfoFormattedHtml,
} from "../lib/generalInfoHelpers";
import { extractFirstSentence, formatCategoryKeywords } from "../lib/generalInfoText";
import React from "react";

interface Props {
  item: GeneralInfoItem;
  onClose: () => void;
  onEdit: (item: GeneralInfoItem) => void;
  onDelete?: (item: GeneralInfoItem) => void;
  onDownloadPdf?: (item: GeneralInfoItem) => void;
  onShareGoodNotes?: (item: GeneralInfoItem) => void;
  onDownloadAppFile?: (item: GeneralInfoItem) => void;
}

export default function GeneralInfoDetailModal({
  item,
  onClose,
  onEdit,
  onDelete,
  onDownloadPdf,
  onShareGoodNotes,
  onDownloadAppFile,
}: Props) {
  if (!item) return null;

  const mediaItems = getGeneralInfoDisplayMediaItems(item);
  const infographicTitle = extractFirstSentence(item.text) || item.title;
  const coverSrc = String(item.filePreview || "").trim();
  const keywordText =
    formatCategoryKeywords(item.primaryCategory || "", item.secondaryCategory || "") ||
    (item.keywords || [])
      .map((kw) => `#${String(kw).replace(/^#+/, "")}`)
      .join("");

  const paragraphs =
    Array.isArray(item.paragraphs) && item.paragraphs.length > 0 ? item.paragraphs : null;
  const activeParagraph = paragraphs?.[0] || null;
  const olderParagraphs = paragraphs?.slice(1) || [];

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
            <h3>
              {item.appFileSaved && (
                <span className="generalInfoCardAppFileMark" title="앱파일 저장됨">
                  ★
                </span>
              )}
              {item.pdfSaved && (
                <span className="generalInfoCardPdfMark" title="PDF 저장됨">
                  ▲
                </span>
              )}
              {item.title}
            </h3>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="generalInfoDetailBody">
          {/* 수정 모드와 동일: 제목 → 본문 → 대표 이미지 → 요약 → 인포그래픽 → 분류/키워드 */}
          <section className="generalInfoDetailSection">
            <strong>제목</strong>
            <p>{item.title || "제목 없음"}</p>
          </section>

          <section className="generalInfoDetailSection">
            <div className="generalInfoRichTextHeader" style={{ marginBottom: 10 }}>
              <strong style={{ marginBottom: 0 }}>본문 단락</strong>
              <span className="mutedText" style={{ fontSize: 12 }}>
                최신 단락이 위 · 이전 단락은 아래
              </span>
            </div>

            {activeParagraph ? (
              <>
                <p className="mutedText" style={{ margin: "0 0 8px", fontSize: 12 }}>
                  작성 {activeParagraph.createdAt}
                </p>
                <div
                  className="generalInfoFormattedTextView"
                  dangerouslySetInnerHTML={{
                    __html: activeParagraph.html || "<p></p>",
                  }}
                />

                {olderParagraphs.length > 0 && (
                  <div
                    className="giParagraphList"
                    style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}
                  >
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
                        <strong style={{ display: "block", fontSize: 13, marginBottom: 8 }}>
                          작성 {paragraph.createdAt}
                        </strong>
                        <div
                          className="generalInfoFormattedTextView"
                          dangerouslySetInnerHTML={{
                            __html: paragraph.html || "<p></p>",
                          }}
                        />
                        <p className="mutedText" style={{ margin: "8px 0 0", fontSize: 11 }}>
                          이전 단락 {index + 1}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : item.text || item.formattedTextHtml ? (
              <div
                className="generalInfoFormattedTextView"
                dangerouslySetInnerHTML={{
                  __html: getGeneralInfoFormattedHtml(item),
                }}
              />
            ) : (
              <p>본문 없음</p>
            )}
          </section>

          <section className="generalInfoDetailSection">
            <strong>정보 창고 대표 이미지</strong>
            {coverSrc ? (
              <div className="generalInfoDetailCoverWrap">
                <img src={coverSrc} alt="대표 이미지" />
                <span className="generalInfoDraftMediaBadge representative">★ 대표</span>
              </div>
            ) : (
              <p className="mutedText">대표 이미지가 없습니다.</p>
            )}
          </section>

          <section className="generalInfoDetailSection">
            <strong>요약</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{item.summary || "요약 없음"}</p>
          </section>

          <section className="generalInfoDetailSection">
            <strong>인포그래픽</strong>
            <p className="mutedText" style={{ marginBottom: 8 }}>
              제목: {infographicTitle}
            </p>
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
                    }}
                  >
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
                        alt={media.memo || media.name || `인포그래픽 ${index + 1}`}
                        style={{
                          width: "100%",
                          maxHeight: "500px",
                          objectFit: "contain",
                          borderRadius: "10px",
                          background: "rgba(2, 6, 23, 0.55)",
                          display: "block",
                        }}
                      />
                    )}
                    <p className="mutedText" style={{ margin: "8px 0 4px", wordBreak: "break-all" }}>
                      {media.memo || media.name || `인포그래픽 ${index + 1}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p>인포그래픽이 없습니다.</p>
            )}
          </section>

          <section className="generalInfoDetailSection">
            <strong>1차 · 2차 분류</strong>
            <p>
              {[item.primaryCategory, item.secondaryCategory]
                .filter(Boolean)
                .join(" > ") || "분류 없음"}
            </p>
            <strong style={{ marginTop: 12 }}>키워드</strong>
            <div className="miniTags" style={{ marginTop: 8 }}>
              {keywordText ? <span>{keywordText}</span> : <span>키워드 없음</span>}
            </div>
          </section>
        </div>

        <div className="modalFooter">
          {onDownloadPdf && (
            <button
              className="secondaryButton"
              type="button"
              onClick={() => onDownloadPdf(item)}
            >
              PDF 저장
            </button>
          )}
          {onShareGoodNotes && (
            <button
              className="secondaryButton"
              type="button"
              onClick={() => onShareGoodNotes(item)}
            >
              GoodNotes 공유
            </button>
          )}
          {onDownloadAppFile && (
            <button
              className="secondaryButton"
              type="button"
              onClick={() => onDownloadAppFile(item)}
            >
              앱파일 저장
            </button>
          )}
          <button className="primaryButton" type="button" onClick={() => onEdit(item)}>
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
