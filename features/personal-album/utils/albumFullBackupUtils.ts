import type { SavedTravelAlbum } from "./chapter3SavedAlbumUtils";
import { getAlbumDateRangeText, countAlbumPhotos } from "./chapter3SavedAlbumUtils";
import { slimAlbumDaysForRemote, drivePhotoProxyUrl, photoDisplayUrl } from "./chapter3AlbumSyncUtils";
import type { Chapter3AlbumDay, Chapter3AlbumPhoto } from "./chapter3Utils";
import {
  deliverAlbumFile,
  parseAlbumAppFile,
  prepareImportedAlbum,
  serializeAlbumAppFile,
} from "./albumAppFileUtils";
import {
  ALBUM_VIEW_PHOTO_MAX_EDGE,
  canSaveAlbumPcBackup,
  planAlbumPhotoFiles,
  type PlannedAlbumPhotoFile,
} from "./albumPhotoPackUtils";
import { sortAlbumPhotos } from "./albumPhotoOrderUtils";
import { buildStoredZip, readStoredZip, type StoredZipFile } from "./zipStore";
import { uploadCompressedJpegToDrive } from "./googleDriveClient";
import { resolveAlbumDayDateIso } from "./albumDateUtils";

export const TRAVEL_ALBUM_FULL_BACKUP_TYPE = "travel-diary-album-full-backup";

export type AlbumFullBackupManifest = {
  type: typeof TRAVEL_ALBUM_FULL_BACKUP_TYPE;
  version: 1;
  exportedAt: string;
  mode: "view";
  files: { photoId: string; zipPath: string }[];
  album: SavedTravelAlbum;
};

function safeSegment(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "여행앨범").slice(0, 60);
}

export { canSaveAlbumPcBackup };

export function albumBackupDateSlug(album: SavedTravelAlbum): string {
  const isos = (album.days || [])
    .map((day) => resolveAlbumDayDateIso(day))
    .filter(Boolean)
    .sort();
  if (isos.length === 0) return "날짜미정";
  const start = isos[0];
  const end = isos[isos.length - 1];
  return start === end ? start : `${start}~${end}`;
}

export function albumFullBackupFileName(album: SavedTravelAlbum): string {
  return `${safeSegment(album.title)}_${albumBackupDateSlug(album)}.완전백업.zip`;
}

export function albumFullBackupFolderName(album: SavedTravelAlbum): string {
  return `${safeSegment(album.title)}_${albumBackupDateSlug(album)}`;
}

export function restoredAlbumTitle(title: string): string {
  const base = title.replace(/\s*\(복원\)\s*$/u, "").trim() || "여행 앨범";
  return `${base} (복원)`;
}

function eachPhoto(
  days: Chapter3AlbumDay[],
): { photo: Chapter3AlbumPhoto; day: Chapter3AlbumDay }[] {
  const out: { photo: Chapter3AlbumPhoto; day: Chapter3AlbumDay }[] = [];
  for (const day of days || []) {
    for (const place of day.places || []) {
      for (const photo of place.photos || []) out.push({ photo, day });
    }
  }
  return out;
}

async function loadPhotoBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`사진을 받지 못했습니다 (${response.status})`);
  return response.blob();
}

async function ensureDecodable(blob: Blob, fileName?: string): Promise<Blob> {
  const type = (blob.type || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  const heic =
    type.includes("heic") ||
    type.includes("heif") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif");
  if (!heic) return blob;
  const heic2any = (await import("heic2any")).default;
  const converted = await heic2any({ blob, toType: "image/jpeg", quality: 0.82 });
  return Array.isArray(converted) ? converted[0] : converted;
}

async function toViewJpeg(
  blob: Blob,
  fileName?: string,
  maxEdge = ALBUM_VIEW_PHOTO_MAX_EDGE,
  quality = 0.82,
): Promise<Blob> {
  const source = await ensureDecodable(blob, fileName);
  const bitmap = await createImageBitmap(source);
  try {
    const edge = Math.max(bitmap.width, bitmap.height);
    if (
      edge <= maxEdge &&
      source.type === "image/jpeg" &&
      source.size <= 9_500_000 &&
      quality >= 0.82
    ) {
      return source;
    }
    const scale = edge > 0 ? Math.min(1, maxEdge / edge) : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("사진을 줄이지 못했습니다.");
    context.drawImage(bitmap, 0, 0, width, height);
    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((next) => resolve(next), "image/jpeg", quality);
    });
    if (!jpeg) throw new Error("사진을 줄이지 못했습니다.");
    return jpeg;
  } finally {
    bitmap.close();
  }
}

