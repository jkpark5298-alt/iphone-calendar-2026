/**
 * supabaseUtils.ts
 * Supabase 연동 관련 유틸리티 함수 모음
 * (DB CRUD, Storage 업로드/삭제)
 */
import {
  getSupabase,
  isSupabaseConfigured,
  TRAVEL_DIARY_BUCKET,
} from "../../../lib/supabaseClient";
import type { GeneralInfoMediaItem } from "../../../lib/generalInfoHelpers";
import type { CollectedItem, TravelBundle } from "../types";
import { emptyLocation } from "./locationUtils";
import { getBundlePurposeTag, getBundleTopicCategory } from "./locationUtils";
import { nowText } from "./dateUtils";

// ==================== Row 변환 ====================

/** Supabase 저장을 위한 안전한 아이템 생성 (preview 제거, content 트림) */
export const makeSupabaseSafeItem = (item: CollectedItem): CollectedItem => {
  if (item.type === "image" || item.type === "pdf") {
    return {
      ...item,
      preview: undefined,
      content: item.content || item.name || "이미지/PDF 자료",
      summaryText: item.summaryText || item.content || item.name || "이미지/PDF 자료",
    };
  }
  return item;
};

export function isDurableMediaUrl(url?: string | null): boolean {
  return Boolean(url && /^https?:\/\//i.test(url.trim()));
}

/** localStorage / 동기화용 — data:/blob: 미리보기 제거, Storage URL만 유지 */
export function slimCollectedItemForStorage(item: CollectedItem): CollectedItem {
  if (item.type !== "image" && item.type !== "pdf") {
    return {
      ...item,
      content: String(item.content || "").slice(0, 20000),
      formattedTextHtml: item.formattedTextHtml
        ? String(item.formattedTextHtml).slice(0, 40000)
        : undefined,
    };
  }

  const fileUrl = isDurableMediaUrl(item.fileUrl) ? item.fileUrl : undefined;
  const preview = isDurableMediaUrl(item.preview)
    ? item.preview
    : fileUrl || undefined;
  const content =
    typeof item.content === "string" && item.content.startsWith("data:")
      ? item.name || "이미지/PDF 자료"
      : item.content || item.name || "이미지/PDF 자료";

  return {
    ...item,
    fileUrl,
    preview,
    storagePath: item.storagePath,
    content,
  };
}

export function slimTravelBundleForStorage(bundle: TravelBundle): TravelBundle {
  return {
    ...bundle,
    items: bundle.items.map(slimCollectedItemForStorage),
  };
}

export function slimTravelDiaryLocalPayload(payload: {
  bundles: TravelBundle[];
  unclassified: CollectedItem[];
}) {
  return {
    bundles: payload.bundles.map(slimTravelBundleForStorage),
    unclassified: payload.unclassified.map(slimCollectedItemForStorage),
  };
}

function durableImageScore(item: CollectedItem): number {
  let score = 0;
  if (item.storagePath) score += 4;
  if (isDurableMediaUrl(item.fileUrl)) score += 3;
  if (isDurableMediaUrl(item.preview)) score += 1;
  if (item.preview?.startsWith("data:")) score -= 2;
  return score;
}

function mergeLocationPreferFilled(
  preferred?: CollectedItem["itemLocation"],
  other?: CollectedItem["itemLocation"],
): CollectedItem["itemLocation"] {
  if (!preferred && !other) return undefined;
  const a = preferred || emptyLocation;
  const b = other || emptyLocation;
  const merged = {
    country: a.country || b.country || "",
    city: a.city || b.city || "",
    area: a.area || b.area || "",
    place: a.place || b.place || "",
    address: a.address || b.address,
    confidence: a.confidence ?? b.confidence,
    reasons: a.reasons?.length ? a.reasons : b.reasons,
  };
  if (!merged.country && !merged.city && !merged.area && !merged.place && !merged.address) {
    return preferred || other;
  }
  return merged;
}

function mergeCollectedItems(
  localItems: CollectedItem[],
  remoteItems: CollectedItem[],
): CollectedItem[] {
  const map = new Map<number, CollectedItem>();
  for (const item of remoteItems) {
    if (item && typeof item.id === "number") map.set(item.id, item);
  }
  for (const item of localItems) {
    if (!item || typeof item.id !== "number") continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }
    const preferred =
      durableImageScore(item) >= durableImageScore(existing) ? item : existing;
    const other = preferred === item ? existing : item;
    map.set(item.id, {
      ...preferred,
      itemLocation: mergeLocationPreferFilled(preferred.itemLocation, other.itemLocation),
      itemMemo: preferred.itemMemo || other.itemMemo,
      fileUrl: isDurableMediaUrl(preferred.fileUrl)
        ? preferred.fileUrl
        : other.fileUrl || preferred.fileUrl,
      preview: isDurableMediaUrl(preferred.preview)
        ? preferred.preview
        : isDurableMediaUrl(other.preview)
          ? other.preview
          : preferred.preview || other.preview,
      storagePath: preferred.storagePath || other.storagePath,
    });
  }
  return Array.from(map.values());
}

