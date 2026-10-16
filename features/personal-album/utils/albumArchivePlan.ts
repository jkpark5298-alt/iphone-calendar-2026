import type { Chapter3AlbumPhoto } from "./chapter3Utils";
import type { SavedTravelAlbum } from "./chapter3SavedAlbumUtils";
import { TRAVEL_DIARY_BUCKET } from "../../../lib/supabaseClient";

/**
 * 무료 플랜 저장 한도 1GB. 대시보드가 1.31/1 GB이고 유예는 2026-10-27에 끝난다.
 * 한도가 다르면 NEXT_PUBLIC_SUPABASE_STORAGE_QUOTA_BYTES 로 맞춘다.
 */
export const DEFAULT_STORAGE_QUOTA_BYTES = 1_000_000_000;
export const STORAGE_MIGRATE_RATIO = 0.8;
export const STORAGE_SETTLE_RATIO = 0.7;
export const ARCHIVE_PREFIX = "album-archives/";
/** 버킷 한 파일 상한 10MB보다 작게 유지 */
export const ARCHIVE_JPEG_MAX_BYTES = 9_500_000;

export function storageQuotaBytes(): number {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_QUOTA_BYTES;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_STORAGE_QUOTA_BYTES;
}

export function shouldStartStorageMigration(usedBytes: number, quotaBytes: number): boolean {
  if (quotaBytes <= 0 || usedBytes < 0) return false;
  return usedBytes / quotaBytes >= STORAGE_MIGRATE_RATIO;
}

/** 한 번 옮기기 시작하면 여유가 생길 때까지 다음 앨범을 계속 옮긴다. */
export function shouldKeepMigrating(usedBytes: number, quotaBytes: number): boolean {
  if (quotaBytes <= 0 || usedBytes < 0) return false;
  return usedBytes / quotaBytes >= STORAGE_SETTLE_RATIO;
}

export function storageUsagePercent(usedBytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  return Math.max(0, Math.min(999, Math.round((usedBytes / quotaBytes) * 100)));
}

export function jpegBytesOpenable(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isArchiveStoragePath(path: string | undefined): boolean {
  return Boolean(path && path.startsWith(ARCHIVE_PREFIX));
}

/** 앨범 원본만 지운다. 압축본·다른 자료 경로는 거부한다. */
export function isRemovableOriginalPath(path: string | undefined): boolean {
  if (!path || path.includes("..") || path.includes("\\")) return false;
  if (!path.startsWith("travel-items/")) return false;
  const parts = path.split("/");
  return parts.length >= 3 && parts.every((part) => part.length > 0);
}

/** @deprecated 예전 같은 버킷 압축본 경로. 신규 업로드는 Drive만 사용한다. */
export function archiveObjectPath(albumId: string, photoId: string): string {
  const album = albumId.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || "album";
  const photo = photoId.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 120) || "photo";
  return `${ARCHIVE_PREFIX}${album}/${photo}.jpg`;
}

