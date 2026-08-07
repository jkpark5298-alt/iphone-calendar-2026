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
  return host || textNode;
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
  options?: { afterNode?: Node | null },
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

  uniqueItems.forEach((item) => {
    const block = document.createElement("div");
    block.className = "generalInfoInlineImageBlock";

    if (item.type === "video") {
      const video = document.createElement("video");
      video.src = item.src;
      video.controls = true;
      video.className = "generalInfoInlineImage generalInfoInlineVideo";
      video.setAttribute("playsinline", "true");
      block.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = item.name || "본문 이미지";
      img.className = "generalInfoInlineImage";
      block.appendChild(img);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "generalInfoInlineImageRemove";
    removeBtn.setAttribute("contenteditable", "false");
    removeBtn.setAttribute("aria-label", "이미지 삭제");
    removeBtn.textContent = "×";
    block.appendChild(removeBtn);

    if (insertAfter && insertAfter.parentNode) {
      insertAfter.parentNode.insertBefore(block, insertAfter.nextSibling);
      insertAfter = block;
    } else {
      editor.appendChild(block);
      insertAfter = block;
    }
  });

  const spacer = document.createElement("div");
  spacer.innerHTML = "<br>";
  if (insertAfter && insertAfter.parentNode) {
    insertAfter.parentNode.insertBefore(spacer, insertAfter.nextSibling);
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
    const el = media as HTMLElement;
    if (el.tagName !== "IMG" && el.tagName !== "VIDEO") return;
    if (el.tagName === "IMG" && !el.classList.contains("generalInfoInlineImage")) {
      // 근거 이미지 등 일반 img도 편집기 안이면 삭제 가능하게
      if (!editor.contains(el)) return;
      el.classList.add("generalInfoInlineImage");
    }

    let block = el.closest(".generalInfoInlineImageBlock") as HTMLElement | null;
    if (!block) {
      block = document.createElement("div");
      block.className = "generalInfoInlineImageBlock";
      el.parentNode?.insertBefore(block, el);
      block.appendChild(el);
    }

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

  editor.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest?.(".generalInfoInlineImageRemove") as HTMLElement | null;
    if (!btn || !editor.contains(btn)) return;
    event.preventDefault();
    event.stopPropagation();
    btn.closest(".generalInfoInlineImageBlock")?.remove();
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
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const markdownReportToHtml = (markdown: string) => {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      parts.push("<div><br /></div>");
      return;
    }
    if (line.startsWith("### ")) {
      parts.push(`<h5>${escapeGeneralInfoHtml(line.slice(4))}</h5>`);
      return;
    }
    if (line.startsWith("## ")) {
      parts.push(`<h4>${escapeGeneralInfoHtml(line.slice(3))}</h4>`);
      return;
    }
    if (line.startsWith("# ")) {
      parts.push(`<h3>${escapeGeneralInfoHtml(line.slice(2))}</h3>`);
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      parts.push(`<div>• ${escapeGeneralInfoHtml(line.slice(2))}</div>`);
      return;
    }
    parts.push(`<div>${escapeGeneralInfoHtml(rawLine)}</div>`);
  });

  return parts.join("");
};

export const buildFactCheckReportHtml = (
  reportText: string,
  evidenceImageUrls: string[] = [],
) => {
  const raw = String(reportText || "").trim();
  let html = looksLikeHtmlContent(raw) ? raw : markdownReportToHtml(raw);

  const urls = evidenceImageUrls
    .map((url) => String(url || "").trim())
    .filter((url) => /^(https?:\/\/|data:)/i.test(url))
    .filter((url, index, arr) => arr.indexOf(url) === index)
    .slice(0, 8);

  if (urls.length > 0 && !/generalInfoFactCheckEvidence/i.test(html)) {
    const blocks = urls
      .map(
        (src, index) =>
          `<div class="generalInfoInlineImageBlock"><img class="generalInfoInlineImage" src="${src}" alt="근거 이미지 ${index + 1}" /><div style="font-size:12px;color:#94a3b8;margin-top:4px;">(출처: 이미지 ${index + 1})</div></div>`,
      )
      .join("");
    html += `<div class="generalInfoFactCheckEvidence"><h4>근거 이미지</h4>${blocks}</div>`;
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