/** 원격/로컬 번들 병합 — 사진 Storage URL이 더 많은 쪽 아이템 우선 */
export function mergeTravelBundlesPreferMedia(
  local: TravelBundle,
  remote: TravelBundle,
): TravelBundle {
  const localScore = local.items.reduce((s, i) => s + Math.max(0, durableImageScore(i)), 0);
  const remoteScore = remote.items.reduce((s, i) => s + Math.max(0, durableImageScore(i)), 0);
  const base = localScore >= remoteScore ? local : remote;
  const other = base === local ? remote : local;

  return {
    ...base,
    title: base.title || other.title,
    confirmedLocation: base.confirmedLocation || other.confirmedLocation,
    manualLocation: base.manualLocation || other.manualLocation,
    aiDetected: base.aiDetected || other.aiDetected,
    factCheck: base.factCheck || other.factCheck,
    purposeTag: base.purposeTag || other.purposeTag,
    topicCategory: base.topicCategory || other.topicCategory,
    items: mergeCollectedItems(local.items, remote.items),
  };
}

/** 번들 전체를 Supabase 안전 형태로 변환 */
export const makeSupabaseSafeBundle = (bundle: TravelBundle): TravelBundle => {
  const safeItems = bundle.items.map(makeSupabaseSafeItem);
  return { ...bundle, items: safeItems };
};

/** 번들을 Supabase travel_items 테이블 row로 변환 */
export const makeSupabaseRowFromBundle = (bundle: TravelBundle) => {
  const location =
    bundle.confirmedLocation || bundle.aiDetected || bundle.manualLocation || emptyLocation;

  const safeItems = bundle.items.map((item) => ({
    id: item.id,
    type: item.type,
    name: item.name,
    content:
      item.type === "image" || item.type === "pdf"
        ? item.summaryText || item.name || "이미지/PDF 자료"
        : String(item.content || "").slice(0, 2000),
    purposeTag: item.purposeTag,
    topicCategory: item.topicCategory,
    status: item.status,
    createdAt: item.createdAt,
    summaryTitle: item.summaryTitle,
    summaryText: item.summaryText ? String(item.summaryText).slice(0, 2000) : undefined,
    fileUrl: item.fileUrl,
    storagePath: item.storagePath,
    fileName: item.fileName,
    fileMimeType: item.fileMimeType,
    fileSize: item.fileSize,
    // data: URL은 row 용량 초과로 저장 실패하므로 http(s)만 유지
    preview: isDurableMediaUrl(item.fileUrl)
      ? item.fileUrl
      : isDurableMediaUrl(item.preview)
        ? item.preview
        : undefined,
    itemLocation: item.itemLocation,
    itemMemo: item.itemMemo,
  }));

  const firstItem = safeItems[0];
  const purposeTag = getBundlePurposeTag(bundle) || undefined;
  const topicCategory = getBundleTopicCategory(bundle) || undefined;

  const safeBundle = {
    id: bundle.id,
    title: bundle.title,
    status: bundle.status,
    createdAt: bundle.createdAt,
    confirmedLocation: location,
    purposeTag,
    topicCategory,
    factCheck: bundle.factCheck
      ? {
          status: bundle.factCheck.status,
          score: bundle.factCheck.score,
          checkedAt: bundle.factCheck.checkedAt,
          summary: bundle.factCheck.summary
            ? String(bundle.factCheck.summary).slice(0, 1000)
            : "",
          issues: Array.isArray(bundle.factCheck.issues)
            ? bundle.factCheck.issues.slice(0, 5)
            : [],
        }
      : undefined,
    items: safeItems,
  };

  return {
    app_bundle_id: String(bundle.id),
    item_type: firstItem?.type || "text",
    title: String(bundle.title || firstItem?.name || "여행자료").slice(0, 300),
    content: String(firstItem?.content || "").slice(0, 3000),
    source_url: firstItem?.type === "url" ? firstItem.content : null,
    purpose_tag: purposeTag,
    topic_category: topicCategory,
    country: location.country || null,
    city: location.city || null,
    area: location.area || null,
    place: location.place || null,
    status: bundle.status,
    saved_at_kst: bundle.createdAt || nowText(),
    updated_at_kst: nowText(),
    summary_title: firstItem?.summaryTitle || null,
    summary_text: firstItem?.summaryText || null,
    fact_check_status: bundle.factCheck?.status || null,
    fact_check_summary: bundle.factCheck?.summary
      ? String(bundle.factCheck.summary).slice(0, 1000)
      : null,
    fact_check_score: bundle.factCheck?.score || null,
    storage_bucket: firstItem?.storagePath ? TRAVEL_DIARY_BUCKET : null,
    storage_path: firstItem?.storagePath || null,
    file_url: firstItem?.fileUrl || (isDurableMediaUrl(firstItem?.preview) ? firstItem?.preview : null) || null,
    file_name: firstItem?.fileName || firstItem?.name || null,
    file_mime_type: firstItem?.fileMimeType || null,
    file_size: firstItem?.fileSize || null,
    raw_items: safeItems,
    raw_bundle: safeBundle,
  };
};

