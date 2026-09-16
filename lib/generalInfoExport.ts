import type { GeneralInfoItem } from "../types/generalInfo";
import {
  getGeneralInfoDisplayMediaItems,
  getGeneralInfoFormattedHtml,
} from "./generalInfoHelpers";
import { formatCategoryKeywords } from "./generalInfoText";
import {
  parseParagraphsFromHtml,
  serializeParagraphsToHtml,
} from "./generalInfoParagraphs";

export const GENERAL_INFO_APP_FILE_FORMAT = "airzeta-general-info";
export const GENERAL_INFO_APP_FILE_VERSION = 1;
export const GENERAL_INFO_APP_FILE_EXT = ".airzeta-gi.json";

export type GeneralInfoAppFile = {
  format: typeof GENERAL_INFO_APP_FILE_FORMAT;
  version: number;
  exportedAt: string;
  item: GeneralInfoItem;
};

declare global {
  interface Window {
    html2canvas?: (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
    jspdf?: { jsPDF: new (...args: unknown[]) => JsPdfLike };
  }
}

type JsPdfLike = {
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  addPage: () => void;
  addImage: (
    imageData: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => void;
  output: (type: "blob") => Blob;
  save: (filename: string) => void;
};

function loadScriptOnce(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensurePdfLibs() {
  await loadScriptOnce(
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  );
  await loadScriptOnce(
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  );
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    throw new Error("PDF 라이브러리를 불러오지 못했습니다.");
  }
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFileStem(value: string) {
  return String(value || "general-info")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

export function getGeneralInfoParagraphsForExport(item: GeneralInfoItem) {
  if (Array.isArray(item.paragraphs) && item.paragraphs.length > 0) {
    return item.paragraphs;
  }
  return parseParagraphsFromHtml(getGeneralInfoFormattedHtml(item));
}

/** 굿노트/인쇄용 HTML — 이미지는 contain, 페이지 중간 절단 방지 */
export function buildGeneralInfoExportDocumentHtml(item: GeneralInfoItem) {
  const keywords = formatCategoryKeywords(item.primaryCategory, item.secondaryCategory)
    || (item.keywords || []).map((k) => `#${String(k).replace(/^#+/, "")}`).join("");
  const category = [item.primaryCategory, item.secondaryCategory].filter(Boolean).join(" > ") || "분류 없음";
  const paragraphs = getGeneralInfoParagraphsForExport(item);
  const media = getGeneralInfoDisplayMediaItems(item);

  const paragraphBlocks = paragraphs
    .map((p) => {
      const body = String(p.html || "").trim() || `<p>${escapeHtml(p.text || "")}</p>`;
      return `
        <section class="gi-export-block gi-export-paragraph">
          <div class="gi-export-date">작성 ${escapeHtml(p.createdAt || item.createdAt || "")}</div>
          <div class="gi-export-body">${body}</div>
        </section>`;
    })
    .join("");

  const mediaBlocks = media
    .map((m, index) => {
      const src = String(m.preview || m.fileUrl || "").trim();
      if (!src) return "";
      return `
        <section class="gi-export-block gi-export-media">
          <div class="gi-export-date">${escapeHtml(m.memo || m.name || `인포그래픽 ${index + 1}`)}</div>
          <div class="gi-export-image-wrap">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(m.memo || m.name || `image-${index + 1}`)}" crossorigin="anonymous" />
          </div>
        </section>`;
    })
    .join("");

  return `
    <article class="gi-export-doc" id="gi-export-doc-root">
      <header class="gi-export-block gi-export-header">
        <h1>${escapeHtml(item.title || "일반 정보")}</h1>
        <p>분류: ${escapeHtml(category)}</p>
        <p>키워드: ${escapeHtml(keywords || "없음")}</p>
        <p>저장: ${escapeHtml(item.createdAt || "")}</p>
        ${item.summary ? `<p class="gi-export-summary">${escapeHtml(item.summary)}</p>` : ""}
      </header>
      ${paragraphBlocks}
      ${mediaBlocks}
    </article>
  `;
}

function createOffscreenHost(html: string) {
  const host = document.createElement("div");
  host.id = "gi-export-print-host";
  host.innerHTML = html;
  host.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "width:794px",
    "background:#fff",
    "color:#111",
    "z-index:-1",
    "pointer-events:none",
  ].join(";");

  const style = document.createElement("style");
  style.textContent = `
    #gi-export-print-host, #gi-export-print-host * { box-sizing: border-box; }
    #gi-export-print-host .gi-export-doc {
      font-family: "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      padding: 28px 32px 40px;
      background: #fff;
      color: #111;
    }
    #gi-export-print-host .gi-export-block {
      margin: 0 0 18px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    #gi-export-print-host .gi-export-header h1 {
      font-size: 24px;
      margin: 0 0 10px;
      line-height: 1.35;
    }
    #gi-export-print-host .gi-export-header p {
      margin: 0 0 4px;
      font-size: 13px;
      color: #444;
    }
    #gi-export-print-host .gi-export-summary {
      margin-top: 10px !important;
      padding: 10px 12px;
      background: #f8fafc;
      border-left: 3px solid #38bdf8;
      white-space: pre-wrap;
    }
    #gi-export-print-host .gi-export-date {
      font-size: 12px;
      color: #64748b;
      margin: 0 0 8px;
    }
    #gi-export-print-host .gi-export-body {
      font-size: 14px;
      line-height: 1.75;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #gi-export-print-host .gi-export-body img,
    #gi-export-print-host .gi-export-image-wrap img {
      display: block;
      max-width: 100%;
      width: auto;
      height: auto;
      max-height: 900px;
      object-fit: contain;
      margin: 10px 0;
      border-radius: 8px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    #gi-export-print-host .gi-export-image-wrap {
      text-align: center;
      background: #fafafa;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 12px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  `;
  host.prepend(style);
  document.body.appendChild(host);
  return host;
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
}

/**
 * 블록 단위로 캡처해 PDF에 넣음.
 * 한 블록이 페이지보다 크면 비율 축소해 한 페이지에 맞춤(이미지 절단 없음).
 */
export async function buildGeneralInfoPdfBlob(item: GeneralInfoItem): Promise<Blob> {
  await ensurePdfLibs();
  const host = createOffscreenHost(buildGeneralInfoExportDocumentHtml(item));
  try {
    await waitForImages(host);
    const blocks = Array.from(
      host.querySelectorAll<HTMLElement>(".gi-export-block"),
    );
    const pdf = new window.jspdf!.jsPDF("p", "mm", "a4") as JsPdfLike;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    let cursorY = margin;

    for (const block of blocks) {
      const canvas = await window.html2canvas!(block, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      let drawW = maxW;
      let drawH = (canvas.height * drawW) / canvas.width;

      // 페이지 높이보다 크면 축소(자르지 않음)
      if (drawH > maxH) {
        const scale = maxH / drawH;
        drawH *= scale;
        drawW *= scale;
      }

      if (cursorY + drawH > pageH - margin) {
        pdf.addPage();
        cursorY = margin;
      }

      const x = margin + (maxW - drawW) / 2;
      pdf.addImage(imgData, "JPEG", x, cursorY, drawW, drawH);
      cursorY += drawH + 4;
    }

    return pdf.output("blob");
  } finally {
    host.remove();
  }
}

export async function downloadGeneralInfoPdf(item: GeneralInfoItem) {
  const blob = await buildGeneralInfoPdfBlob(item);
  const filename = `${safeFileStem(item.title || "general-info")}.pdf`;
  triggerBlobDownload(blob, filename);
  return filename;
}

/** 굿노트 등에서 열 수 있도록 PDF 파일 공유 */
export async function shareGeneralInfoPdfForGoodNotes(item: GeneralInfoItem) {
  const blob = await buildGeneralInfoPdfBlob(item);
  const filename = `${safeFileStem(item.title || "general-info")}.pdf`;
  const file = new File([blob], filename, { type: "application/pdf" });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: item.title || "일반 정보",
      text: "GoodNotes에서 열어 필기할 수 있는 PDF입니다.",
    });
    return { mode: "share" as const, filename };
  }

  triggerBlobDownload(blob, filename);
  return { mode: "download" as const, filename };
}

export function buildGeneralInfoAppFile(item: GeneralInfoItem): GeneralInfoAppFile {
  const paragraphs = getGeneralInfoParagraphsForExport(item);
  return {
    format: GENERAL_INFO_APP_FILE_FORMAT,
    version: GENERAL_INFO_APP_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    item: {
      ...item,
      paragraphs,
      formattedTextHtml:
        serializeParagraphsToHtml(paragraphs) || item.formattedTextHtml || "",
      text: item.text || paragraphs.map((p) => p.text).filter(Boolean).join("\n\n"),
    },
  };
}

export function downloadGeneralInfoAppFile(item: GeneralInfoItem) {
  const payload = buildGeneralInfoAppFile(item);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const filename = `${safeFileStem(item.title || "general-info")}${GENERAL_INFO_APP_FILE_EXT}`;
  triggerBlobDownload(blob, filename);
  return filename;
}

export async function parseGeneralInfoAppFile(file: File): Promise<GeneralInfoItem> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("앱파일 JSON을 읽지 못했습니다.");
  }

  const root = parsed as Record<string, unknown>;
  const itemRaw =
    root.format === GENERAL_INFO_APP_FILE_FORMAT && root.item && typeof root.item === "object"
      ? (root.item as Record<string, unknown>)
      : root;

  const id = Number(itemRaw.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("유효한 일반 정보 앱파일이 아닙니다.");
  }

  const title = String(itemRaw.title || "").trim();
  if (!title) throw new Error("앱파일에 제목이 없습니다.");

  const paragraphs = Array.isArray(itemRaw.paragraphs)
    ? (itemRaw.paragraphs as GeneralInfoItem["paragraphs"])
    : parseParagraphsFromHtml(String(itemRaw.formattedTextHtml || ""));

  return {
    id,
    title,
    inputTypes: Array.isArray(itemRaw.inputTypes)
      ? (itemRaw.inputTypes as GeneralInfoItem["inputTypes"])
      : ["text"],
    text: String(itemRaw.text || ""),
    sourceUrl: itemRaw.sourceUrl ? String(itemRaw.sourceUrl) : undefined,
    fileName: itemRaw.fileName ? String(itemRaw.fileName) : undefined,
    filePreview: itemRaw.filePreview ? String(itemRaw.filePreview) : undefined,
    mediaItems: Array.isArray(itemRaw.mediaItems)
      ? (itemRaw.mediaItems as GeneralInfoItem["mediaItems"])
      : [],
    primaryCategory: String(itemRaw.primaryCategory || ""),
    secondaryCategory: String(itemRaw.secondaryCategory || ""),
    thirdCategory: String(itemRaw.thirdCategory || ""),
    keywords: Array.isArray(itemRaw.keywords)
      ? itemRaw.keywords.map((k) => String(k))
      : [],
    factCheckStatus: (itemRaw.factCheckStatus as GeneralInfoItem["factCheckStatus"]) || "확인 전",
    factCheckSummary: String(itemRaw.factCheckSummary || ""),
    summary: String(itemRaw.summary || ""),
    extraNote: itemRaw.extraNote ? String(itemRaw.extraNote) : undefined,
    formattedTextHtml: String(itemRaw.formattedTextHtml || ""),
    paragraphs,
    confirmed: itemRaw.confirmed !== false,
    createdAt: String(itemRaw.createdAt || new Date().toLocaleString("ko-KR")),
    isPinned: Boolean(itemRaw.isPinned),
  };
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
