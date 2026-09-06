import { supabase } from "./supabaseClient";
const TRAVEL_DIARY_BUCKET = "info-photos";
import { sanitizeGeneralInfoHtml } from "./sanitizeHtml";
import type { GeneralInfoItem } from "../types/generalInfo";

export type GeneralInfoMediaItem = NonNullable<GeneralInfoItem["mediaItems"]>[number];

type MediaSource = {
  fileName?: string;
  filePreview?: string;
  fileType?: "none" | "image" | "video";
  mediaItems?: GeneralInfoMediaItem[];
};

export const makeGeneralInfoMediaItem = (
  name: string,
  type: "none" | "image" | "video",
  preview: string,
  storagePath?: string,
  fileUrl?: string,
): GeneralInfoMediaItem => ({
  id: Date.now() + Math.floor(Math.random() * 100000),
  name,
  type,
  preview,
  storagePath,
  fileUrl,
});

export const normalizeGeneralInfoMediaItems = (draftOrItem: MediaSource) => {
  const mediaItems = Array.isArray(draftOrItem.mediaItems)
    ? draftOrItem.mediaItems.filter((item) => item && (item.preview || item.fileUrl || item.storagePath))
    : [];

  if (mediaItems.length > 0) return mediaItems;

  if (draftOrItem.filePreview) {
    return [
      {
        id: Date.now(),
        name: draftOrItem.fileName || "대표 이미지",
        type: draftOrItem.fileType || "image",
        preview: draftOrItem.filePreview,
        storagePath: undefined,
        fileUrl: undefined,
      },
    ];
  }

  return [];
};

export const getGeneralInfoMainMedia = (draftOrItem: MediaSource) =>
  normalizeGeneralInfoMediaItems(draftOrItem)[0];

export const getGeneralInfoInputCountText = (item: GeneralInfoItem) => {
  const mediaItems = Array.isArray(item.mediaItems) ? item.mediaItems : [];
  const textCount = String(item.text || "").trim() ? 1 : 0;
  const urlCount = String(item.sourceUrl || "").trim() ? 1 : 0;
  const mediaImageCount = mediaItems.filter((media) => media.type === "image").length;
  const mediaVideoCount = mediaItems.filter((media) => media.type === "video").length;
  const imageCount = Math.max(mediaImageCount, item.inputTypes.includes("image") ? 1 : 0);
  const videoCount = Math.max(mediaVideoCount, item.inputTypes.includes("video") ? 1 : 0);

  const parts = [
    imageCount > 0 ? `사진 ${imageCount}장` : "",
    videoCount > 0 ? `동영상 ${videoCount}건` : "",
    urlCount > 0 ? `URL ${urlCount}건` : "",
    textCount > 0 ? `Text ${textCount}건` : "",
  ].filter(Boolean);

  return parts.join(" · ") || item.inputTypes.join(" + ") || "입력자료 없음";
};

export const getGeneralInfoCategoryPath = (item: GeneralInfoItem) =>
  [item.primaryCategory, item.secondaryCategory, item.thirdCategory]
    .filter(Boolean)
    .join(" > ") || "분류 미정";