/** Supabase row에서 TravelBundle 복원 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const makeBundleFromSupabaseRow = (row: any): TravelBundle => {
  if (row.raw_bundle) {
    const bundle = row.raw_bundle as TravelBundle;
    // raw_bundle의 id가 app_bundle_id와 일치하는지 보정 (문자열 vs 숫자 타입 불일치 방지)
    const correctId = Number(row.app_bundle_id);
    const withId =
      !isNaN(correctId) && correctId > 0 && bundle.id !== correctId
        ? { ...bundle, id: correctId }
        : bundle;

    // raw_items에만 남아 있는 사진별 위치/메모를 복원
    if (Array.isArray(row.raw_items) && Array.isArray(withId.items)) {
      const rawById = new Map<number, CollectedItem>();
      for (const raw of row.raw_items as CollectedItem[]) {
        if (raw && typeof raw.id === "number") rawById.set(raw.id, raw);
      }
      return {
        ...withId,
        items: withId.items.map((item) => {
          const raw = rawById.get(item.id);
          if (!raw) return item;
          return {
            ...item,
            itemLocation: mergeLocationPreferFilled(item.itemLocation, raw.itemLocation),
            itemMemo: item.itemMemo || raw.itemMemo,
            fileUrl: isDurableMediaUrl(item.fileUrl) ? item.fileUrl : raw.fileUrl || item.fileUrl,
            preview: isDurableMediaUrl(item.preview)
              ? item.preview
              : isDurableMediaUrl(raw.preview)
                ? raw.preview
                : item.preview || raw.preview,
            storagePath: item.storagePath || raw.storagePath,
          };
        }),
      };
    }

    return withId;
  }

  const createdAt =
    row.saved_at_kst ||
    (row.created_at ? new Date(row.created_at).toLocaleString("ko-KR") : nowText());

  const item: CollectedItem = {
    id: Date.now() + Math.random(),
    type: row.item_type || "text",
    name: row.title || row.file_name || "Supabase 저장 자료",
    content: row.content || row.source_url || "",
    preview: row.file_url || undefined,
    fileUrl: row.file_url || undefined,
    storagePath: row.storage_path || undefined,
    fileName: row.file_name || undefined,
    fileMimeType: row.file_mime_type || undefined,
    fileSize: row.file_size || undefined,
    purposeTag: row.purpose_tag || undefined,
    topicCategory: row.topic_category || undefined,
    status: row.status || "confirmed",
    createdAt,
  };

  return {
    id: row.app_bundle_id && !isNaN(Number(row.app_bundle_id)) 
      ? Number(row.app_bundle_id) 
      : (Number(String(row.app_bundle_id || "").replace(/[^0-9.]/g, "")) || Date.now() + Math.random()),
    title: row.title || item.name || "Supabase 저장 자료",
    items: Array.isArray(row.raw_items) ? row.raw_items : [item],
    status: row.status || "confirmed",
    confirmedLocation: {
      country: row.country || "",
      city: row.city || "",
      area: row.area || "",
      place: row.place || "",
      confidence: 80,
    },
    purposeTag: row.purpose_tag || undefined,
    topicCategory: row.topic_category || undefined,
    factCheck: row.fact_check_status
      ? {
          status: row.fact_check_status,
          score: row.fact_check_score || 0,
          checkedAt: createdAt,
          summary: row.fact_check_summary || "Supabase 저장 자료입니다.",
          issues: [],
        }
      : undefined,
    createdAt,
  };
};

// ==================== Storage 업로드 ====================

/** 파일을 Supabase Storage에 업로드하고 URL 반환 */
export const uploadFileToSupabaseStorage = async (
  file: File,
  options?: { directory?: string; fileName?: string; upsert?: boolean },
): Promise<{ storagePath: string; fileUrl: string }> => {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured");
  }

  const supabase = getSupabase();
  const originalName = options?.fileName || file.name || "upload-file";
  const extensionMatch = originalName.match(/\.([a-zA-Z0-9]{1,10})$/);
  const extension =
    extensionMatch?.[1]?.toLowerCase() ||
    (file.type.includes("/") ? file.type.split("/")[1]?.toLowerCase() : "") ||
    "bin";

  const baseName = originalName
    .replace(/\.[^/.]+$/, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/[._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  const safeName = `${baseName || "upload-file"}.${extension}`;
  const directory = options?.directory
    ?.replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.\./g, "");
  const filePath = directory
    ? `${directory}/${safeName}`
    : `travel-items/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${safeName}`;

  const { error } = await supabase.storage
    .from(TRAVEL_DIARY_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: Boolean(options?.upsert),
      contentType: file.type || "application/octet-stream",
    });

  if (error) {
    console.error("travel-diary Supabase Storage upload failed", error);
    throw error;
  }

  const { data } = supabase.storage.from(TRAVEL_DIARY_BUCKET).getPublicUrl(filePath);

  return { storagePath: filePath, fileUrl: data.publicUrl };
};