function orderedPhotosWithUrls(album: SavedTravelAlbum): Chapter3AlbumPhoto[] {
  const out: Chapter3AlbumPhoto[] = [];
  for (const day of album.days || []) {
    for (const place of day.places || []) {
      for (const photo of sortAlbumPhotos(place.photos || [])) {
        if (photoDisplayUrl(photo)) out.push(photo);
      }
    }
  }
  return out;
}

function plannedWithPhotoIds(
  album: SavedTravelAlbum,
): (PlannedAlbumPhotoFile & { photoId: string })[] {
  const planned = planAlbumPhotoFiles(album, "view");
  const photos = orderedPhotosWithUrls(album);
  if (planned.length !== photos.length) {
    throw new Error(
      `백업 목록이 맞지 않습니다 (${planned.length}/${photos.length}). 앨범을 새로고침한 뒤 다시 시도해 주세요.`,
    );
  }
  return planned.map((item, index) => ({
    ...item,
    photoId: photos[index].id,
    url: photoDisplayUrl(photos[index]) || item.url,
  }));
}

export type FullBackupProgress = {
  phase: "photos" | "zip";
  done: number;
  total: number;
  albumTitle?: string;
};

async function buildAlbumBackupFiles(
  album: SavedTravelAlbum,
  pathPrefix: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ files: StoredZipFile[]; photoCount: number }> {
  const planned = plannedWithPhotoIds(album);
  const expected = countAlbumPhotos(album.days);
  if (expected === 0) throw new Error("저장할 사진이 없습니다.");
  if (planned.length !== expected) {
    throw new Error(
      `사진 주소가 없는 항목이 있어 백업할 수 없습니다 (${planned.length}/${expected}).`,
    );
  }

  const files: StoredZipFile[] = [];
  const manifestFiles: { photoId: string; zipPath: string }[] = [];
  onProgress?.(0, planned.length);

  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    try {
      const blob = await loadPhotoBlob(item.url);
      const packed = await toViewJpeg(blob, item.fileName);
      const zipPath = pathPrefix ? `${pathPrefix}/${item.zipPath}` : item.zipPath;
      files.push({ name: zipPath, data: new Uint8Array(await packed.arrayBuffer()) });
      manifestFiles.push({ photoId: item.photoId, zipPath: item.zipPath });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "알 수 없는 오류";
      throw new Error(
        `사진 ${i + 1}/${planned.length}장을 받지 못해 백업을 중단했습니다. (${reason})`,
      );
    }
    onProgress?.(i + 1, planned.length);
  }

  if (files.length !== planned.length) {
    throw new Error("일부 사진이 빠져 백업 파일을 만들지 않습니다.");
  }

  const slimAlbum: SavedTravelAlbum = {
    ...album,
    deletedAt: undefined,
    days: slimAlbumDaysForRemote(album.days),
  };
  const manifest: AlbumFullBackupManifest = {
    type: TRAVEL_ALBUM_FULL_BACKUP_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    mode: "view",
    files: manifestFiles,
    album: slimAlbum,
  };
  const albumJsonName = pathPrefix ? `${pathPrefix}/album.json` : "album.json";
  files.unshift({
    name: albumJsonName,
    data: new TextEncoder().encode(JSON.stringify(manifest)),
  });
  // 가벼운 앱파일 호환본도 함께 보관
  files.push({
    name: pathPrefix ? `${pathPrefix}/album.app.json` : "album.app.json",
    data: new TextEncoder().encode(serializeAlbumAppFile(slimAlbum)),
  });

  return { files, photoCount: planned.length };
}

/** 앨범 1개 PC 완전 백업 — 사진 100% 성공 시에만 zip 저장 */
export async function saveAlbumFullBackup(
  album: SavedTravelAlbum,
  onProgress?: (done: number, total: number) => void,
): Promise<{ delivery: "shared" | "downloaded"; saved: number }> {
  if (!canSaveAlbumPcBackup()) {
    throw new Error("PC에서만 완전 백업을 만들 수 있습니다.");
  }
  const { files, photoCount } = await buildAlbumBackupFiles(album, "", onProgress);
  const file = new File([buildStoredZip(files)], albumFullBackupFileName(album), {
    type: "application/zip",
  });
  const delivery = await deliverAlbumFile(file, { forceDownload: true });
  return { delivery, saved: photoCount };
}