export const splitSummaryParagraphs = (summary: string): string[] => {
  const text = String(summary || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return [""];
  const parts = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [""];
};

export const joinSummaryParagraphs = (paragraphs: string[]): string =>
  paragraphs
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");

export const BODY_PARAGRAPH_CLASS = "gi-body-paragraph";

export const splitBodyParagraphHtml = (html: string): string[] => {
  const raw = String(html || "").trim();
  if (!raw) return [""];
  if (typeof document === "undefined") return [raw];
  const holder = document.createElement("div");
  holder.innerHTML = raw;
  const marked = Array.from(holder.children).filter((el) =>
    el.classList.contains(BODY_PARAGRAPH_CLASS),
  ) as HTMLElement[];
  if (marked.length > 0) {
    return marked.map((el) => el.innerHTML);
  }
  return [raw];
};

export const joinBodyParagraphHtml = (paragraphs: string[]): string =>
  paragraphs
    .map((html) => String(html || "").trim())
    .map((html) => `<div class="${BODY_PARAGRAPH_CLASS}">${html || "<br>"}</div>`)
    .join("");

export const getGeneralInfoFactLabel = (item: GeneralInfoItem) => {
  if (item.factCheckStatus === "확인 완료") return "✅ Fact Check 완료";
  if (item.factCheckStatus === "확인 필요") return "⚠️ 확인 필요";
  if (item.factCheckStatus === "오류 가능성") return "🚨 오류 가능성";
  return "🟡 확인 전";
};

export const makeGeneralInfoSearchText = (item: GeneralInfoItem) => {
  const mediaItems = normalizeGeneralInfoMediaItems(item);
  const inputCountText = getGeneralInfoInputCountText(item);
  const categoryPathText = getGeneralInfoCategoryPath(item);
  const factLabelText = getGeneralInfoFactLabel(item);
  const imageCount = mediaItems.filter((media) => media.type === "image").length;
  const videoCount = mediaItems.filter((media) => media.type === "video").length;

  const mediaWords = [
    imageCount > 0 ? "사진" : "",
    imageCount > 0 ? "이미지" : "",
    imageCount > 0 ? "image" : "",
    imageCount > 0 ? `사진 ${imageCount}장` : "",
    imageCount > 0 ? `사진${imageCount}장` : "",
    imageCount > 0 ? `이미지 ${imageCount}장` : "",
    imageCount > 0 ? `이미지${imageCount}장` : "",
    videoCount > 0 ? "동영상" : "",
    videoCount > 0 ? "video" : "",
    videoCount > 0 ? `동영상 ${videoCount}건` : "",
    videoCount > 0 ? `동영상${videoCount}건` : "",
    item.inputTypes.includes("text") ? "text 텍스트 본문" : "",
    item.inputTypes.includes("url") ? "url 링크 출처" : "",
  ];

  return [
    item.title,
    item.text,
    item.sourceUrl,
    item.primaryCategory,
    item.secondaryCategory,
    item.thirdCategory,
    ...(item.keywords || []),
    item.summary,
    item.factCheckStatus,
    item.factCheckSummary,
    item.extraNote,
    inputCountText,
    categoryPathText,
    factLabelText,
    ...mediaWords,
    ...mediaItems.map((media) => media.name),
    ...mediaItems.map((media) => media.type),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

export const filterGeneralInfoItemsBySearch = (
  source: GeneralInfoItem[],
  keyword: string,
) => {
  const rawKeyword = keyword.trim().toLowerCase();
  if (!rawKeyword) return source;

  return source.filter((item) => {
    const searchText = makeGeneralInfoSearchText(item);
    const compactSearchText = searchText.replace(/[\s,+/|]+/g, "");
    const compactRawKeyword = rawKeyword.replace(/[\s,+/|]+/g, "");

    if (compactRawKeyword && compactSearchText.includes(compactRawKeyword)) {
      return true;
    }

    const tokens = rawKeyword
      .split(/[\s,+/|]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    return tokens.every((token) => {
      const compactToken = token.replace(/[\s,+/|]+/g, "");
      return searchText.includes(token) || compactSearchText.includes(compactToken);
    });
  });
};

export const escapeGeneralInfoHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const makeGeneralInfoHtmlFromText = (value: string) =>
  escapeGeneralInfoHtml(value)
    .replace(/  /g, " &nbsp;")
    .replace(/\n/g, "<br />");

export const getGeneralInfoFormattedHtml = (item: GeneralInfoItem) => {
  const html = String(item.formattedTextHtml || "").trim();
  if (html) return sanitizeGeneralInfoHtml(html);
  return makeGeneralInfoHtmlFromText(item.text || "");
};

/** Replace data: image sources in rich HTML after Storage upload. */
export const replaceHtmlMediaSources = (
  html: string,
  replacements: Array<{ from: string; to: string }>,
) => {
  let next = String(html || "");
  replacements.forEach(({ from, to }) => {
    if (!from || !to || from === to) return;
    if (!next.includes(from)) return;
    next = next.split(from).join(to);
  });
  return next;
};

/** Collect image/video src values from rich HTML (data: or http). */
export const extractMediaSrcFromHtml = (html: string): string[] => {
  const raw = String(html || "");
  const found: string[] = [];
  const re = /<(?:img|video)[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const src = String(match[1] || "").trim();
    if (src && !found.includes(src)) found.push(src);
  }
  return found;
};

/** 본문 TEXT / AI 보고서 등 HTML에 들어 있는 이미지 URL 목록 */
export const extractGeneralInfoBodyImageSrcs = (
  ...htmlParts: Array<string | undefined | null>
): string[] => {
  const found: string[] = [];
  htmlParts.forEach((part) => {
    extractMediaSrcFromHtml(String(part || "")).forEach((src) => {
      if (!/^(https?:\/\/|data:|blob:)/i.test(src)) return;
      if (src.startsWith("data:") && src.length < 64) return;
      if (!found.includes(src)) found.push(src);
    });
  });
  return found;
};

/** AI 검증 보고서(Fact Check HTML)에 들어 있는 이미지 URL 목록 */
export const extractGeneralInfoReportImageSrcs = extractGeneralInfoBodyImageSrcs;

/** AI 검증 보고서 HTML 병합: 단순 길이 비교는 이미지 삭제를 되돌리므로 본문·이미지 수 기준으로 고른다 */
export const pickPreferredFactCheckSummary = (
  primary: string | undefined | null,
  fallback: string | undefined | null,
): string => {
  const a = salvageFactCheckHtml(String(primary || ""));
  const b = salvageFactCheckHtml(String(fallback || ""));
  if (!a) return b;
  if (!b) return a;

  const plainA = htmlToPlainText(a).trim().length;
  const plainB = htmlToPlainText(b).trim().length;
  const imgsA = extractMediaSrcFromHtml(a).length;
  const imgsB = extractMediaSrcFromHtml(b).length;

  // 본문 텍스트가 비슷한데 이미지만 줄었으면(삭제) 이미지 적은 쪽을 채택
  if (Math.abs(plainA - plainB) <= 100 && imgsA !== imgsB) {
    return imgsA < imgsB ? a : b;
  }

  // 본문이 한쪽만 거의 비면 내용 있는 쪽
  if (plainA >= 80 && plainB < 40) return a;
  if (plainB >= 80 && plainA < 40) return b;

  // 그 외에는 본문이 더 긴 쪽 (잘림 방지). 동률이면 primary 유지
  return plainA >= plainB ? a : b;
};

/**
 * 잘린 data: 이미지 태그(닫는 따옴표 없음)가 이후 본문을 삼키지 않도록
 * 깨진 미디어 태그 이전까지만 남기거나, 완성된 data: 미디어 블록을 제거한다.
 */
export const salvageFactCheckHtml = (html: string): string => {
  let raw = String(html || "");
  if (!raw) return "";

  // 닫히지 않은 data: src 미디어 태그 → 그 이전만 유지 (이후는 속성값으로 먹힌 상태)
  const brokenRe = /<(?:img|video)\b[^>]*\bsrc=["']data:/gi;
  let match: RegExpExecArray | null;
  while ((match = brokenRe.exec(raw)) !== null) {
    const fromTag = raw.slice(match.index);
    const properlyClosed = /^<(?:img|video)\b[^>]*\bsrc=["']data:[^"']{32,}["'][^>]*>/i.test(fromTag);
    if (!properlyClosed) {
      raw = raw.slice(0, match.index).trim();
      break;
    }
  }

  return raw;
};

/** 저장용: data: 인라인 이미지는 제거(업로드 실패 잔여분). https 이미지는 유지. */
export const stripDataMediaFromHtml = (html: string): string => {
  let next = salvageFactCheckHtml(html);
  next = next.replace(
    /<div[^>]*class=["'][^"']*generalInfoInlineImageBlock[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    (block) => (/src=["']data:/i.test(block) ? "" : block),
  );
  next = next.replace(/<(?:img|video)\b[^>]*\bsrc=["']data:[^"']*["'][^>]*\/?>/gi, "");
  return next.trim();
};

export const findInlineImageTrigger = (
  editor: HTMLElement,
): { textNode: Text; start: number; end: number } | null => {
  if (!editor) return null;

  const triggerAtEnd = /[ \t]*[Ss][ \t]*$/;
  const triggerBeforeCaret = /[ \t]*[Ss]$/;

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
    const anchor = selection.anchorNode;
    if (anchor?.nodeType === Node.TEXT_NODE) {
      const textNode = anchor as Text;
      const text = String(textNode.nodeValue || "");
      const caret = Math.min(selection.anchorOffset, text.length);
      const before = text.slice(0, caret);
      const match = before.match(triggerBeforeCaret);
      if (match) {
        return {
          textNode,
          start: before.length - match[0].length,
          end: before.length,
        };
      }
      if (caret === text.length) {
        const endMatch = text.match(triggerAtEnd);
        if (endMatch) {
          return {
            textNode,
            start: text.length - endMatch[0].length,
            end: text.length,
          };
        }
      }
    }
  }

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let lastWithTrigger: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (triggerAtEnd.test(String(node.nodeValue || ""))) {
      lastWithTrigger = node;
    }
  }
  if (!lastWithTrigger) return null;
  const text = String(lastWithTrigger.nodeValue || "");
  const endMatch = text.match(triggerAtEnd);
  if (!endMatch) return null;
  return {
    textNode: lastWithTrigger,
    start: text.length - endMatch[0].length,
    end: text.length,
  };
};

export const editorHasInlineImageTrigger = (editor: HTMLElement | null) =>
  Boolean(editor && findInlineImageTrigger(editor));

export const removeInlineImageTrigger = (editor: HTMLElement | null) => {
  if (!editor) return null;
  const trigger = findInlineImageTrigger(editor);
  if (!trigger) return null;

  const { textNode, start, end } = trigger;
  const text = String(textNode.nodeValue || "");
  textNode.nodeValue = `${text.slice(0, start)}${text.slice(end)}`;

  // S가 있던 문단(또는 텍스트 부모) 바로 다음에 이미지를 넣을 기준 노드
  const host =
    (textNode.parentElement?.closest("div, p, h3, h4, h5, li, section") as HTMLElement | null) ||
    textNode.parentElement;
  // 편집기 자신을 afterNode로 주면 이미지가 본문 밖 형제로 들어간다.
  if (!host || host === editor) return textNode;
  return host;
};

/** 같은 파일을 files+items 등으로 두 번 받지 않도록 중복 제거 */
export const dedupeImageFiles = (files: File[]): File[] => {
  const seen = new Set<string>();
  const out: File[] = [];
  for (const file of files) {
    const key = `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
};

/** 클립보드에서 이미지 File만 수집 (files/items 중복 제거) */
export const collectClipboardImageFiles = (clipboardData: DataTransfer | null): File[] => {
  if (!clipboardData) return [];
  const collected: File[] = [];
  if (clipboardData.files?.length) {
    Array.from(clipboardData.files).forEach((file) => {
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        collected.push(file);
      }
    });
  }
  if (clipboardData.items) {
    Array.from(clipboardData.items).forEach((item) => {
      if (item.kind !== "file") return;
      if (!(item.type.startsWith("image/") || item.type.startsWith("video/"))) return;
      const file = item.getAsFile();
      if (file) collected.push(file);
    });
  }
  return dedupeImageFiles(collected);
};

export const insertInlineMediaIntoEditor = (
  editor: HTMLElement,
  items: Array<{ src: string; name?: string; type?: "image" | "video" }>,
  options?: { afterNode?: Node | null; range?: Range | null },
) => {
  if (!editor || !items.length) return;

  const uniqueItems: Array<{ src: string; name?: string; type?: "image" | "video" }> = [];
  const seenSrc = new Set<string>();
  for (const item of items) {
    const src = String(item.src || "").trim();
    if (!src || seenSrc.has(src)) continue;
    seenSrc.add(src);
    uniqueItems.push(item);
  }
  if (!uniqueItems.length) return;

  let insertAfter: Node | null = options?.afterNode || null;
  if (insertAfter && insertAfter !== editor) {
    // contentEditable 안 span/font 등 인라인 태그 안에는 block 이미지를 넣지 않고
    // 편집기 직계 자식 기준으로 삽입해 HierarchyRequest / 본문 밖 이탈을 막는다.
    let node: Node | null = insertAfter;
    while (node && node.parentNode && node.parentNode !== editor) {
      node = node.parentNode;
    }
    insertAfter = node && node.parentNode === editor ? node : null;
  }
  let pendingRange = !insertAfter && options?.range ? options.range : null;

  uniqueItems.forEach((item) => {
    const block = document.createElement("div");
    block.className = "generalInfoInlineImageBlock";

    if (item.type === "video") {
      const video = document.createElement("video");
      video.src = item.src;
      video.controls = true;
      video.className = "generalInfoInlineImage generalInfoInlineVideo";
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.setAttribute("contenteditable", "false");
      video.setAttribute("draggable", "false");
      block.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = item.name || "본문 이미지";
      img.className = "generalInfoInlineImage";
      img.setAttribute("contenteditable", "false");
      img.setAttribute("draggable", "false");
      img.setAttribute("loading", "eager");
      block.appendChild(img);
    }

    block.setAttribute("contenteditable", "false");
    block.setAttribute("data-gi-media", "1");

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "generalInfoInlineImageRemove";
    removeBtn.setAttribute("contenteditable", "false");
    removeBtn.setAttribute("aria-label", "이미지 삭제");
    removeBtn.textContent = "×";
    block.appendChild(removeBtn);

    if (insertAfter === editor) {
      editor.appendChild(block);
      insertAfter = block;
      pendingRange = null;
    } else if (insertAfter && insertAfter.parentNode === editor) {
      editor.insertBefore(block, insertAfter.nextSibling);
      insertAfter = block;
      pendingRange = null;
    } else if (pendingRange) {
      try {
        pendingRange.deleteContents();
        pendingRange.insertNode(block);
        pendingRange.setStartAfter(block);
        pendingRange.collapse(true);
      } catch {
        editor.appendChild(block);
      }
      insertAfter = block;
      pendingRange = null;
    } else {
      editor.appendChild(block);
      insertAfter = block;
    }
  });

  const spacer = document.createElement("div");
  spacer.innerHTML = "<br>";
  if (insertAfter && insertAfter.parentNode === editor) {
    editor.insertBefore(spacer, insertAfter.nextSibling);
  } else {
    editor.appendChild(spacer);
  }

  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(spacer);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  enhanceInlineImageBlocks(editor);
  bindInlineImageRemoveHandler(editor);
};

/** 기존 인라인 이미지에 삭제(×) 버튼 보강 */
export const enhanceInlineImageBlocks = (editor: HTMLElement | null) => {
  if (!editor) return;

  editor.querySelectorAll("img.generalInfoInlineImage, video.generalInfoInlineImage, img").forEach((media) => {
    const el = media as HTMLImageElement | HTMLVideoElement;
    if (el.tagName !== "IMG" && el.tagName !== "VIDEO") return;
    if (el.tagName === "IMG" && !el.classList.contains("generalInfoInlineImage")) {
      // 근거 이미지 등 일반 img도 편집기 안이면 삭제 가능하게
      if (!editor.contains(el)) return;
      el.classList.add("generalInfoInlineImage");
    }

    // iOS Safari: contentEditable 안 이미지는 false 가 아니면 안 보이거나 터치 불가인 경우가 많음
    el.setAttribute("contenteditable", "false");
    el.setAttribute("draggable", "false");
    if (el.tagName === "IMG") {
      el.setAttribute("loading", "eager");
      el.setAttribute("decoding", "async");
      // 깨진/미페인트 시에도 자리·삭제 버튼이 남도록
      if (!el.getAttribute("alt")) el.setAttribute("alt", "보고서 이미지");
    }
    if (el.tagName === "VIDEO") {
      el.setAttribute("playsinline", "true");
      el.setAttribute("webkit-playsinline", "true");
      el.setAttribute("controls", "true");
    }

    let block = el.closest(".generalInfoInlineImageBlock") as HTMLElement | null;
    if (!block) {
      block = document.createElement("div");
      block.className = "generalInfoInlineImageBlock";
      el.parentNode?.insertBefore(block, el);
      block.appendChild(el);
    }
    block.setAttribute("contenteditable", "false");
    block.setAttribute("data-gi-media", "1");

    if (block.querySelector(".generalInfoInlineImageRemove")) return;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "generalInfoInlineImageRemove";
    removeBtn.setAttribute("contenteditable", "false");
    removeBtn.setAttribute("aria-label", "이미지 삭제");
    removeBtn.textContent = "×";
    block.appendChild(removeBtn);
  });
};

export const bindInlineImageRemoveHandler = (editor: HTMLElement | null) => {
  if (!editor) return;
  const flagged = editor as HTMLElement & { __inlineImageRemoveBound?: boolean };
  if (flagged.__inlineImageRemoveBound) return;
  flagged.__inlineImageRemoveBound = true;

  const removeFromEvent = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest?.(".generalInfoInlineImageRemove") as HTMLElement | null;
    if (!btn || !editor.contains(btn)) return;
    event.preventDefault();
    event.stopPropagation();
    btn.closest(".generalInfoInlineImageBlock")?.remove();
  };

  // iOS: click 이 씹히는 경우가 있어 capture 로 처리
  editor.addEventListener("click", removeFromEvent, true);
};

/** 편집기 HTML에서 특정 src 이미지/비디오 블록 제거 */
export const removeInlineMediaBySrc = (editor: HTMLElement | null, src: string) => {
  if (!editor || !src) return false;
  const normalize = (value: string) => {
    const raw = String(value || "").trim();
    try {
      return decodeURIComponent(raw.replace(/&amp;/gi, "&"));
    } catch {
      return raw.replace(/&amp;/gi, "&");
    }
  };
  const sameSrc = (a: string, b: string) => {
    if (!a || !b) return false;
    if (a === b) return true;
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return true;
    const strip = (s: string) => s.split("?")[0].split("#")[0];
    return strip(na) === strip(nb);
  };

  const target = String(src || "").trim();
  let removed = false;
  editor.querySelectorAll("img, video").forEach((media) => {
    const el = media as HTMLImageElement | HTMLVideoElement;
    const current = String(el.getAttribute("src") || el.src || "");
    if (!sameSrc(current, target)) return;
    const block = el.closest(".generalInfoInlineImageBlock");
    if (block) block.remove();
    else el.remove();
    removed = true;
  });
  return removed;
};

/** HTML 문자열에서 특정 src 미디어 제거 (에디터 미존재/미매칭 대비) */
export const removeMediaSrcFromHtml = (html: string, src: string): string => {
  let next = String(html || "");
  const raw = String(src || "").trim();
  if (!next || !raw) return next;

  const variants = Array.from(
    new Set([
      raw,
      raw.replace(/&/g, "&amp;"),
      (() => {
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      })(),
    ]),
  );

  variants.forEach((variant) => {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(
      new RegExp(
        `<div[^>]*class=["'][^"']*generalInfoInlineImageBlock[^"']*["'][^>]*>[\\s\\S]*?src=["']${escaped}["'][\\s\\S]*?<\\/div>`,
        "gi",
      ),
      "",
    );
    next = next.replace(
      new RegExp(`<(?:img|video)\\b[^>]*\\bsrc=["']${escaped}["'][^>]*\\/?>`, "gi"),
      "",
    );
  });

  return next.replace(/\n{3,}/g, "\n\n").trim();
};

/** iOS 등에서 안 그려진 이미지 src 재지정으로 다시 로드 */
export const refreshInlineImagesInEditor = (editor: HTMLElement | null) => {
  if (!editor) return;
  enhanceInlineImageBlocks(editor);
  editor.querySelectorAll("img").forEach((media) => {
    const img = media as HTMLImageElement;
    const src = String(img.getAttribute("src") || "").trim();
    if (!src) return;
    if (img.complete && img.naturalWidth > 0) return;
    img.src = "";
    img.src = src;
  });
};

export const readFilesAsDataUrls = (files: File[]): Promise<Array<{ file: File; dataUrl: string }>> =>
  Promise.all(
    files.map(
      (file) =>
        new Promise<{ file: File; dataUrl: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ file, dataUrl: String(reader.result || "") });
          reader.onerror = () => reject(reader.error || new Error("file read failed"));
          reader.readAsDataURL(file);
        }),
    ),
  );

