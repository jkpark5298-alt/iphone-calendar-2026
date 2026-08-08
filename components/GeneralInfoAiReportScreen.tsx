"use client";

import React from "react";
import type { GeneralInfoItem } from "../types/generalInfo";
import {
  hasDisplayableAiReport,
  htmlToPlainText,
  looksLikeHtmlContent,
  enhanceInlineImageBlocks,
} from "../lib/generalInfoHelpers";
import { AiReportRichEditor } from "./AiReportRichEditor";
import { normalizeAiReportEditorHtml } from "../lib/aiReportEditor";

type TabId = "view" | "body" | "factcheck";

type Props = {
  item: GeneralInfoItem;
  onClose: () => void;
  onSaveReport?: (
    html: string,
    status: GeneralInfoItem["factCheckStatus"],
    title?: string,
  ) => Promise<void>;
  onUploadImage?: (file: File) => Promise<string>;
};

/**
 * AI 검증 보고서 별도 화면
 * - 보기: 읽기 전용
 * - 본문: TipTap 편집 (builder형 서식)
 */
export default function GeneralInfoAiReportScreen({
  item,
  onClose,
  onSaveReport,
  onUploadImage,
}: Props) {
  const [tab, setTab] = React.useState<TabId>("view");
  const [draftHtml, setDraftHtml] = React.useState(() =>
    normalizeAiReportEditorHtml(String(item.factCheckSummary || "")),
  );
  const [draftTitle, setDraftTitle] = React.useState(() => String(item.title || ""));
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  const reportHtml = String(item.factCheckSummary || "").trim();
  const hasReport = hasDisplayableAiReport(reportHtml) || hasDisplayableAiReport(draftHtml);
  const htmlDirty =
    normalizeAiReportEditorHtml(draftHtml) !== normalizeAiReportEditorHtml(reportHtml);
  const titleDirty = draftTitle.trim() !== String(item.title || "").trim();
  const dirty = htmlDirty || titleDirty;

  React.useEffect(() => {
    setDraftHtml(normalizeAiReportEditorHtml(String(item.factCheckSummary || "")));
    setDraftTitle(String(item.title || ""));
    setSaveMsg("");
  }, [item.id, item.factCheckSummary, item.title]);

  const displayHtml = React.useMemo(() => {
    const raw = tab === "body" ? draftHtml : reportHtml || draftHtml;
    if (!raw) return "";
    const normalized = normalizeAiReportEditorHtml(raw);
    if (looksLikeHtmlContent(normalized)) return normalized;
    return normalized
      .split(/\n{2,}/)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`)
      .join("");
  }, [reportHtml, draftHtml, tab]);

  React.useEffect(() => {
    if (tab !== "view" || !bodyRef.current) return;
    enhanceInlineImageBlocks(bodyRef.current);
  }, [displayHtml, tab]);

  const handleSave = React.useCallback(async () => {
    if (!onSaveReport) return;
    const html = normalizeAiReportEditorHtml(draftHtml);
    if (!html || html === "<p></p>") {
      alert("저장할 보고서 내용이 없습니다.");
      return;
    }
    const nextTitle = draftTitle.trim() || item.title || "제목 없음";
    setSaving(true);
    setSaveMsg("");
    try {
      await onSaveReport(html, item.factCheckStatus || "확인 필요", nextTitle);
      setSaveMsg("✅ 저장됨");
    } catch (error) {
      console.error(error);
      setSaveMsg("⚠️ 저장 실패");
      alert("보고서 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [draftHtml, draftTitle, item.factCheckStatus, item.title, onSaveReport]);

  return (
    <div className="giAiReportScreen" role="dialog" aria-modal="true" aria-label="AI 검증 보고서">
      <div className="giAiReportScreenPanel">
        <header className="giAiReportScreenHeader">
          <div className="giAiReportScreenTitleBlock">
            <p className="giAiReportScreenEyebrow">AI 검증 보고서</p>
            <input
              className="giAiReportTitleInput giAiReportTitleInputHeader"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="제목 없음"
              aria-label="보고서 제목"
            />
          </div>
          <div className="giAiReportScreenHeaderActions">
            <button
              type="button"
              className="giAiReportGhostBtn"
              onClick={() => {
                const plain = htmlToPlainText(draftHtml || reportHtml) || draftHtml || reportHtml;
                void navigator.clipboard?.writeText(plain);
              }}
            >
              초안 전체 복사
            </button>
            {onSaveReport && (
              <button
                type="button"
                className="giAiReportPrimaryBtn"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
              >
                {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
              </button>
            )}
            <button type="button" className="giAiReportCloseBtn" onClick={onClose} aria-label="닫기">
              ×
            </button>
          </div>
        </header>

        <div className="giAiReportTabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "view"}
            className={tab === "view" ? "active" : ""}
            onClick={() => setTab("view")}
          >
            보기
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "body"}
            className={tab === "body" ? "active" : ""}
            onClick={() => setTab("body")}
          >
            본문
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "factcheck"}
            className={tab === "factcheck" ? "active" : ""}
            onClick={() => setTab("factcheck")}
          >
            팩트체크
          </button>
        </div>

        {saveMsg && <p className="giAiReportHint">{saveMsg}</p>}

        <section className="giAiReportMeta">
          <div>
            <span>제목</span>
            <input
              className="giAiReportTitleInput"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="제목을 입력하세요"
              aria-label="보고서 제목"
            />
          </div>
          <div>
            <span>작성일자</span>
            <strong>{item.createdAt || "-"}</strong>
          </div>
          <div>
            <span>상태</span>
            <strong>{item.factCheckStatus || "확인 전"}</strong>
          </div>
          <div>
            <span>링크</span>
            <strong>{item.sourceUrl || "직접 입력"}</strong>
          </div>
        </section>

        <section className="giAiReportBodyWrap">
          {tab === "view" && (
            <>
              <div className="giAiReportBodyLabel">보기 · 보고서</div>
              {hasReport ? (
                <div
                  ref={bodyRef}
                  className="giAiReportBody"
                  dangerouslySetInnerHTML={{ __html: displayHtml }}
                />
              ) : (
                <EmptyReport />
              )}
            </>
          )}

          {tab === "body" && (
            <AiReportRichEditor
              html={draftHtml || "<p></p>"}
              onChange={setDraftHtml}
              onUploadImage={onUploadImage}
            />
          )}

          {tab === "factcheck" && (
            <div className="giAiReportPlaceholder">
              <strong>팩트체크</strong>
              <p>다음 단계에서 검증 메모·판정 UI를 연결할 예정입니다.</p>
              <p className="muted">현재 상태: {item.factCheckStatus || "확인 전"}</p>
            </div>
          )}
        </section>

        <footer className="giAiReportFooter">
          {onSaveReport && (
            <button
              type="button"
              className="giAiReportPrimaryBtn"
              disabled={saving || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? "저장 중…" : "보고서 저장"}
            </button>
          )}
          <button type="button" className="giAiReportGhostBtn" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}

function EmptyReport() {
  return (
    <div className="giAiReportEmpty">
      아직 AI 검증 보고서 내용이 없습니다. Confirm 저장 후 다시 열어 주세요.
    </div>
  );
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