/** 확정 앨범 전체 PC 완전 백업 — 앨범마다 100%일 때만 포함, 하나라도 실패 시 중단 */
export async function saveAllAlbumsFullBackup(
  albums: SavedTravelAlbum[],
  onProgress?: (progress: FullBackupProgress) => void,
): Promise<{ delivery: "shared" | "downloaded"; albumCount: number; photoCount: number }> {
  if (!canSaveAlbumPcBackup()) {
    throw new Error("PC에서만 완전 백업을 만들 수 있습니다.");
  }
  const targets = albums.filter((album) => countAlbumPhotos(album.days) > 0);
  if (targets.length === 0) throw new Error("백업할 사진이 있는 앨범이 없습니다.");

  const allFiles: StoredZipFile[] = [];
  let photoCount = 0;

  for (const album of targets) {
    const folder = albumFullBackupFolderName(album);
    const { files, photoCount: count } = await buildAlbumBackupFiles(
      album,
      folder,
      (done, total) => onProgress?.({ phase: "photos", done, total, albumTitle: album.title }),
    );
    allFiles.push(...files);
    photoCount += count;
  }

  onProgress?.({ phase: "zip", done: targets.length, total: targets.length });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(
    [buildStoredZip(allFiles)],
    `여행일기_전체백업_${stamp}.완전백업.zip`,
    { type: "application/zip" },
  );
  const delivery = await deliverAlbumFile(file, { forceDownload: true });
  return { delivery, albumCount: targets.length, photoCount };
}

function parseManifest(text: string): AlbumFullBackupManifest {
  const parsed = JSON.parse(text) as Partial<AlbumFullBackupManifest>;
  if (
    parsed?.type === TRAVEL_ALBUM_FULL_BACKUP_TYPE &&
    parsed.version === 1 &&
    parsed.album &&
    Array.isArray(parsed.files)
  ) {
    return parsed as AlbumFullBackupManifest;
  }
  // 구형 사진포함 zip: album.json이 앱파일 형식
  const album = parseAlbumAppFile(text);
  const planned = planAlbumPhotoFiles(album, "view");
  const photos = eachPhoto(album.days).map((item) => item.photo);
  const files: { photoId: string; zipPath: string }[] = [];
  let pi = 0;
  for (const item of planned) {
    while (pi < photos.length) {
      const photo = photos[pi++];
      const url = photo.driveFileId
        ? drivePhotoProxyUrl(photo.driveFileId)
        : photo.fileUrl || photo.dataUrl || "";
      if (!url) continue;
      files.push({ photoId: photo.id, zipPath: item.zipPath });
      break;
    }
  }
  return {
    type: TRAVEL_ALBUM_FULL_BACKUP_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    mode: "view",
    files,
    album,
  };
}

function findManifestEntries(
  zipFiles: StoredZipFile[],
): { prefix: string; manifest: AlbumFullBackupManifest; byPath: Map<string, Uint8Array> }[] {
  const byPath = new Map(zipFiles.map((file) => [file.name.replace(/\\/g, "/"), file.data]));
  const manifests = zipFiles.filter(
    (file) => file.name === "album.json" || file.name.endsWith("/album.json"),
  );
  if (manifests.length === 0) {
    throw new Error("album.json이 없는 zip입니다. 완전 백업 파일을 선택해 주세요.");
  }

  return manifests.map((entry) => {
    const name = entry.name.replace(/\\/g, "/");
    const prefix = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    const text = new TextDecoder().decode(entry.data);
    const manifest = parseManifest(text);
    return { prefix, manifest, byPath };
  });
}

function mapDaysWithUploadedPhotos(
  days: Chapter3AlbumDay[],
  uploaded: Map<string, { fileId: string; fileUrl: string }>,
): Chapter3AlbumDay[] {
  return days.map((day) => ({
    ...day,
    places: day.places.map((place) => ({
      ...place,
      photos: place.photos.map((photo) => {
        const next = uploaded.get(photo.id);
        if (!next) return photo;
        return {
          ...photo,
          driveFileId: next.fileId,
          fileUrl: next.fileUrl,
          dataUrl: next.fileUrl,
          storagePath: undefined,
          archived: true,
        };
      }),
    })),
  }));
}

export type ImportFullBackupResult = {
  albums: SavedTravelAlbum[];
  photoCount: number;
  mode: "links" | "reupload";
};