export const looksLikeHtmlContent = (value: string) =>
  /<\/?[a-z][\s\S]*>/i.test(String(value || ""));

export const htmlToPlainText = (html: string) =>
  String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    // 깨진 태그 잔여: `10px,padding-top:4px;border-top:...;color:#f8fafc;`
    .replace(
      /(?:^|[\n\s])(?:\d+px\s*,\s*)?(?:margin|padding(?:-[a-z]+)?|font-size|font-weight|line-height|border(?:-[a-z]+)?|color|background(?:-[a-z]+)?|letter-spacing|text-align|display|height|width)\s*:[^;\n<>]{0,80};?/gi,
      "\n",
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** 한 덩어리로 붙은 보고서 텍스트에 문단/목록 줄바꿈을 복원 */
export const normalizeReportPlainText = (text: string) => {
  let t = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n");

  // Gemini가 "##\n1. 제목"처럼 줄바꿈한 헤더를 "## 1. 제목"으로 합침
  t = t.replace(/(#{1,3})\s*\n+(\d+\.\s*)/g, "$1 $2");
  t = t.replace(/(#{1,3})\s*\n+(?=\S)/g, "$1 ");

  // 섹션 헤더(# / ## / ###) 앞에 빈 줄
  t = t.replace(/([^\n])\s*(#{1,3}\s+)/g, "$1\n\n$2");
  // ## 1. … / ## 이 자료의 주제 형태를 독립 문단으로
  t = t.replace(/\n*(#{1,3}\s+\d+\.\s*[^\n]+)/g, "\n\n$1\n");
  t = t.replace(/\n*(#{1,3}\s+[^\n]+)/g, "\n\n$1\n");

  // 원형 숫자(①~⑳) 앞에서 문단 분리
  t = t.replace(/\s*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*/g, "\n\n$1 ");
  // 불릿 (*   / -  ) 정리
  t = t.replace(/^\*\s+/gm, "* ");
  t = t.replace(/^-\s+/gm, "- ");
  t = t.replace(/([^\n])\s+\*\s+/g, "$1\n* ");
  t = t.replace(/([^\n])\s+-\s+(?=[가-힣A-Za-z0-9「『“"'(\[])/g, "$1\n- ");
  // 숫자 목록 1. 2. / 1) 2) — 단, ## 1. 헤더는 제외
  t = t.replace(/([^\n#])\s+(\d{1,2})([.)])\s+/g, "$1\n\n$2$3 ");
  // 문장 끝 뒤 긴 공백을 문단으로
  t = t.replace(/([.。!?…])\s{2,}/g, "$1\n\n");
  // (출처: …) 뒤 문장 분리 보조
  t = t.replace(/(\(출처:[^)]+\))\s+(?=[가-힣A-Za-z0-9「『])/g, "$1\n");

  return t.replace(/\n{3,}/g, "\n\n").trim();
};

/** Fact Check「확인 내용」표시/편집용 — HTML·인라인 스타일 제거 후 문단 정리 */
export const cleanFactCheckSummaryText = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hasHtmlOrStyleDebris =
    looksLikeHtmlContent(raw) ||
    /(?:margin|padding|font-size|font-weight|line-height|border-top)\s*:\s*[^;]+;/i.test(raw);
  const plain = hasHtmlOrStyleDebris ? htmlToPlainText(raw) : raw;
  return normalizeReportPlainText(plain);
};

const isAiVerificationReportPlain = (plain: string) =>
  /AI 검증 보고서/i.test(plain) ||
  /^#{1,3}\s*\d+\.\s*/m.test(plain) ||
  /^##\s+/m.test(plain);

/** 짧은 자동분류 메모가 아닌, 실제 AI 검증 보고서인지 판별 */
export const isFullAiVerificationReport = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const plain = looksLikeHtmlContent(raw) ? htmlToPlainText(raw) : raw;
  if (/AI 검증 보고서/i.test(plain)) return true;
  if (plain.includes("##") && plain.length >= 150) return true;
  // 구조화 섹션이 여러 개인 긴 보고서
  const headingCount = (plain.match(/^#{1,3}\s+/gm) || []).length;
  if (headingCount >= 2 && plain.length >= 200) return true;
  return false;
};

/** Fact Check 없이 Confirm 시: Text 입력/편집 내용을 AI 보고서로 사용 */
export const buildAiReportFromBodyContent = (input: {
  title?: string;
  text?: string;
  formattedTextHtml?: string;
}) => {
  const title = String(input.title || "").trim();
  const html = String(input.formattedTextHtml || "").trim();
  const plain = String(input.text || "").trim();

  if (html && looksLikeHtmlContent(html) && (htmlToPlainText(html) || "").trim()) {
    if (/AI 보고서 \(본문\)|AI 검증 보고서/i.test(html)) return html;
    const heading = escapeGeneralInfoHtml(title ? `AI 보고서 (본문) — ${title}` : "AI 보고서 (본문)");
    return `<h3 style="margin:8px 0 14px;font-size:18px;font-weight:800;line-height:1.4;">${heading}</h3>${html}`;
  }

  if (!plain) return "";

  const md = [
    title ? `# AI 보고서 (본문) — ${title}` : "# AI 보고서 (본문)",
    "",
    plain,
  ].join("\n");
  return markdownReportToHtml(md);
};

/** 상세/PDF에 표시할 보고서 내용이 있는지 (본문 기반 보고서 포함) */
export const hasDisplayableAiReport = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (isFullAiVerificationReport(raw)) return true;
  const plain = looksLikeHtmlContent(raw) ? htmlToPlainText(raw) : raw;
  if (/AI 보고서 \(본문\)/i.test(plain)) return true;
  if (looksLikeHtmlContent(raw) && plain.trim().length >= 40) return true;
  if (plain.trim().length >= 80) return true;
  return false;
};

export const markdownReportToHtml = (markdown: string) => {
  const lines = normalizeReportPlainText(markdown).split("\n");
  const parts: string[] = [];

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      parts.push('<div style="height:12px;"></div>');
      return;
    }
    // 단독 # / ## 만 있는 줄은 무시
    if (/^#{1,3}$/.test(line)) return;

    if (line.startsWith("### ")) {
      parts.push(
        `<h5 style="margin:18px 0 10px;font-size:15px;font-weight:800;line-height:1.45;color:#f1f5f9;">${escapeGeneralInfoHtml(line.slice(4))}</h5>`,
      );
      return;
    }
    if (line.startsWith("## ")) {
      parts.push(
        `<h4 style="margin:22px 0 10px;padding-top:4px;border-top:1px solid rgba(148,163,184,0.35);font-size:16px;font-weight:800;line-height:1.45;color:#e0f2fe;">${escapeGeneralInfoHtml(line.slice(3))}</h4>`,
      );
      return;
    }
    if (line.startsWith("# ")) {
      parts.push(
        `<h3 style="margin:8px 0 14px;font-size:18px;font-weight:800;line-height:1.4;color:#f8fafc;">${escapeGeneralInfoHtml(line.slice(2))}</h3>`,
      );
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      parts.push(
        `<div style="margin:0 0 8px;padding-left:10px;line-height:1.8;color:#e2e8f0;">• ${escapeGeneralInfoHtml(line.slice(2).trim())}</div>`,
      );
      return;
    }
    if (/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/.test(line)) {
      parts.push(
        `<div style="margin:14px 0 8px;line-height:1.85;font-weight:700;color:#f1f5f9;">${escapeGeneralInfoHtml(line)}</div>`,
      );
      return;
    }
    parts.push(
      `<div style="margin:0 0 10px;line-height:1.85;color:#e2e8f0;">${escapeGeneralInfoHtml(line)}</div>`,
    );
  });

  return parts.join("");
};

/** PDF/화면용: 붙어 있는 HTML/텍스트를 문단 간격이 있는 HTML로 정리 */
export const formatReportHtmlForPdf = (reportText: string) => {
  const raw = String(reportText || "").trim();
  if (!raw) return "";

  const plain = looksLikeHtmlContent(raw) ? htmlToPlainText(raw) : raw;
  const hasHeadingTags = /<h[1-6]\b/i.test(raw);
  const hasInlineMedia = /<(?:img|video)\b[^>]*\bsrc=/i.test(raw);
  const blockCount = (raw.match(/<(div|p|h[1-6]|li|br)\b/gi) || []).length;

  // 인라인 이미지가 있으면 재생성하지 않고 원본 HTML 유지
  if (looksLikeHtmlContent(raw) && hasInlineMedia) {
    return raw;
  }

  // AI 검증 보고서 마크다운이면 항상 구조화 HTML로 재생성 (간격 보장)
  if (isAiVerificationReportPlain(plain) && !hasHeadingTags) {
    return markdownReportToHtml(plain);
  }
  if (isAiVerificationReportPlain(plain) && hasHeadingTags) {
    // 헤더는 있으나 간격이 부족한 경우에도 plain 기준으로 재생성
    return markdownReportToHtml(plain);
  }

  const hasUsefulBlocks =
    /<(h[1-6]|p|li|br)\b/i.test(raw) || /<div[^>]*>[\s\S]*?<\/div>/i.test(raw);

  if (!looksLikeHtmlContent(raw) || !hasUsefulBlocks || (plain.length > 180 && blockCount < 3)) {
    return markdownReportToHtml(normalizeReportPlainText(plain || raw));
  }

  let html = raw.replace(
    /\s*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*/g,
    "<br/><br/>$1 ",
  );

  if (!/<br\s*\/?>/i.test(html) && plain.length > 240 && blockCount <= 4) {
    return markdownReportToHtml(normalizeReportPlainText(plain));
  }

  return html;
};

export const buildFactCheckReportHtml = (
  reportText: string,
  evidenceImageUrls: string[] = [],
) => {
  const raw = String(reportText || "").trim();
  const plain = looksLikeHtmlContent(raw) ? htmlToPlainText(raw) : raw;
  const hasHeadingTags = /<h[1-6]\b/i.test(raw);
  const hasInlineMedia = /<(?:img|video)\b[^>]*\bsrc=/i.test(raw);

  // 이미 인라인 이미지가 들어 있는 편집 HTML은 마크다운 재생성으로 지우지 않음
  let html: string;
  if (looksLikeHtmlContent(raw) && hasInlineMedia) {
    html = raw;
  } else if (isAiVerificationReportPlain(plain)) {
    html = markdownReportToHtml(plain);
  } else if (looksLikeHtmlContent(raw) && hasHeadingTags) {
    html = raw;
  } else {
    html = markdownReportToHtml(plain || raw);
  }

  const urls = evidenceImageUrls
    .map((url) => String(url || "").trim())
    .filter((url) => /^(https?:\/\/|data:)/i.test(url))
    .filter((url, index, arr) => arr.indexOf(url) === index)
    .slice(0, 8);

  if (urls.length > 0 && !/generalInfoFactCheckEvidence/i.test(html)) {
    const blocks = urls
      .map(
        (src, index) =>
          `<div class="generalInfoInlineImageBlock" style="margin:12px 0;"><img class="generalInfoInlineImage" src="${src}" alt="근거 이미지 ${index + 1}" /><div style="font-size:12px;color:#94a3b8;margin-top:4px;">(출처: 이미지 ${index + 1})</div></div>`,
      )
      .join("");
    html += `<div class="generalInfoFactCheckEvidence"><h4 style="margin:18px 0 8px;">근거 이미지</h4>${blocks}</div>`;
  }

  return html;
};

export const dataUrlToFile = async (dataUrl: string, fileName = "factcheck-image.png") => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const safeName = /\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}.${ext}`;
  return new File([blob], safeName, { type: blob.type || "image/png" });
};

const makePublicUrlFromStoragePath = (storagePath: unknown) => {
  const pathValue = String(storagePath || "").trim();
  if (!pathValue) return "";
  if (/^https?:\/\//i.test(pathValue)) return pathValue;

  try {
    const { data } = supabase!.storage.from(TRAVEL_DIARY_BUCKET).getPublicUrl(pathValue);
    return data.publicUrl || "";
  } catch {
    return "";
  }
};

export const getGeneralInfoDisplayMediaItems = (
  item: GeneralInfoItem | null | undefined,
): GeneralInfoMediaItem[] => {
  if (!item) return [];

  const filePreview = String(item.filePreview || "").trim();
  const fallbackPreview = /^(https?:\/\/|data:|blob:)/i.test(filePreview) ? filePreview : "";

  const mediaItems = normalizeGeneralInfoMediaItems(item)
    .map((media) => {
      const preview = String(media.preview || "").trim();
      const fileUrl = String(media.fileUrl || "").trim();
      const storagePath = String(media.storagePath || "").trim();
      const bestUrl = /^(https?:\/\/|data:|blob:)/i.test(preview)
        ? preview
        : /^(https?:\/\/|data:|blob:)/i.test(fileUrl)
          ? fileUrl
          : makePublicUrlFromStoragePath(storagePath) || fallbackPreview;

      return {
        ...media,
        preview: bestUrl,
        fileUrl: bestUrl,
        storagePath,
      };
    })
    .filter((media) => /^(https?:\/\/|data:|blob:)/i.test(String(media.preview || "").trim()));

  if (mediaItems.length > 0) return mediaItems;

  if (fallbackPreview) {
    return [
      {
        id: Number(item.id || Date.now()),
        name: String(item.fileName || item.title || "대표 이미지"),
        type: "image",
        preview: fallbackPreview,
        fileUrl: fallbackPreview,
        storagePath: "",
      },
    ];
  }

  return [];
};

export const extractMarkdownReport = (text: string): string => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";

  // If it is wrapped in markdown JSON code block, strip the fences
  let jsonText = trimmed;
  const matchCodeBlock = trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i);
  if (matchCodeBlock) {
    jsonText = matchCodeBlock[1].trim();
  }

  // Try parsing as JSON
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === "object") {
      if (parsed.result) return String(parsed.result);
      if (parsed.report) return String(parsed.report);
      if (parsed.reportText) return String(parsed.reportText);
      if (parsed.content) return String(parsed.content);
    }
  } catch (e) {
    // If JSON parsing fails, try regex extraction of the "result" value
    const matchResult = jsonText.match(/"result"\s*:\s*"([\s\S]*?)"\s*([},]|$)/);
    if (matchResult) {
      try {
        return JSON.parse(`"${matchResult[1]}"`);
      } catch {
        return matchResult[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
    }
  }
  return trimmed;
};

/** Text 입력 첫 비어 있지 않은 줄을 정보 제목으로 사용 */
export const extractTitleFromPlainText = (text: string, maxLen = 120): string => {
  const firstLine =
    String(text || "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/<[^>]*>/g, "").trim())
      .find(Boolean) || "";
  if (!firstLine) return "";
  return firstLine.length > maxLen ? firstLine.slice(0, maxLen) : firstLine;
};


/** AI 보고서 HTML에서 첫 인포그래픽 이미지 URL 추출 */
export const extractFirstInfographicSrc = (html: string): string => {
  const raw = String(html || "");
  if (!raw.trim()) return "";
  const blockMatch = raw.match(
    /data-gi-infographic\s*=\s*["']1["'][\s\S]*?<img\b[^>]*\bsrc=["']([^"']+)["']/i,
  );
  if (blockMatch?.[1]) return String(blockMatch[1]).trim();
  return "";
};

/** 인포그래픽이 있으면 mediaItems[0] / filePreview 대표 이미지로 승격 */
export const applyInfographicAsRepresentative = (
  item: GeneralInfoItem,
  reportHtml: string,
): GeneralInfoItem => {
  const src = extractFirstInfographicSrc(reportHtml);
  if (!src) return item;

  const existing = normalizeGeneralInfoMediaItems(item);
  const withoutDup = existing.filter(
    (media) =>
      String(media.preview || "").trim() !== src &&
      String(media.fileUrl || "").trim() !== src,
  );
  const nextMedia = [
    makeGeneralInfoMediaItem("인포그래픽 대표", "image", src, undefined, src),
    ...withoutDup,
  ];

  return {
    ...item,
    mediaItems: nextMedia,
    filePreview: src,
    fileName: nextMedia[0]?.name || "인포그래픽 대표",
    fileType: "image",
  };
};

