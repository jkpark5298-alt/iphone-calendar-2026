"use client";

import React from "react";
import type { GeneralInfoItem } from "../types/generalInfo";
import {
  hasDisplayableAiReport,
  htmlToPlainText,
  looksLikeHtmlContent,
} from "../lib/generalInfoHelpers";
import { AiReportRichEditor } from "./AiReportRichEditor";
import {
  AiReportInfographicPanel,
  extractInfographicsFromHtml,
  stripInfographicsFromHtml,
  upsertInfographicInHtml,
  type InfographicItem,
} from "./AiReportInfographicPanel";
import { normalizeAiReportEditorHtml } from "../lib/aiReportEditor";

type TabId = "view" | "body" | "infographic" | "factcheck";
type FactStatus = NonNullable<GeneralInfoItem["factCheckStatus"]>;

type Props = {
  item: GeneralInfoItem;
  onClose: () => void;
  onSaveReport?: (
    html: string,
    status: GeneralInfoItem["factCheckStatus"],
    title?: string,
  ) => Promise<void>;
  onUploadImage?: (file: File) => Promise<string>;
  onDownloadPdfReport?: (item: GeneralInfoItem) => void | Promise<void>;
  isExportingPdf?: boolean;
  onSetRepresentativeImage?: (src: string) => void | Promise<void>;
};

/**
 * AI 검증 보고서 별도 화면
 * - 보기: 읽기 전용
 * - 보고서 편집: TipTap 편집
 * - 인포그래픽: 이미지 입력창(파일/붙여넣기)
 * - 팩트체크: 상태 선택 + 저장
 */
