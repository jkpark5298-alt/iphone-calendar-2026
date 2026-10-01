import type { GeneralInfoItem } from "../types/generalInfo";
import { normalizeGeneralInfoMediaItems } from "./generalInfoHelpers";

/** 통합 저장 키 (v3) */
export const GENERAL_INFO_STORAGE_KEY = "travel-diary-general-info-v3";
export const CHAPTER3_COMPACT_STORAGE_KEY = "travel-diary-chapter3-compact-v3";
/** IDs last confirmed present on Supabase — used to drop remotely-deleted rows */
export const GENERAL_INFO_REMOTE_IDS_KEY = "travel-diary-general-info-remote-ids-v1";
export const GENERAL_INFO_TEMP_DRAFT_KEY = "travel_diary_general_info_temp_draft";
export const GENERAL_INFO_TEMP_DRAFT_EVENT = "travel-diary-general-info-temp-draft";

export type GeneralInfoTempDraftIndex = {
  title: string;
  savedAt: string;
  editingId: number | null;
  category: string;
};

export function readGeneralInfoTempDraftIndex(): GeneralInfoTempDraftIndex | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GENERAL_INFO_TEMP_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      draft?: Record<string, unknown>;
      richTextHtml?: string;
      editingId?: number | null;
      savedAt?: string;
    };
    const draft = parsed?.draft;
    if (!draft || typeof draft !== "object") return null;
    const title = String(draft.title || "").trim();
    const text = String(draft.text || draft.summary || "").trim();
    const html = String(parsed.richTextHtml || draft.formattedTextHtml || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hasMedia = Array.isArray(draft.mediaItems) && draft.mediaItems.length > 0;
    const category = String(draft.primaryCategory || "").trim();
    const hasBody = Boolean(title || text || html || hasMedia || category || String(draft.filePreview || "").trim());
    if (!hasBody) return null;
    return {
      title: title || text.slice(0, 40) || html.slice(0, 40) || "임시 저장",
      savedAt: String(parsed.savedAt || ""),
      editingId: typeof parsed.editingId === "number" ? parsed.editingId : null,
      category,
    };
  } catch {
    return null;
  }
}

const LEGACY_KEYS = [
  "travel-diary-ch3-general-info-items-v3",
  "travel-diary-ch3-general-info-items-slim-v3",
  "travel-diary-general-info-items-v1",
  "travel-diary-ch3-general-info-items-v1",
  "travel-diary-ch3-general-info-items-v2",
  "travel-diary-chapter3-compact-v2",
] as const;

export type GeneralInfoPersistResult = {
  ok: boolean;
  message: string;
};

const normalizeGeneralInfoItemsForLocalStorage = (items: GeneralInfoItem[]) =>
  Array.isArray(items)
    ? items
        .filter((item) => item && typeof item.id === "number")
        .sort((a, b) => b.id - a.id)
    : [];

/** Keep long body/report text; only strip oversized binary data: URLs from media fields. */
const PRESERVE_LONG_TEXT_KEYS = new Set([
  "text",
  "summary",
  "factchecksummary",
  "extranote",
  "formattedtexthtml",
  "title",
]);

const stripLargeClientStorageValue = (value: unknown, keyHint = ""): unknown => {
  const lowerHint = keyHint.toLowerCase();

  if (typeof value === "string") {
    if (PRESERVE_LONG_TEXT_KEYS.has(lowerHint)) return value;
    if (value.startsWith("data:") || value.length > 5000) return "";
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripLargeClientStorageValue(item, keyHint));
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    Object.entries(source).forEach(([key, itemValue]) => {
      const lowerKey = key.toLowerCase();

      if (PRESERVE_LONG_TEXT_KEYS.has(lowerKey)) {
        next[key] = itemValue;
        return;
      }

      if (
        lowerKey.includes("base64") ||
        lowerKey.includes("dataurl")
      ) {
        next[key] = "";
        return;
      }

      if (typeof itemValue === "string" && itemValue.startsWith("data:") && itemValue.length > 5000) {
        next[key] = "";
        return;
      }

      next[key] = stripLargeClientStorageValue(itemValue, key);
    });

    return next;
  }

  return value;
};

const isCh3StorageUrlForCompact = (value: unknown) => {
  if (typeof value !== "string") return false;
  return /^(https?:\/\/|blob:)/i.test(value.trim());
};

const getCh3CompactMediaItemsWithUrls = (item: GeneralInfoItem) =>
  normalizeGeneralInfoMediaItems(item)
    .map((media) => {
      const preview = String(media.preview || "").trim();
      const fileUrl = String(media.fileUrl || "").trim();
      const bestUrl = isCh3StorageUrlForCompact(preview)
        ? preview
        : isCh3StorageUrlForCompact(fileUrl)
          ? fileUrl
          : "";

      return {
        ...media,
        preview: bestUrl,
        fileUrl: bestUrl,
        storagePath: media.storagePath || "",
      };
    })
    .filter((media) => media.preview || media.fileUrl || media.storagePath);

const getCh3CompactMainPreviewUrl = (item: GeneralInfoItem) => {
  const filePreview = String(item.filePreview || "").trim();
  if (isCh3StorageUrlForCompact(filePreview)) return filePreview;
  return getCh3CompactMediaItemsWithUrls(item)[0]?.preview || "";
};

export const makeCompactGeneralInfoItemsForStorage = (
  items: GeneralInfoItem[],
): GeneralInfoItem[] =>
  normalizeGeneralInfoItemsForLocalStorage(items).map(
    (item) =>
      stripLargeClientStorageValue({
        ...item,
        filePreview: getCh3CompactMainPreviewUrl(item) || undefined,
        mediaItems: getCh3CompactMediaItemsWithUrls(item),
      }) as GeneralInfoItem,
  );

