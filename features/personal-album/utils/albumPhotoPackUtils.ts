import type { SavedTravelAlbum } from "./chapter3SavedAlbumUtils";
import { resolveAlbumDayDateIso } from "./albumDateUtils";
import { photoDisplayUrl } from "./chapter3AlbumSyncUtils";
import { sortAlbumPhotos } from "./albumPhotoOrderUtils";
import type { Chapter3AlbumDay, Chapter3AlbumPhoto } from "./chapter3Utils";
import { deliverAlbumFile, serializeAlbumAppFile } from "./albumAppFileUtils";
import { buildStoredZip, type StoredZipFile } from "./zipStore";

export type AlbumPhotoPackMode = "view" | "original";

export const ALBUM_VIEW_PHOTO_MAX_EDGE = 1600;

export type PlannedAlbumPhotoFile = {
  zipPath: string;
  url: string;
  fileName?: string;
};

function safeSegment(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "사진").slice(0, 80);
}

function packBaseName(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "여행앨범").slice(0, 80);
}

/** PC(비 모바일)에서만 대용량 zip 백업 허용 */
export function canSaveAlbumPcBackup(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return !ios && !/Android/i.test(ua);
}

export function canSaveAlbumOriginalPack(): boolean {
  return canSaveAlbumPcBackup();
}

function dayFolderName(day: Chapter3AlbumDay): string {
  const iso = resolveAlbumDayDateIso(day);
  if (iso) return iso;
  const label = day.dateLabel?.trim();
  if (label) return safeSegment(label);
  return "날짜 없음";
}

function extensionFor(photo: Chapter3AlbumPhoto, url: string): string {
  const fromName = photo.fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  const fromUrl = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i)?.[1];
  const ext = (fromName || fromUrl || "jpg").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ext;
}

export function planAlbumPhotoFiles(
  album: SavedTravelAlbum,
  mode: AlbumPhotoPackMode,
): PlannedAlbumPhotoFile[] {
  const used = new Set<string>();
  const planned: PlannedAlbumPhotoFile[] = [];

  for (const day of album.days || []) {
    const folder = dayFolderName(day);
    let index = 1;
    for (const place of day.places || []) {
      for (const photo of sortAlbumPhotos(place.photos || [])) {
        const url = photoDisplayUrl(photo);
        if (!url) continue;
        const ext = mode === "view" ? "jpg" : extensionFor(photo, url);
        const placeLabel = photo.exifPlaceName?.trim() || place.name?.trim() || "사진";
        let leaf = `${String(index).padStart(3, "0")} ${safeSegment(placeLabel)}`;
        let zipPath = `사진/${folder}/${leaf}.${ext}`;
        if (used.has(zipPath)) {
          leaf = `${leaf} ${photo.id.slice(-4)}`;
          zipPath = `사진/${folder}/${leaf}.${ext}`;
        }
        used.add(zipPath);
        planned.push({ zipPath, url, fileName: photo.fileName });
        index += 1;
      }
    }
  }

  return planned;
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
    type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
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
    if (edge <= maxEdge && source.type === "image/jpeg" && source.size <= 9_500_000 && quality >= 0.82) {
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

/** 저장소에 올릴 압축 JPEG. 버킷 한 파일 한도(10MB)보다 작게 맞춘다. */
export async function fileToViewJpegFile(file: File): Promise<File> {
  let maxEdge = ALBUM_VIEW_PHOTO_MAX_EDGE;
  let quality = 0.82;
  let jpeg = await toViewJpeg(file, file.name, maxEdge, quality);
  while (jpeg.size > 9_500_000 && (maxEdge > 960 || quality > 0.5)) {
    maxEdge = Math.max(960, Math.round(maxEdge * 0.75));
    quality = Math.max(0.5, Math.round((quality - 0.12) * 100) / 100);
    jpeg = await toViewJpeg(file, file.name, maxEdge, quality);
  }
  const base = (file.name || "photo").replace(/\.[^.]+$/, "") || "photo";
  return new File([jpeg], `${base}.jpg`, { type: "image/jpeg" });
}

export async function saveAlbumPhotoPack(
  album: SavedTravelAlbum,
  mode: AlbumPhotoPackMode,
  onProgress?: (done: number, total: number) => void,
): Promise<{ delivery: "shared" | "downloaded"; saved: number; failed: number }> {
  const planned = planAlbumPhotoFiles(album, mode);
  if (planned.length === 0) throw new Error("저장할 사진이 없습니다.");

  const files: StoredZipFile[] = [
    {
      name: "album.json",
      data: new TextEncoder().encode(serializeAlbumAppFile(album)),
    },
  ];
  let saved = 0;
  let failed = 0;
  onProgress?.(0, planned.length);

  for (const item of planned) {
    try {
      const blob = await loadPhotoBlob(item.url);
      const packed = mode === "view" ? await toViewJpeg(blob, item.fileName) : blob;
      files.push({ name: item.zipPath, data: new Uint8Array(await packed.arrayBuffer()) });
      saved += 1;
    } catch (error) {
      console.error("album photo pack skipped", item.zipPath, error);
      failed += 1;
    }
    onProgress?.(saved + failed, planned.length);
  }

  if (saved === 0) throw new Error("사진을 받지 못해 파일을 만들지 못했습니다.");

  const suffix = mode === "view" ? "사진포함" : "원본";
  const file = new File([buildStoredZip(files)], `${packBaseName(album.title)}.${suffix}.zip`, {
    type: "application/zip",
  });
  const delivery = await deliverAlbumFile(file);
  return { delivery, saved, failed };
}