async function driveLinksStillOpen(album: SavedTravelAlbum): Promise<boolean> {
  const photos = eachPhoto(album.days).map((item) => item.photo);
  const withDrive = photos.filter((photo) => photo.driveFileId);
  if (withDrive.length === 0) return false;
  const sample = withDrive[0];
  try {
    const response = await fetch(drivePhotoProxyUrl(sample.driveFileId!), { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function reuploadAlbumFromZip(
  prepared: SavedTravelAlbum,
  prefix: string,
  manifest: AlbumFullBackupManifest,
  byPath: Map<string, Uint8Array>,
  onProgress?: (done: number, total: number) => void,
  progressOffset = 0,
  progressTotal = manifest.files.length,
): Promise<SavedTravelAlbum> {
  const uploaded = new Map<string, { fileId: string; fileUrl: string }>();
  for (let i = 0; i < manifest.files.length; i++) {
    const item = manifest.files[i];
    const fullPath = prefix ? `${prefix}/${item.zipPath}` : item.zipPath;
    const data = byPath.get(fullPath);
    if (!data) {
      throw new Error(`백업에 사진이 없습니다: ${item.zipPath}`);
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const blob = new Blob([copy], { type: "image/jpeg" });
    try {
      const drive = await uploadCompressedJpegToDrive(blob, prepared.id, item.photoId);
      uploaded.set(item.photoId, { fileId: drive.fileId, fileUrl: drive.fileUrl });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "업로드 실패";
      throw new Error(
        `사진 ${i + 1}/${manifest.files.length}장 Drive 업로드 실패: ${reason}`,
      );
    }
    onProgress?.(progressOffset + i + 1, progressTotal);
  }
  return {
    ...prepared,
    days: slimAlbumDaysForRemote(mapDaysWithUploadedPhotos(prepared.days, uploaded)),
    photoArchive: {
      version: 1,
      updatedAt: new Date().toISOString(),
      photoCount: uploaded.size,
      compressedBytes: 0,
    },
  };
}

/**
 * PC 완전 백업 zip 불러오기.
 * Drive에 사진이 아직 있으면 링크만으로 바로 앨범을 만들고,
 * 없거나 열리지 않으면 zip 사진으로 Drive에 다시 올린다.
 */
export async function importAlbumFullBackupZip(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportFullBackupResult> {
  const zipFiles = readStoredZip(await file.arrayBuffer());
  const entries = findManifestEntries(zipFiles);
  const restored: SavedTravelAlbum[] = [];
  let photoCount = 0;
  let mode: "links" | "reupload" = "links";
  const photoTotal = entries.reduce((sum, entry) => sum + entry.manifest.files.length, 0);
  onProgress?.(0, Math.max(photoTotal, 1));

  let progressOffset = 0;
  for (const entry of entries) {
    const { prefix, manifest, byPath } = entry;
    const prepared = prepareImportedAlbum({
      ...manifest.album,
      title: restoredAlbumTitle(manifest.album.title || "여행 앨범"),
    });
    prepared.sourceLabel = "PC 완전 백업";

    const linksOk = await driveLinksStillOpen(prepared);
    if (linksOk) {
      const count = countAlbumPhotos(prepared.days);
      restored.push({
        ...prepared,
        days: slimAlbumDaysForRemote(prepared.days),
        photoArchive: prepared.photoArchive || {
          version: 1,
          updatedAt: new Date().toISOString(),
          photoCount: count,
          compressedBytes: 0,
        },
      });
      photoCount += count;
      progressOffset += manifest.files.length;
      onProgress?.(progressOffset, photoTotal);
      continue;
    }

    mode = "reupload";
    const uploadedAlbum = await reuploadAlbumFromZip(
      prepared,
      prefix,
      manifest,
      byPath,
      onProgress,
      progressOffset,
      photoTotal,
    );
    restored.push(uploadedAlbum);
    photoCount += countAlbumPhotos(uploadedAlbum.days);
    progressOffset += manifest.files.length;
  }

  if (restored.length === 0) {
    throw new Error("불러올 앨범이 없습니다.");
  }
  return { albums: restored, photoCount, mode };
}

export function formatAlbumBackupHint(album: SavedTravelAlbum): string {
  const range = getAlbumDateRangeText(album.days);
  const count = countAlbumPhotos(album.days);
  return `「${album.title}」(${range}, ${count}장) PC 완전 백업을 받아 두었나요? 백업 zip을 지우면 복원이 어렵습니다.`;
}