const parseItemsFromRaw = (raw: string): GeneralInfoItem[] => {
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return normalizeGeneralInfoItemsForLocalStorage(parsed as GeneralInfoItem[]);
  }

  if (parsed && typeof parsed === "object") {
    const field = (parsed as Record<string, unknown>).generalInfoItems;
    if (Array.isArray(field)) {
      return normalizeGeneralInfoItemsForLocalStorage(field as GeneralInfoItem[]);
    }
  }

  return [];
};

const removeLegacyKeys = () => {
  if (typeof window === "undefined") return;
  LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
};

export const readGeneralInfoItemsFromLocalStorage = (): GeneralInfoItem[] => {
  if (typeof window === "undefined") return [];

  const keysToTry = [GENERAL_INFO_STORAGE_KEY, ...LEGACY_KEYS];

  for (const key of keysToTry) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      const items = parseItemsFromRaw(raw);
      if (items.length > 0) {
        if (key !== GENERAL_INFO_STORAGE_KEY) {
          persistGeneralInfoItemsToLocalStorage(items);
        }
        return items;
      }
    } catch (error) {
      console.error("general info localStorage read failed", key, error);
    }
  }

  return [];
};

export const readCompactStorageGeneralInfoItems = (): GeneralInfoItem[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(CHAPTER3_COMPACT_STORAGE_KEY);
    if (!raw) return [];
    return parseItemsFromRaw(raw);
  } catch (error) {
    console.error("compact localStorage read failed", CHAPTER3_COMPACT_STORAGE_KEY, error);
    return [];
  }
};

export const persistGeneralInfoItemsToLocalStorage = (
  items: GeneralInfoItem[],
): GeneralInfoPersistResult => {
  if (typeof window === "undefined") {
    return { ok: false, message: "브라우저 환경이 아닙니다." };
  }

  const compactItems = makeCompactGeneralInfoItemsForStorage(items);
  const payload = {
    version: 3,
    savedAt: new Date().toLocaleString("ko-KR"),
    generalInfoItems: compactItems,
  };

  try {
    removeLegacyKeys();
    window.localStorage.setItem(GENERAL_INFO_STORAGE_KEY, JSON.stringify(compactItems));
    window.localStorage.setItem(CHAPTER3_COMPACT_STORAGE_KEY, JSON.stringify(payload));

    return {
      ok: true,
      message: "이 기기 저장 완료 · 아이폰 용량 보호를 위해 Text/분류 중심으로 저장했습니다.",
    };
  } catch (error) {
    console.error("general info compact localStorage save failed", error);

    const textOnlyItems = compactItems.slice(0, 100).map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text,
      sourceUrl: item.sourceUrl,
      summary: item.summary,
      primaryCategory: item.primaryCategory,
      secondaryCategory: item.secondaryCategory,
      thirdCategory: item.thirdCategory,
      keywords: item.keywords,
      factCheckSummary: item.factCheckSummary,
      extraNote: item.extraNote,
      createdAt: item.createdAt,
      inputTypes: item.inputTypes,
      formattedTextHtml: item.formattedTextHtml || "",
      factCheckStatus: item.factCheckStatus || "수동 확인 필요",
      confirmed: typeof item.confirmed === "boolean" ? item.confirmed : true,
    })) as GeneralInfoItem[];

    try {
      const fallbackPayload = {
        version: 3,
        savedAt: new Date().toLocaleString("ko-KR"),
        generalInfoItems: textOnlyItems,
      };

      removeLegacyKeys();
      window.localStorage.setItem(GENERAL_INFO_STORAGE_KEY, JSON.stringify(textOnlyItems));
      window.localStorage.setItem(
        CHAPTER3_COMPACT_STORAGE_KEY,
        JSON.stringify(fallbackPayload),
      );

      return {
        ok: true,
        message: "이 기기 저장 완료 · 저장공간 보호를 위해 Text 중심으로 보존했습니다.",
      };
    } catch (fallbackError) {
      console.error("general info text-only localStorage save failed", fallbackError);
      return {
        ok: false,
        message: "이 기기 저장 실패 · 아이폰 Safari 저장공간을 비운 뒤 다시 시도하세요.",
      };
    }
  }
};

const normalizeIdSet = (ids: Iterable<number>) => {
  const next = new Set<number>();
  for (const value of ids) {
    const id = Number(value);
    if (Number.isFinite(id) && id > 0) next.add(id);
  }
  return next;
};

export const readGeneralInfoRemoteIds = (): Set<number> => {
  if (typeof window === "undefined") return new Set();

  try {
    const raw = window.localStorage.getItem(GENERAL_INFO_REMOTE_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeIdSet(parsed.map(Number)) : new Set();
  } catch (error) {
    console.error("general info remote id set read failed", error);
    return new Set();
  }
};

export const persistGeneralInfoRemoteIds = (ids: Iterable<number>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      GENERAL_INFO_REMOTE_IDS_KEY,
      JSON.stringify(Array.from(normalizeIdSet(ids))),
    );
  } catch (error) {
    console.error("general info remote id set save failed", error);
  }
};

export const addGeneralInfoRemoteIds = (ids: Iterable<number>) => {
  const next = readGeneralInfoRemoteIds();
  normalizeIdSet(ids).forEach((id) => next.add(id));
  persistGeneralInfoRemoteIds(next);
};

export const removeGeneralInfoRemoteIds = (ids: Iterable<number>) => {
  const next = readGeneralInfoRemoteIds();
  normalizeIdSet(ids).forEach((id) => next.delete(id));
  persistGeneralInfoRemoteIds(next);
};