function isRemovableTravelDiaryStoragePath(path: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/")) return false;
  // Drive 이전 후 지울 수 있는 경로: 원본 + 예전 같은 버킷 압축본
  return path.startsWith("travel-items/") || path.startsWith("album-archives/");
}

/** 앨범 원본·예전 album-archives처럼, 경로를 알고 있는 객체만 삭제한다. */
export async function removeTravelDiaryStoragePaths(paths: string[]): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const unique = [...new Set(paths.filter(isRemovableTravelDiaryStoragePath))];
  if (unique.length === 0) return true;
  try {
    const supabase = getSupabase();
    for (let index = 0; index < unique.length; index += 100) {
      const chunk = unique.slice(index, index + 100);
      const { error } = await supabase.storage.from(TRAVEL_DIARY_BUCKET).remove(chunk);
      if (error) {
        console.error("travel-diary Supabase Storage delete failed", error);
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("travel-diary Supabase Storage delete failed", error);
    return false;
  }
}

/** dataURL을 File 객체로 변환 */
export const dataUrlToGeneralInfoFile = async (
  dataUrl: string,
  fileName: string,
): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const mimeType = blob.type || "image/jpeg";

  const safeFileName =
    fileName && fileName.includes(".")
      ? fileName
      : `${fileName || "general-info-image"}.${mimeType.split("/")[1] || "jpg"}`;

  return new File([blob], safeFileName, { type: mimeType });
};

