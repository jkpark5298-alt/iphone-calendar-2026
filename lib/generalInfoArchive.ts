import { compressForStorage, GENERAL_INFO_BUCKET, serviceSupabase } from "./mirrorImage";
import { driveAbsolutePhotoUrl, googleDriveStatus, uploadDriveJpeg } from "./googleDrive";
import {
  invalidateStorageSummary,
  listAllStorageObjects,
  measureStorageSummary,
  storageQuotaBytes,
} from "./storageUsage";

/**
 * 일반정보수집 사진을 Google Drive로 옮긴다.
 *
 * - Supabase 저장 공간이 80%를 넘으면 시작하고, 70% 아래로 내려가면 멈춘다.
 * - 큰 사진부터 한 장씩: 내려받기 → 줄이기 → Drive에 올리기 → 올린 파일 다시 열어 확인
 *   → 글(일반정보수집)의 사진 주소를 Drive 주소로 바꾸기 → 그다음에만 Supabase 원본 삭제.
 * - 중간에 하나라도 실패하면 그 사진의 원본은 지우지 않는다.
 */
export const ARCHIVE_START_RATIO = 0.8;
export const ARCHIVE_SETTLE_RATIO = 0.7;
/** 이보다 작은 사진은 옮겨도 얻는 공간이 적어서 그대로 둔다 */
export const ARCHIVE_MIN_BYTES = 150_000;
const ARCHIVE_PREFIX = "general-info/";
const MOVABLE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

let archiveInFlight = false;

type GeneralInfoRow = {
  id: number;
  media_items: unknown;
  file_preview: string | null;
  formatted_text_html: string | null;
};

type MediaItem = Record<string, unknown> & { storagePath?: string; fileUrl?: string; preview?: string };

export type ArchiveStep = {
  path: string;
  beforeBytes: number;
  afterBytes: number;
  driveFileId: string;
  rowsUpdated: number;
  originalRemoved: boolean;
};

export type ArchiveResult = {
  ok: boolean;
  skipped?: "below-threshold" | "drive-unavailable" | "already-running" | "nothing-to-move";
  message?: string;
  percent: number;
  usedBytes: number;
  quotaBytes: number;
  moved: number;
  freedBytes: number;
  remaining: number;
  steps: ArchiveStep[];
};

const publicPrefix = () =>
  `${(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "")}/storage/v1/object/public/${GENERAL_INFO_BUCKET}/`;

const replaceAll = (text: string, from: string, to: string) => text.split(from).join(to);

/** 글 하나의 사진 주소를 Drive 주소로 바꾼 값. 바뀐 칸만 돌려준다. */
export function rewriteRowForDrive(
  row: GeneralInfoRow,
  path: string,
  driveUrl: string,
  driveFileId: string,
): Partial<Pick<GeneralInfoRow, "media_items" | "file_preview" | "formatted_text_html">> {
  const url = `${publicPrefix()}${path}`;
  const patch: Partial<GeneralInfoRow> = {};

  if (Array.isArray(row.media_items)) {
    let changed = false;
    const next = (row.media_items as MediaItem[]).map((item) => {
      const hit =
        item?.storagePath === path ||
        (typeof item?.fileUrl === "string" && item.fileUrl.includes(path)) ||
        (typeof item?.preview === "string" && item.preview.includes(path));
      if (!hit) return item;
      changed = true;
      const { storagePath: _removed, ...rest } = item;
      void _removed;
      return { ...rest, preview: driveUrl, fileUrl: driveUrl, driveFileId };
    });
    if (changed) patch.media_items = next;
  }
  if (typeof row.file_preview === "string" && row.file_preview.includes(path)) {
    patch.file_preview = replaceAll(row.file_preview, url, driveUrl);
  }
  if (typeof row.formatted_text_html === "string" && row.formatted_text_html.includes(path)) {
    patch.formatted_text_html = replaceAll(row.formatted_text_html, url, driveUrl);
  }
  return patch;
}

