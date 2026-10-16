import type { Chapter3AlbumDay, Chapter3AlbumPhoto } from "./chapter3Utils";

/** 사진 올리기 1회에 선택할 수 있는 장수 */
export const ALBUM_UPLOAD_MAX_FILES = 100;
/** 사진 올리기 횟수 */
export const ALBUM_UPLOAD_MAX_ROUNDS = 10;

export type AlbumUploadBatchGate =
  | { ok: true }
  | { ok: false; reason: "round-limit" | "too-many" };

/** 처리한 장수 대비 진행률. 0, 10, 20, … 100만 반환한다. */
export function albumUploadPercent(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  return Math.min(100, Math.floor((done / total) * 10) * 10);
}

export function gateAlbumUploadBatch(
  selectedCount: number,
  completedRounds: number,
): AlbumUploadBatchGate {
  if (completedRounds >= ALBUM_UPLOAD_MAX_ROUNDS) {
    return { ok: false, reason: "round-limit" };
  }
  if (selectedCount > ALBUM_UPLOAD_MAX_FILES) {
    return { ok: false, reason: "too-many" };
  }
  return { ok: true };
}

type NamedFile = { name?: string; size: number; lastModified?: number };

function normalizedFileName(name: string | undefined): string {
  return (name || "").trim().toLowerCase();
}

/** 다시 골라도 같은 사진으로 보는 키. 촬영 시각이 있으면 파일명+시각, 없으면 파일명+용량. */
export function preferredAlbumDedupeKey(file: NamedFile, takenAtMs?: number): string {
  const name = normalizedFileName(file.name);
  if (name && typeof takenAtMs === "number" && Number.isFinite(takenAtMs)) {
    return `shot:${name}|${Math.round(takenAtMs)}`;
  }
  if (!name) {
    return `file:|${file.size}|${file.lastModified ?? 0}`;
  }
  return `name-size:${name}|${file.size}`;
}

export function albumFileIdentityKeys(file: NamedFile, takenAtMs?: number): string[] {
  const keys = new Set<string>([preferredAlbumDedupeKey(file, takenAtMs)]);
  const name = normalizedFileName(file.name);
  if (name && file.size > 0) keys.add(`name-size:${name}|${file.size}`);
  if (name && typeof takenAtMs === "number" && Number.isFinite(takenAtMs)) {
    keys.add(`shot:${name}|${Math.round(takenAtMs)}`);
  }
  return [...keys];
}

export function albumPhotoIdentityKeys(
  photo: Pick<Chapter3AlbumPhoto, "dedupeKey" | "fileName" | "exifTakenAt" | "fileSize">,
): string[] {
  const keys = new Set<string>();
  if (photo.dedupeKey) keys.add(photo.dedupeKey);
  const name = normalizedFileName(photo.fileName);
  if (name && typeof photo.exifTakenAt === "number" && Number.isFinite(photo.exifTakenAt)) {
    keys.add(`shot:${name}|${Math.round(photo.exifTakenAt)}`);
  }
  if (name && typeof photo.fileSize === "number" && photo.fileSize > 0) {
    keys.add(`name-size:${name}|${photo.fileSize}`);
  }
  return [...keys];
}

export function collectAlbumDedupeKeys(days: Chapter3AlbumDay[]): Set<string> {
  const keys = new Set<string>();
  for (const day of days) {
    for (const place of day.places) {
      for (const photo of place.photos) {
        for (const key of albumPhotoIdentityKeys(photo)) keys.add(key);
      }
    }
  }
  return keys;
}

export function isDuplicateAlbumFile(
  file: NamedFile,
  takenAtMs: number | undefined,
  keys: Set<string>,
): boolean {
  if (keys.has(preferredAlbumDedupeKey(file, takenAtMs))) return true;
  const name = normalizedFileName(file.name);
  const hasTakenAt = typeof takenAtMs === "number" && Number.isFinite(takenAtMs);
  if (!hasTakenAt && name && file.size > 0 && keys.has(`name-size:${name}|${file.size}`)) {
    return true;
  }
  return false;
}