/** GeneralInfo 미디어 아이템 목록을 Supabase Storage에 업로드 */
export const uploadGeneralInfoMediaItemsToSupabaseStorage = async (
  mediaItems: GeneralInfoMediaItem[],
): Promise<GeneralInfoMediaItem[]> => {
  const uploadedItems: GeneralInfoMediaItem[] = [];

  for (const media of mediaItems) {
    if (!media) continue;

    if (
      media.type === "image" &&
      typeof media.preview === "string" &&
      media.preview.startsWith("data:")
    ) {
      try {
        const file = await dataUrlToGeneralInfoFile(
          media.preview,
          media.name || "general-info-image.jpg",
        );
        const uploaded = await uploadFileToSupabaseStorage(file);

        uploadedItems.push({
          ...media,
          id: media.id || Date.now() + Math.floor(Math.random() * 100000),
          name: media.name || file.name || "general-info-image",
          type: "image",
          preview: uploaded.fileUrl,
          fileUrl: uploaded.fileUrl,
          storagePath: uploaded.storagePath,
        } as GeneralInfoMediaItem);
        continue;
      } catch (error) {
        console.error("general info storage upload failed", error);
      }
    }

    uploadedItems.push({
      ...media,
      id: media.id || Date.now() + Math.floor(Math.random() * 100000),
      name: media.name || "general-info-media",
      type: media.type === "video" ? "video" : media.type === "image" ? "image" : "none",
      preview: media.preview || "",
    } as GeneralInfoMediaItem);
  }

  return uploadedItems;
};

// ==================== DB CRUD ====================

/** 번들을 Supabase travel_items 테이블에 저장 (upsert) */
export const saveBundleToSupabase = async (bundle: TravelBundle): Promise<boolean> => {
  if (!isSupabaseConfigured) return false;

  try {
    const supabase = getSupabase();
    const row = makeSupabaseRowFromBundle(bundle);
    const { error } = await supabase
      .from("travel_items")
      .upsert(row, { onConflict: "app_bundle_id" });

    if (error) {
      console.error("travel-diary Supabase save failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("travel-diary Supabase save failed", error);
    return false;
  }
};

/** 번들에 포함된 Storage 파일 경로 수집 */
export const collectStoragePathsFromBundle = (
  bundle: TravelBundle | null | undefined,
): string[] => {
  if (!bundle) return [];
  const paths = new Set<string>();
  bundle.items.forEach((item) => {
    if (item.storagePath) paths.add(item.storagePath);
  });
  return Array.from(paths);
};

/** 번들을 Supabase에서 삭제 (Storage 파일 포함) */
export const deleteBundleFromSupabase = async (bundle: TravelBundle): Promise<boolean> => {
  if (!isSupabaseConfigured) return false;

  try {
    const supabase = getSupabase();
    const storagePaths = collectStoragePathsFromBundle(bundle);

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from(TRAVEL_DIARY_BUCKET)
        .remove(storagePaths);

      if (storageError) {
        console.error("travel-diary Supabase Storage delete failed", storageError);
      }
    }

    const { error } = await supabase
      .from("travel_items")
      .delete()
      .eq("app_bundle_id", String(bundle.id));

    if (error) {
      console.error("travel-diary Supabase row delete failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("travel-diary Supabase delete failed", error);
    return false;
  }
};

/** 모든 여행 아이템을 Supabase에서 삭제 */
export const clearAllSupabaseTravelItems = async (
  targetBundles: TravelBundle[],
  extraStoragePaths: string[] = [],
): Promise<boolean> => {
  if (!isSupabaseConfigured) return true;

  try {
    const supabase = getSupabase();
    const storagePaths = Array.from(
      new Set([
        ...targetBundles.flatMap((bundle) => collectStoragePathsFromBundle(bundle)),
        ...extraStoragePaths.filter(Boolean),
      ]),
    );

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from(TRAVEL_DIARY_BUCKET)
        .remove(storagePaths);

      if (storageError) {
        console.error("travel-diary Supabase Storage clear failed", storageError);
      }
    }

    const { error } = await supabase
      .from("travel_items")
      .delete()
      .not("id", "is", null);

    if (error) {
      console.error("travel-diary Supabase clear failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("travel-diary Supabase clear failed", error);
    return false;
  }
};

/** Supabase travel_items 테이블에서 번들 목록 로드 */
export const loadBundlesFromSupabase = async (): Promise<TravelBundle[]> => {
  if (!isSupabaseConfigured) return [];

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("travel_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("travel-diary Supabase load failed", error);
      return [];
    }
    return (data || []).map(makeBundleFromSupabaseRow);
  } catch (error) {
    console.error("travel-diary Supabase load failed", error);
    return [];
  }
};
