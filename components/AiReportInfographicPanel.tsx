"use client";

import React from "react";
import {
  collectClipboardImageFiles,
  dedupeImageFiles,
} from "../lib/generalInfoHelpers";

export type InfographicItem = {
  id: string;
  src: string;
  caption: string;
};

type Props = {
  items: InfographicItem[];
  onAdd: (files: File[], caption: string) => Promise<void>;
  onRemove: (id: string) => void;
  onCaptionChange: (id: string, caption: string) => void;
  onSetRepresentative?: (src: string) => void | Promise<void>;
  representativeSrc?: string;
  uploading?: boolean;
};

export function AiReportInfographicPanel({
  items,
  onAdd,
  onRemove,
  onCaptionChange,
  onSetRepresentative,
  representativeSrc = "",
  uploading = false,
}: Props) {
  const [caption, setCaption] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const pasteRef = React.useRef<HTMLDivElement | null>(null);

  const handleFiles = React.useCallback(
    async (files: FileList | File[] | null) => {
      const list = dedupeImageFiles(
        files instanceof FileList ? Array.from(files) : files || [],
      ).filter((f) => f.type.startsWith("image/"));
      if (!list.length) {
        alert("이미지 파일을 선택해 주세요.");
        return;
      }
      setBusy(true);
      try {
        await onAdd(list, caption.trim());
        setCaption("");
        if (pasteRef.current) pasteRef.current.innerHTML = "";
      } catch (error) {
        console.error(error);
        alert("인포그래픽 추가에 실패했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [caption, onAdd],
  );

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const images = collectClipboardImageFiles(event.clipboardData);
      if (!images.length) return;
      event.preventDefault();
      void handleFiles(images);
    },
    [handleFiles],
  );

  const locked = busy || uploading;

  return (
    <div className="giAiReportInfographicPanel">
      <div className="giAiReportBodyLabel">인포그래픽 입력</div>
      <p className="giAiReportInfographicHint">
        차트·도표·요약 카드 이미지를 넣습니다. 파일 선택 또는 붙여넣기 후 보고서에 반영됩니다.
        저장하면 <strong>첫 인포그래픽</strong>이 정보 창고 카드·Source DATA의 <strong>대표 이미지</strong>로 설정됩니다.
      </p>

      <label className="giAiReportInfographicCaptionLabel">
        설명 (선택)
        <input
          className="giAiReportTitleInput"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="예: 핵심 지표 요약 인포그래픽"
          disabled={locked}
        />
      </label>

      <div className="giAiReportInfographicActions">
        <label className={`giAiReportInfographicFileBtn ${locked ? "disabled" : ""}`}>
          {locked ? "올리는 중…" : "🖼 파일 · 사진첩"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            disabled={locked}
            style={{ display: "none" }}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <div
          ref={pasteRef}
          className="giAiReportInfographicPaste"
          contentEditable={!locked}
          suppressContentEditableWarning
          onPaste={handlePaste}
          role="textbox"
          aria-label="인포그래픽 붙여넣기"
          data-placeholder="📋 여기 클릭 후 인포그래픽 붙여넣기"
        />
      </div>

      {items.length === 0 ? (
        <div className="giAiReportInfographicEmpty">아직 넣은 인포그래픽이 없습니다.</div>
      ) : (
        <ul className="giAiReportInfographicList">
          {items.map((item, index) => (
            <li key={item.id} className="giAiReportInfographicCard">
              <div className="giAiReportInfographicCardHead">
                <span>인포그래픽 {index + 1}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {onSetRepresentative && (
                    <button
                      type="button"
                      className="giAiReportGhostBtn"
                      disabled={locked || representativeSrc === item.src}
                      onClick={() => void onSetRepresentative(item.src)}
                    >
                      {representativeSrc === item.src ? "★ 대표" : "★ 대표로 교체"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="giAiReportGhostBtn"
                    onClick={() => onRemove(item.id)}
                    disabled={locked}
                  >
                    삭제
                  </button>
                </div>
              </div>
              <img src={item.src} alt={item.caption || `인포그래픽 ${index + 1}`} />
              <input
                className="giAiReportTitleInput"
                value={item.caption}
                onChange={(e) => onCaptionChange(item.id, e.target.value)}
                placeholder="설명 수정"
                disabled={locked}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function extractInfographicsFromHtml(html: string): InfographicItem[] {
  if (typeof document === "undefined") return [];
  const wrap = document.createElement("div");
  wrap.innerHTML = String(html || "");
  return Array.from(wrap.querySelectorAll("[data-gi-infographic='1']")).map((node, index) => {
    const el = node as HTMLElement;
    const img = el.querySelector("img");
    const captionEl = el.querySelector(".gi-report-infographic-caption, figcaption");
    const id = el.getAttribute("data-gi-infographic-id") || `infographic-${index + 1}`;
    return {
      id,
      src: String(img?.getAttribute("src") || "").trim(),
      caption: String(captionEl?.textContent || img?.getAttribute("alt") || "").trim(),
    };
  }).filter((item) => item.src);
}

export function buildInfographicBlockHtml(src: string, caption: string, id: string) {
  const safeSrc = escapeAttr(src);
  const safeCaption = escapeHtml(caption || "인포그래픽");
  const safeId = escapeAttr(id);
  return [
    `<div class="gi-report-infographic" data-gi-infographic="1" data-gi-infographic-id="${safeId}">`,
    `<img src="${safeSrc}" alt="${safeCaption}" />`,
    caption.trim()
      ? `<div class="gi-report-infographic-caption">${escapeHtml(caption.trim())}</div>`
      : "",
    `</div>`,
  ].join("");
}

export function stripInfographicsFromHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const wrap = document.createElement("div");
  wrap.innerHTML = String(html || "") || "<p></p>";
  wrap.querySelectorAll("[data-gi-infographic='1'], [data-gi-infographic-section='1']").forEach((node) => {
    node.remove();
  });
  const cleaned = wrap.innerHTML.trim();
  return cleaned && cleaned !== "<p></p>" ? cleaned : "<p></p>";
}

export function upsertInfographicInHtml(
  html: string,
  next: InfographicItem[],
): string {
  if (typeof document === "undefined") return html;
  const wrap = document.createElement("div");
  wrap.innerHTML = String(html || "") || "<p></p>";
  wrap.querySelectorAll("[data-gi-infographic='1'], [data-gi-infographic-section='1']").forEach((node) => {
    node.remove();
  });

  const blocks = next
    .filter((item) => item.src)
    .map((item) => buildInfographicBlockHtml(item.src, item.caption, item.id))
    .join("");

  if (!blocks) {
    const cleaned = wrap.innerHTML.trim();
    return cleaned && cleaned !== "<p></p>" ? cleaned : "<p></p>";
  }

  const section = document.createElement("div");
  section.setAttribute("data-gi-infographic-section", "1");
  section.className = "gi-report-infographic-section";
  section.innerHTML = `<h3>인포그래픽</h3>${blocks}`;
  wrap.appendChild(section);
  return wrap.innerHTML;
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