export default function GeneralInfoAiReportScreen({
  item,
  onClose,
  onSaveReport,
  onUploadImage,
  onDownloadPdfReport,
  isExportingPdf = false,
  onSetRepresentativeImage,
}: Props) {
  const [tab, setTab] = React.useState<TabId>("view");
  const [draftHtml, setDraftHtml] = React.useState(() =>
    normalizeAiReportEditorHtml(String(item.factCheckSummary || "")),
  );
  const [draftTitle, setDraftTitle] = React.useState(() => String(item.title || ""));
  const [draftStatus, setDraftStatus] = React.useState<FactStatus>(
    item.factCheckStatus || "확인 전",
  );
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const [infographicUploading, setInfographicUploading] = React.useState(false);

  const reportHtml = String(item.factCheckSummary || "").trim();
  const hasReport = hasDisplayableAiReport(reportHtml) || hasDisplayableAiReport(draftHtml);
  const htmlDirty =
    normalizeAiReportEditorHtml(draftHtml) !== normalizeAiReportEditorHtml(reportHtml);
  const titleDirty = draftTitle.trim() !== String(item.title || "").trim();
  const statusDirty = draftStatus !== (item.factCheckStatus || "확인 전");
  const dirty = htmlDirty || titleDirty || statusDirty;

  const reportLooksTruncated = React.useMemo(() => {
    const plain = htmlToPlainText(draftHtml || reportHtml).trim();
    if (!plain) return false;
    // 제목만 있고 본문이 거의 없으면 잘린 상태로 간주
    return plain.length < 80 && /AI 검증 보고서/i.test(plain);
  }, [draftHtml, reportHtml]);

  const draftStatusRef = React.useRef(draftStatus);
  const draftTitleRef = React.useRef(draftTitle);
  const draftHtmlRef = React.useRef(draftHtml);
  draftStatusRef.current = draftStatus;
  draftTitleRef.current = draftTitle;
  draftHtmlRef.current = draftHtml;

  const infographics = React.useMemo(
    () => extractInfographicsFromHtml(draftHtml),
    [draftHtml],
  );

  React.useEffect(() => {
    setDraftHtml(normalizeAiReportEditorHtml(String(item.factCheckSummary || "")));
    setDraftTitle(String(item.title || ""));
    setDraftStatus(item.factCheckStatus || "확인 전");
    setSaveMsg("");
  }, [item.id, item.factCheckSummary, item.title, item.factCheckStatus]);

  const displayHtml = React.useMemo(() => {
    const raw = tab === "body" || tab === "infographic" ? draftHtml : reportHtml || draftHtml;
    if (!raw) return "";
    const normalized = normalizeAiReportEditorHtml(raw);
    if (looksLikeHtmlContent(normalized)) return normalized;
    return normalized
      .split(/\n{2,}/)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`)
      .join("");
  }, [reportHtml, draftHtml, tab]);

  const applyInfographics = React.useCallback((updater: (prev: InfographicItem[]) => InfographicItem[]) => {
    setDraftHtml((prev) => {
      const current = extractInfographicsFromHtml(prev);
      const next = updater(current);
      return normalizeAiReportEditorHtml(upsertInfographicInHtml(prev || "<p></p>", next));
    });
  }, []);

  const handleAddInfographics = React.useCallback(
    async (files: File[], caption: string) => {
      if (!onUploadImage) {
        alert("이미지 업로드가 준비되지 않았습니다.");
        return;
      }
      setInfographicUploading(true);
      try {
        const added: InfographicItem[] = [];
        for (const file of files) {
          const src = await onUploadImage(file);
          if (!src) continue;
          added.push({
            id: `infographic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            src,
            caption,
          });
        }
        if (!added.length) {
          alert("인포그래픽을 추가하지 못했습니다.");
          return;
        }
        applyInfographics((prev) => [...prev, ...added]);
        setSaveMsg("✅ 인포그래픽 추가됨 · 저장을 눌러 반영하세요");
      } finally {
        setInfographicUploading(false);
      }
    },
    [applyInfographics, onUploadImage],
  );

  const handleRemoveInfographic = React.useCallback(
    (id: string) => {
      applyInfographics((prev) => prev.filter((item) => item.id !== id));
    },
    [applyInfographics],
  );

  const handleInfographicCaptionChange = React.useCallback(
    (id: string, caption: string) => {
      applyInfographics((prev) =>
        prev.map((item) => (item.id === id ? { ...item, caption } : item)),
      );
    },
    [applyInfographics],
  );

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
      await onSaveReport(html, draftStatus, nextTitle);
      setSaveMsg("✅ 저장됨");
    } catch (error) {
      console.error(error);
      setSaveMsg("⚠️ 저장 실패");
      alert("보고서 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }, [draftHtml, draftStatus, draftTitle, item.title, onSaveReport]);

  const handleMediaInserted = React.useCallback(
    async (bodyHtml: string) => {
      const infos = extractInfographicsFromHtml(draftHtmlRef.current);
      const merged = normalizeAiReportEditorHtml(
        upsertInfographicInHtml(bodyHtml || "<p></p>", infos),
      );
      setDraftHtml(merged);
      draftHtmlRef.current = merged;
      if (!onSaveReport) {
        setSaveMsg("✅ 미디어 추가됨 · 저장을 눌러 반영하세요");
        return;
      }
      const nextTitle = draftTitleRef.current.trim() || item.title || "제목 없음";
      setSaving(true);
      setSaveMsg("");
      try {
        await onSaveReport(merged, draftStatusRef.current, nextTitle);
        setSaveMsg("✅ 이미지/동영상 저장됨");
      } catch (error) {
        console.error(error);
        setSaveMsg("⚠️ 자동 저장 실패 · 저장 버튼을 눌러 주세요");
      } finally {
        setSaving(false);
      }
    },
    [item.title, onSaveReport],
  );

  const handleDownloadPdf = React.useCallback(() => {
    if (!onDownloadPdfReport) return;
    const draftItem: GeneralInfoItem = {
      ...item,
      title: draftTitle.trim() || item.title,
      factCheckStatus: draftStatus,
      factCheckSummary: normalizeAiReportEditorHtml(draftHtml) || item.factCheckSummary,
    };
    void onDownloadPdfReport(draftItem);
  }, [draftHtml, draftStatus, draftTitle, item, onDownloadPdfReport]);

  const handleCopyAll = React.useCallback(async () => {
    const title = draftTitle.trim() || item.title || "AI 검증 보고서";
    const html = normalizeAiReportEditorHtml(draftHtml || reportHtml);
    if (!html || html === "<p></p>") {
      alert("복사할 보고서 내용이 없습니다.");
      return;
    }
    try {
      await copyAiReportTextAndImages(html, title);
      setSaveMsg("✅ 전체복사 완료 (텍스트·이미지)");
    } catch (error) {
      console.error(error);
      try {
        const plain = [title, "", htmlToPlainText(html)].filter(Boolean).join("\n");
        await navigator.clipboard.writeText(plain);
        setSaveMsg("✅ 텍스트만 복사됨 (이미지 복사 실패)");
      } catch {
        alert("전체복사에 실패했습니다.");
      }
    }
  }, [draftHtml, draftTitle, item.title, reportHtml]);

  const canExportPdf =
    Boolean(onDownloadPdfReport) &&
    hasDisplayableAiReport(normalizeAiReportEditorHtml(draftHtml) || reportHtml);

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
              onClick={() => void handleCopyAll()}
            >
              전체복사
            </button>
            {onDownloadPdfReport && (
              <button
                type="button"
                className="giAiReportGhostBtn"
                disabled={isExportingPdf || !canExportPdf}
                onClick={handleDownloadPdf}
                style={{ borderColor: "rgba(74, 222, 128, 0.45)", color: "#bbf7d0" }}
              >
                {isExportingPdf ? "PDF 생성 중…" : "PDF보고서"}
              </button>
            )}
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
            보고서 편집
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "infographic"}
            className={tab === "infographic" ? "active" : ""}
            onClick={() => setTab("infographic")}
          >
            인포그래픽
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

        {reportLooksTruncated ? (
          <div className="giAiReportTruncatedWarn" role="status">
            보고서 본문이 비어 있거나 이전에 잘린 상태입니다.{" "}
            <strong>Source DATA</strong>에서 AI 보고서를 다시 생성하거나, 아래{" "}
            <strong>보고서 편집</strong>에서 본문을 보충하세요. 이미지는 본문 중간 S 또는
            [이미지]로 넣을 수 있습니다.
          </div>
        ) : null}

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
            <strong>{draftStatus || "확인 전"}</strong>
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
              html={stripInfographicsFromHtml(draftHtml || "<p></p>")}
              onChange={(html) => {
                setDraftHtml((prev) => {
                  const infos = extractInfographicsFromHtml(prev);
                  const next = normalizeAiReportEditorHtml(
                    upsertInfographicInHtml(html || "<p></p>", infos),
                  );
                  draftHtmlRef.current = next;
                  return next;
                });
              }}
              onUploadImage={onUploadImage}
              onMediaInserted={handleMediaInserted}
            />
          )}

          {tab === "infographic" && (
            <AiReportInfographicPanel
              items={infographics}
              uploading={infographicUploading}
              representativeSrc={String(item.filePreview || item.mediaItems?.[0]?.preview || "")}
              onAdd={handleAddInfographics}
              onRemove={handleRemoveInfographic}
              onCaptionChange={handleInfographicCaptionChange}
              onSetRepresentative={onSetRepresentativeImage}
            />
          )}

          {tab === "factcheck" && (
            <div className="giAiReportFactCheckPanel">
              <strong>팩트체크 상태</strong>
              <p className="muted">
                상태를 선택한 뒤 저장하면 보고서와 함께 반영됩니다.
              </p>
              <label className="giAiReportFactStatusLabel">
                Fact Check 상태
                <select
                  className="giAiReportFactStatusSelect"
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value as FactStatus)}
                >
                  <option value="확인 필요">확인 필요</option>
                  <option value="확인 완료">확인 완료</option>
                  <option value="오류 가능성">오류 가능성</option>
                  <option value="확인 전">확인 전</option>
                </select>
              </label>
              {onSaveReport && (
                <button
                  type="button"
                  className="giAiReportPrimaryBtn"
                  disabled={saving || !dirty}
                  onClick={() => void handleSave()}
                  style={{ marginTop: 14 }}
                >
                  {saving ? "저장 중…" : "상태 · 보고서 저장"}
                </button>
              )}
            </div>
          )}
        </section>

        <footer className="giAiReportFooter">
          <button
            type="button"
            className="giAiReportGhostBtn"
            onClick={() => void handleCopyAll()}
          >
            전체복사
          </button>
          {onDownloadPdfReport && (
            <button
              type="button"
              className="giAiReportGhostBtn"
              disabled={isExportingPdf || !canExportPdf}
              onClick={handleDownloadPdf}
              style={{ borderColor: "rgba(74, 222, 128, 0.45)", color: "#bbf7d0" }}
            >
              {isExportingPdf ? "PDF 생성 중…" : "PDF보고서"}
            </button>
          )}
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

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function inlineImagesAsDataUrls(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = String(img.getAttribute("src") || "").trim();
      if (!src || src.startsWith("data:")) return;
      try {
        const response = await fetch(src, { mode: "cors" });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) return;
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl) img.setAttribute("src", dataUrl);
      } catch {
        // CORS 등으로 실패하면 원본 URL 유지
      }
    }),
  );
}

/** 보고서 TEXT + 이미지를 클립보드에 복사 (rich HTML + plain text) */
async function copyAiReportTextAndImages(html: string, title: string) {
  const wrap = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = title;
  wrap.appendChild(heading);

  const body = document.createElement("div");
  body.innerHTML = html;
  wrap.appendChild(body);

  await inlineImagesAsDataUrls(wrap);

  const richHtml = wrap.innerHTML;
  const imageUrls = Array.from(wrap.querySelectorAll("img"))
    .map((img) => String(img.getAttribute("src") || "").trim())
    .filter((src) => src && !src.startsWith("data:"));
  const plain = [
    title,
    "",
    htmlToPlainText(html),
    imageUrls.length
      ? ["", "[이미지 링크]", ...imageUrls.map((src, i) => `${i + 1}. ${src}`)].join("\n")
      : "",
  ]
    .filter((part, index, arr) => !(part === "" && arr[index - 1] === ""))
    .join("\n")
    .trim();

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      "text/html": new Blob([richHtml], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    return;
  }

  await navigator.clipboard.writeText(plain);
}