const pathsInRow = (row: GeneralInfoRow): string[] => {
  const found = new Set<string>();
  const re = /\/storage\/v1\/object\/public\/info-photos\/(general-info\/[^"'\s?<>\\)&]+)/g;
  const text = JSON.stringify(row);
  for (const match of text.matchAll(re)) found.add(match[1]);
  if (Array.isArray(row.media_items)) {
    for (const item of row.media_items as MediaItem[]) {
      if (typeof item?.storagePath === "string" && item.storagePath.startsWith(ARCHIVE_PREFIX)) {
        found.add(item.storagePath);
      }
    }
  }
  return [...found];
};

async function loadRows(): Promise<GeneralInfoRow[]> {
  const supabase = serviceSupabase();
  const { data, error } = await supabase
    .from("general_info_items")
    .select("id, media_items, file_preview, formatted_text_html");
  if (error) throw error;
  return (data || []) as GeneralInfoRow[];
}

export async function archiveGeneralInfoImages(options: {
  /** 80% 미만이어도 진행 (개발 서버 시험용) */
  force?: boolean;
  /** 이어서 진행할 때는 70% 기준 */
  continuing?: boolean;
  maxItems?: number;
  deadlineMs?: number;
  /** 이 경로만 처리 (개발 서버 시험용) */
  onlyPath?: string;
}): Promise<ArchiveResult> {
  const supabase = serviceSupabase();
  const quotaBytes = storageQuotaBytes();
  const base = (partial: Partial<ArchiveResult>): ArchiveResult => ({
    ok: true,
    percent: 0,
    usedBytes: 0,
    quotaBytes,
    moved: 0,
    freedBytes: 0,
    remaining: 0,
    steps: [],
    ...partial,
  });

  if (archiveInFlight) return base({ skipped: "already-running" });

  const before = await measureStorageSummary(supabase, true);
  const threshold = options.continuing ? ARCHIVE_SETTLE_RATIO : ARCHIVE_START_RATIO;
  const state = { percent: before.percent, usedBytes: before.usedBytes };
  if (!options.force && before.usedBytes / quotaBytes < threshold) {
    return base({ skipped: "below-threshold", ...state });
  }

  const status = await googleDriveStatus();
  if (!status.healthy) {
    return base({ skipped: "drive-unavailable", message: status.message || "Google Drive를 쓸 수 없습니다.", ...state });
  }

  archiveInFlight = true;
  const startedAt = Date.now();
  const deadline = options.deadlineMs ?? 40_000;
  const maxItems = options.maxItems ?? 8;
  const steps: ArchiveStep[] = [];
  try {
    const [rows, objects] = await Promise.all([loadRows(), listAllStorageObjects(supabase)]);
    const sizeByPath = new Map<string, number>();
    for (const object of objects) {
      if (object.bucket === GENERAL_INFO_BUCKET && object.name.startsWith(ARCHIVE_PREFIX)) {
        sizeByPath.set(object.name, object.size);
      }
    }

    const rowsByPath = new Map<string, GeneralInfoRow[]>();
    for (const row of rows) {
      for (const path of pathsInRow(row)) {
        if (!sizeByPath.has(path) || !MOVABLE_EXT.test(path)) continue;
        if (options.onlyPath && options.onlyPath !== path) continue;
        const list = rowsByPath.get(path) || [];
        list.push(row);
        rowsByPath.set(path, list);
      }
    }
    const candidates = [...rowsByPath.keys()]
      .filter((path) => (sizeByPath.get(path) || 0) >= (options.onlyPath ? 1 : ARCHIVE_MIN_BYTES))
      .sort((a, b) => (sizeByPath.get(b) || 0) - (sizeByPath.get(a) || 0));

    if (candidates.length === 0) {
      return base({ skipped: "nothing-to-move", ...state });
    }

    let freedBytes = 0;
    for (const path of candidates) {
      if (steps.length >= maxItems || Date.now() - startedAt > deadline) break;
      const beforeBytes = sizeByPath.get(path) || 0;
      try {
        const download = await supabase.storage.from(GENERAL_INFO_BUCKET).download(path);
        if (download.error || !download.data) throw download.error || new Error("원본을 받지 못했습니다.");
        const original = Buffer.from(await download.data.arrayBuffer());
        let jpeg = await compressForStorage(original, 1920, 80);
        // 이미 작게 만든 JPEG는 다시 줄이면 오히려 커질 수 있어 더 작은 쪽을 쓴다.
        const isJpeg = original[0] === 0xff && original[1] === 0xd8 && original[2] === 0xff;
        if (isJpeg && original.length <= jpeg.length) jpeg = original;
        const arrayBuffer = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer;

        const photoKey = path.replace(ARCHIVE_PREFIX, "").replace(/\.[^.]+$/, "");
        const uploaded = await uploadDriveJpeg("general-info", photoKey, arrayBuffer);
        const driveUrl = driveAbsolutePhotoUrl(uploaded.fileId);

        // 이 사진을 쓰는 글의 주소를 모두 바꾼다. 하나라도 못 바꾸면 원본을 지우지 않는다.
        let rowsUpdated = 0;
        let allUpdated = true;
        for (const row of rowsByPath.get(path) || []) {
          const patch = rewriteRowForDrive(row, path, driveUrl, uploaded.fileId);
          if (Object.keys(patch).length === 0) continue;
          const updated = await supabase.from("general_info_items").update(patch).eq("id", row.id).select("id");
          if (updated.error || !updated.data?.length) allUpdated = false;
          else rowsUpdated += 1;
        }

        let originalRemoved = false;
        if (allUpdated && rowsUpdated > 0) {
          const removed = await supabase.storage.from(GENERAL_INFO_BUCKET).remove([path]);
          originalRemoved = !removed.error;
          if (originalRemoved) freedBytes += beforeBytes;
        }
        steps.push({
          path,
          beforeBytes,
          afterBytes: uploaded.bytes,
          driveFileId: uploaded.fileId,
          rowsUpdated,
          originalRemoved,
        });
      } catch (error) {
        console.error("general info archive step failed", path, error);
        // 이 사진은 그대로 두고 다음 사진으로 넘어간다.
      }
      // 70% 아래로 내려가면 더 옮기지 않는다 (예상값으로 계산)
      if (!options.force && (before.usedBytes - freedBytes) / quotaBytes < ARCHIVE_SETTLE_RATIO) break;
    }

    invalidateStorageSummary();
    const after = await measureStorageSummary(supabase, true);
    const doneCount = steps.filter((step) => step.originalRemoved).length;
    return base({
      percent: after.percent,
      usedBytes: after.usedBytes,
      moved: doneCount,
      freedBytes: Math.max(0, before.usedBytes - after.usedBytes),
      remaining: Math.max(0, candidates.length - doneCount),
      steps,
    });
  } finally {
    archiveInFlight = false;
  }
}