export function storagePathFromPublicUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith("http")) return undefined;
  const marker = `/object/public/${TRAVEL_DIARY_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return undefined;
  const path = url.slice(index + marker.length).split("?")[0];
  if (!path) return undefined;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function photoStoragePath(photo: Chapter3AlbumPhoto): string | undefined {
  if (photo.storagePath) return photo.storagePath;
  return storagePathFromPublicUrl(photo.fileUrl || photo.dataUrl);
}

/** Drive에 있으면 완료. 예전 album-archives 만 있는 경우는 아직 Drive 이전이 남았다. */
export function photoIsArchived(photo: Chapter3AlbumPhoto): boolean {
  return Boolean(photo.driveFileId);
}

export function photoOnLegacyArchive(photo: Chapter3AlbumPhoto): boolean {
  return !photo.driveFileId && isArchiveStoragePath(photoStoragePath(photo));
}

export function eachAlbumPhoto(album: SavedTravelAlbum): Chapter3AlbumPhoto[] {
  return (album.days || []).flatMap((day) =>
    (day.places || []).flatMap((place) => place.photos || []),
  );
}

/** travel-items 원본 경로. Drive 이전 후 삭제 대상. */
export function originalStoragePath(photo: Chapter3AlbumPhoto): string | undefined {
  if (photo.driveFileId) return undefined;
  const path = photoStoragePath(photo);
  if (!isRemovableOriginalPath(path)) return undefined;
  return path;
}

/** Drive로 올려야 하는 Supabase 경로(원본 또는 예전 album-archives). */
export function migrateSourcePath(photo: Chapter3AlbumPhoto): string | undefined {
  if (photo.driveFileId) return undefined;
  const path = photoStoragePath(photo);
  if (isRemovableOriginalPath(path)) return path;
  if (isArchiveStoragePath(path) && isRemovableArchivePath(path)) return path;
  return undefined;
}

/** 예전 같은 버킷 압축본. Drive로 옮긴 뒤 지울 수 있다. */
export function isRemovableArchivePath(path: string | undefined): boolean {
  if (!path || path.includes("..") || path.includes("\\")) return false;
  if (!path.startsWith(ARCHIVE_PREFIX)) return false;
  const parts = path.split("/");
  return parts.length >= 3 && parts.every((part) => part.length > 0);
}

export function isRemovableMigrationPath(path: string | undefined): boolean {
  return isRemovableOriginalPath(path) || isRemovableArchivePath(path);
}

export function countOriginalPhotos(album: SavedTravelAlbum): number {
  return eachAlbumPhoto(album).filter((photo) => migrateSourcePath(photo)).length;
}

export function pickNextAlbumToMigrate(
  albums: SavedTravelAlbum[],
  skipAlbumId?: string | null,
): SavedTravelAlbum | null {
  const ranked = albums
    .filter((album) => album.status === "saved" && !album.deletedAt && album.id !== skipAlbumId)
    .map((album) => ({ album, count: countOriginalPhotos(album) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  return ranked[0]?.album ?? null;
}

/**
 * 이번 앨범에서 바꾼 사진의 예전 경로만 지운다.
 * 다른 앨범·삭제 보관·아직 안 바꾼 사진이 쓰는 경로는 남긴다.
 */
export function pathsSafeToRemove(
  candidatePaths: string[],
  albums: SavedTravelAlbum[],
  migratedAlbumId: string,
  migratedPhotoIds: ReadonlySet<string>,
): string[] {
  const stillUsed = new Set<string>();
  for (const album of albums) {
    for (const photo of eachAlbumPhoto(album)) {
      if (album.id === migratedAlbumId && migratedPhotoIds.has(photo.id)) continue;
      const path = photoStoragePath(photo);
      if (path) stillUsed.add(path);
    }
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const path of candidatePaths) {
    if (!isRemovableMigrationPath(path) || stillUsed.has(path) || seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  return unique;
}

export type CompressedPhotoReplacement = {
  photoId: string;
  /** Drive 압축본이면 비움. 예전 album-archives 경로만 채운다. */
  storagePath?: string;
  fileUrl: string;
  bytes: number;
  driveFileId?: string;
};

export function applyCompressedPhotos(
  album: SavedTravelAlbum,
  replacements: CompressedPhotoReplacement[],
  updatedAt: string,
): SavedTravelAlbum {
  const byId = new Map(replacements.map((item) => [item.photoId, item]));
  const days = (album.days || []).map((day) => ({
    ...day,
    places: (day.places || []).map((place) => ({
      ...place,
      photos: (place.photos || []).map((photo) => {
        const next = byId.get(photo.id);
        if (!next) return photo;
        return {
          ...photo,
          dataUrl: next.fileUrl,
          fileUrl: next.fileUrl,
          storagePath: next.driveFileId ? undefined : next.storagePath,
          driveFileId: next.driveFileId || photo.driveFileId,
          archived: true,
        };
      }),
    })),
  }));
  const nextAlbum: SavedTravelAlbum = { ...album, days, updatedAt };
  const addedBytes = replacements.reduce((sum, item) => sum + item.bytes, 0);
  nextAlbum.photoArchive = {
    version: 1,
    updatedAt,
    photoCount: eachAlbumPhoto(nextAlbum).filter((photo) => photoIsArchived(photo)).length,
    compressedBytes: (album.photoArchive?.compressedBytes || 0) + addedBytes,
  };
  return nextAlbum;
}
