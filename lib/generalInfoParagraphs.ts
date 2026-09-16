import type { GeneralInfoParagraph } from "../types/generalInfo";
import { sanitizeGeneralInfoHtml } from "./sanitizeHtml";
import { makeGeneralInfoHtmlFromText } from "./generalInfoHelpers";

const nowParagraphDate = () => new Date().toLocaleString("ko-KR");

export function createEmptyParagraph(createdAt = nowParagraphDate()): GeneralInfoParagraph {
  return {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    html: "",
    text: "",
    createdAt,
  };
}

function escapeAttr(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value: string) {
  return escapeAttr(value);
}

function htmlToPlain(html: string) {
  if (typeof document !== "undefined") {
    const el = document.createElement("div");
    el.innerHTML = String(html || "");
    return String(el.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function normalizeParagraph(input: Partial<GeneralInfoParagraph> | null | undefined): GeneralInfoParagraph {
  const html = sanitizeGeneralInfoHtml(String(input?.html || "").trim());
  const text = String(input?.text || "").trim() || htmlToPlain(html);
  return {
    id: String(input?.id || "").trim() || createEmptyParagraph().id,
    html,
    text,
    createdAt: String(input?.createdAt || "").trim() || nowParagraphDate(),
  };
}

export function serializeParagraphsToHtml(paragraphs: GeneralInfoParagraph[]): string {
  const list = (Array.isArray(paragraphs) ? paragraphs : [])
    .map(normalizeParagraph)
    .filter((p) => p.html.trim() || p.text.trim());

  if (!list.length) return "";

  return list
    .map((p) => {
      const body = p.html.trim() || makeGeneralInfoHtmlFromText(p.text);
      return [
        `<section class="gi-body-paragraph" data-gi-paragraph="1" data-gi-paragraph-id="${escapeAttr(p.id)}" data-gi-created-at="${escapeAttr(p.createdAt)}">`,
        `<div class="gi-paragraph-date">작성 ${escapeHtml(p.createdAt)}</div>`,
        `<div class="gi-paragraph-body">${body}</div>`,
        `</section>`,
      ].join("");
    })
    .join("");
}

export function parseParagraphsFromHtml(html: string): GeneralInfoParagraph[] {
  const raw = String(html || "").trim();
  if (!raw) return [createEmptyParagraph()];

  if (typeof document === "undefined") {
    return [
      normalizeParagraph({
        id: `p-legacy-${Date.now()}`,
        html: sanitizeGeneralInfoHtml(raw),
        text: htmlToPlain(raw),
        createdAt: nowParagraphDate(),
      }),
    ];
  }

  const wrap = document.createElement("div");
  wrap.innerHTML = sanitizeGeneralInfoHtml(raw);
  const nodes = Array.from(wrap.querySelectorAll("[data-gi-paragraph='1']"));

  if (!nodes.length) {
    return [
      normalizeParagraph({
        id: `p-legacy-${Date.now()}`,
        html: sanitizeGeneralInfoHtml(raw),
        text: htmlToPlain(raw),
        createdAt: nowParagraphDate(),
      }),
    ];
  }

  return nodes.map((node, index) => {
    const el = node as HTMLElement;
    const body =
      el.querySelector(".gi-paragraph-body")?.innerHTML ||
      el.innerHTML;
    const createdAt =
      el.getAttribute("data-gi-created-at") ||
      el.querySelector(".gi-paragraph-date")?.textContent?.replace(/^작성\s*/, "").trim() ||
      nowParagraphDate();
    return normalizeParagraph({
      id: el.getAttribute("data-gi-paragraph-id") || `p-${index + 1}`,
      html: body,
      text: htmlToPlain(body),
      createdAt,
    });
  });
}

export function paragraphsToPlainText(paragraphs: GeneralInfoParagraph[]): string {
  return (Array.isArray(paragraphs) ? paragraphs : [])
    .map((p) => String(p.text || htmlToPlain(p.html) || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function isParagraphEmpty(paragraph: GeneralInfoParagraph | null | undefined) {
  if (!paragraph) return true;
  return !String(paragraph.text || "").trim() && !String(paragraph.html || "").replace(/<[^>]*>/g, "").trim();
}
