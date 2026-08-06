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

export const insertInlineMediaIntoEditor = (
  editor: HTMLElement,
  items: Array<{ src: string; name?: string; type?: "image" | "video" }>,
) => {
  if (!editor || !items.length) return;

  items.forEach((item) => {
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

    editor.appendChild(block);
  });

  const spacer = document.createElement("div");
  spacer.innerHTML = "<br>";
  editor.appendChild(spacer);

  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(spacer);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
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
