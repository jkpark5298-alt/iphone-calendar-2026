"use client";

import type { GeneralInfoItem } from "../types/generalInfo";
import {
  getGeneralInfoDisplayMediaItems,
  getGeneralInfoFormattedHtml,
} from "../lib/generalInfoHelpers";
import React from "react";

// --- AI 보고서 마크다운 및 JSON 파싱/렌더링 헬퍼 ---

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
  onRunFactCheck: (item: GeneralInfoItem) => void;
  onEdit: (item: GeneralInfoItem) => void;
  onDelete?: (item: GeneralInfoItem) => void;
  onSavePdf?: (item: GeneralInfoItem) => void;
  onShareReport?: (item: GeneralInfoItem) => void;
  onOpenStorageImage?: (url: string, fileName?: string) => void;
}

export default function GeneralInfoDetailModal({
  item,
  onClose,
  onGenerateReport,
  onRunFactCheck,
  onEdit,
  onDelete,
  onSavePdf,
  onShareReport,
  onOpenStorageImage,
}: Props) {
  if (!item) return null;

  const mediaItems = getGeneralInfoDisplayMediaItems(item);

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

        <div className="generalInfoDetailBody">
          <section className="generalInfoDetailSection">
            <strong>분류</strong>
            <p>
              {item.primaryCategory} &gt; {item.secondaryCategory} &gt;{" "}
              {item.thirdCategory}
            </p>
          </section>

          <section className="generalInfoDetailSection">
            <strong>키워드</strong>
            <div className="miniTags">
              {item.keywords.length > 0 ? (
                item.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)
              ) : (
                <span>키워드 없음</span>
              )}
            </div>
          </section>

          <section className="generalInfoDetailSection">
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
                  maxWidth: "100%" 
                }}
              >
                {item.sourceUrl}
              </a>
            ) : (
              <p>출처 URL 없음</p>
            )}
          </section>

          <section className="generalInfoDetailSection">
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

          <section className="generalInfoDetailSection">
            <strong>요약</strong>
            <p>{item.summary || "요약 없음"}</p>
          </section>

          <section className="generalInfoDetailSection">
            <strong>본문 Text</strong>
            {item.text ? (
              <div
                className="generalInfoFormattedTextView"
                dangerouslySetInnerHTML={{
                  __html: getGeneralInfoFormattedHtml(item),
                }}
              />
            ) : (
              <pre>본문 Text 없음</pre>
            )}
          </section>

          <section className="generalInfoDetailSection">
            <strong>Fact Check 및 AI 보고서</strong>
            {item.factCheckSummary ? (() => {
              const { status: parsedStatus, summary: parsedSummary, result: parsedResult } = parseReportText(item.factCheckSummary);
              const sections = parseMarkdownSections(parsedResult);
              const hasReport = item.factCheckSummary && item.factCheckSummary.length > 80;
              const statusToShow = item.factCheckStatus === "오류 가능성"
                ? "오류 가능성"
                : item.factCheckStatus === "확인 완료"
                  ? "확인 완료"
                  : hasReport
                    ? "확인 완료"
                    : parsedStatus || "확인 필요";

              const isOk = statusToShow === "확인 완료";
              const isCheck = statusToShow === "확인 필요";
              const isError = statusToShow === "오류 가능" || statusToShow === "오류 가능성";

              const badgeBg = isOk
                ? "rgba(52, 211, 153, 0.15)"
                : isCheck
                  ? "rgba(250, 204, 21, 0.15)"
                  : isError
                    ? "rgba(248, 113, 113, 0.15)"
                    : "rgba(148, 163, 184, 0.15)";

              const badgeBorder = isOk
                ? "1px solid rgba(52, 211, 153, 0.3)"
                : isCheck
                  ? "1px solid rgba(250, 204, 21, 0.3)"
                  : isError
                    ? "1px solid rgba(248, 113, 113, 0.3)"
                    : "1px solid rgba(148, 163, 184, 0.3)";

              const badgeColor = isOk
                ? "#4ade80"
                : isCheck
                  ? "#facc15"
                  : isError
                    ? "#f87171"
                    : "#94a3b8";

              return (
                <div style={{ marginTop: "10px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
                    <span className="miniTag" style={{
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      background: badgeBg,
                      border: badgeBorder,
                      color: badgeColor
                    }}>
                      {statusToShow}
                    </span>
                  </div>

                  {parsedSummary && (
                    <div className="reportSummaryCard" style={{
                      background: "rgba(14, 165, 233, 0.08)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      marginBottom: "14px"
                    }}>
                      <strong style={{ color: "#38bdf8", fontSize: "13px", display: "block", marginBottom: "4px" }}>💡 AI 요약 및 핵심 피드백</strong>
                      <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.6", color: "#cbd5e1" }}>{parsedSummary}</p>
                    </div>
                  )}

                  <div className="reportSectionsContainer" style={{ display: "grid", gap: "12px" }}>
                    {sections.map((sec, idx) => (
                      <div key={idx} className="reportSectionCard" style={{
                        background: "rgba(30, 41, 59, 0.35)",
                        border: "1px solid rgba(148, 163, 184, 0.12)",
                        borderRadius: "12px",
                        padding: "14px 16px"
                      }}>
                        <h4 className="reportSectionHeader" style={{
                          margin: "0 0 10px 0",
                          fontSize: "14px",
                          fontWeight: 800,
                          color: "#bae6fd",
                          borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
                          paddingBottom: "6px"
                        }}>{sec.title}</h4>
                        <div className="reportSectionBody" style={{ fontSize: "13px", color: "#e2e8f0" }}>
                          <MarkdownViewer text={sec.content.join("\n")} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })() : (
              <div style={{ 
                whiteSpace: "pre-wrap", 
                marginTop: "8px", 
                lineHeight: "1.7",
                background: "rgba(15, 23, 42, 0.4)",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "1px solid rgba(148, 163, 184, 0.15)",
                color: "#94a3b8",
                fontSize: "13px"
              }}>
                아직 작성된 AI 보고서가 없습니다. 하단의 [AI 보고서] 버튼을 눌러 보고서를 생성해 보세요.
              </div>
            )}
          </section>
        </div>

        <div className="modalFooter">
          {item.factCheckSummary && onSavePdf && (
            <button
              className="secondaryButton"
              style={{ borderColor: "rgba(56, 189, 248, 0.4)", color: "#bae6fd" }}
              type="button"
              onClick={() => onSavePdf(item)}
            >
              💾 PC 저장
            </button>
          )}
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
            onClick={() => onGenerateReport(item)}
          >
            AI 보고서
          </button>
          <button
            className="secondaryButton"
            type="button"
            onClick={() => onRunFactCheck(item)}
          >
            정밀 Fact Check
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
