/**
 * 여행 앨범 사진 Supabase Storage 업로드 + 원격/로컬 동기화용 슬림화
 */
import type { Chapter3AlbumDay, Chapter3AlbumPhoto } from "./chapter3Utils";
import { isSupabaseConfigured } from "../../../lib/supabaseClient";
import { fileToViewJpegFile } from "./albumPhotoPackUtils";
import { storageNeedsArchive } from "./albumArchivePressure";
import { uploadCompressedJpegToDrive } from "./googleDriveClient";
import { uploadFileToSupabaseStorage } from "./supabaseUtils";

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1] || "image/jpeg";
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const safeName = fileName?.trim() || `album-photo.${ext}`;
    return new File([bytes], safeName.replace(/\.[^.]+$/, "") + `.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

export function drivePhotoProxyUrl(fileId: string): string {
  return `/api/google-drive/file?id=${encodeURIComponent(fileId)}`;
}

export function photoDisplayUrl(photo: Chapter3AlbumPhoto): string {
  if (photo.driveFileId) return drivePhotoProxyUrl(photo.driveFileId);
  if (photo.dataUrl?.startsWith("http")) return photo.dataUrl;
  if (photo.fileUrl?.startsWith("http")) return photo.fileUrl;
  if (photo.dataUrl?.startsWith("/api/google-drive/")) return photo.dataUrl;
  if (photo.fileUrl?.startsWith("/api/google-drive/")) return photo.fileUrl;
  if (photo.dataUrl?.startsWith("data:")) return photo.dataUrl;
  return photo.dataUrl || photo.fileUrl || "";
}

/** 로컬/원격 공통 — base64 제거, http URL만 유지 (localStorage 한도 회피) */
export function slimAlbumDaysForRemote(days: Chapter3AlbumDay[]): Chapter3AlbumDay[] {
  return days.map((day) => ({
    ...day,
    places: day.places.map((place) => ({
      ...place,
      photos: place.photos.map((photo) => {
        const fileUrl = photo.driveFileId
          ? drivePhotoProxyUrl(photo.driveFileId)
          : photo.fileUrl || (photo.dataUrl?.startsWith("http") ? photo.dataUrl : undefined);
        return {
          ...photo,
          dataUrl: fileUrl || "",
          fileUrl,
          storagePath: photo.driveFileId ? undefined : photo.storagePath,
        };
      }),
    })),
  }));
}

/** 로컬 저장 — 업로드된 http URL은 유지, 미업로드 data URL도 임시 보존(새로고침 소실 방지) */
export function slimAlbumDaysForLocal(days: Chapter3AlbumDay[]): Chapter3AlbumDay[] {
  return days.map((day) => ({
    ...day,
    places: day.places.map((place) => ({
      ...place,
      photos: place.photos.map((photo) => {
        if (photo.driveFileId) {
          const fileUrl = drivePhotoProxyUrl(photo.driveFileId);
          return {
            ...photo,
            dataUrl: fileUrl,
            fileUrl,
            storagePath: undefined,
          };
        }
        const fileUrl =
          photo.fileUrl || (photo.dataUrl?.startsWith("http") ? photo.dataUrl : undefined);
        if (fileUrl) {
          return {
            ...photo,
            dataUrl: fileUrl,
            fileUrl,
          };
        }
        // Storage 업로드 전 — data URL을 비우지 않음
        return photo;
      }),
    })),
  }));
}

/** 로드 후 표시용 — fileUrl을 dataUrl 자리에 채움 */
export function hydrateAlbumDaysFromRemote(days: Chapter3AlbumDay[]): Chapter3AlbumDay[] {
  return days.map((day) => ({
    ...day,
    places: day.places.map((place) => ({
      ...place,
      photos: place.photos.map((photo) => {
        const url = photoDisplayUrl(photo);
        return {
          ...photo,
          dataUrl: url,
          fileUrl: photo.fileUrl || (url.startsWith("http") ? url : photo.fileUrl),
        };
      }),
    })),
  }));
}

/** 단일 사진을 Storage에 업로드 (추가 직후 호출) */
export async function uploadAlbumPhotoToStorage(
  photo: Chapter3AlbumPhoto,
): Promise<Chapter3AlbumPhoto> {
  if (photo.fileUrl?.startsWith("http")) {
    return { ...photo, dataUrl: photo.fileUrl, fileUrl: photo.fileUrl };
  }
  if (photo.dataUrl?.startsWith("http")) {
    return { ...photo, fileUrl: photo.dataUrl, dataUrl: photo.dataUrl };
  }
  if (!isSupabaseConfigured || !photo.dataUrl?.startsWith("data:")) {
    return photo;
  }

  const file = dataUrlToFile(photo.dataUrl, photo.fileName || `${photo.id}.jpg`);
  if (!file) return photo;

  try {
    if (storageNeedsArchive()) {
      const jpeg = await fileToViewJpegFile(file);
      const uploaded = await uploadCompressedJpegToDrive(jpeg, "sync", photo.id);
      return {
        ...photo,
        dataUrl: uploaded.fileUrl,
        fileUrl: uploaded.fileUrl,
        driveFileId: uploaded.fileId,
        storagePath: undefined,
        archived: true,
      };
    }
    const uploaded = await uploadFileToSupabaseStorage(file);
    return {
      ...photo,
      dataUrl: uploaded.fileUrl,
      fileUrl: uploaded.fileUrl,
      storagePath: uploaded.storagePath,
      archived: photo.archived,
    };
  } catch (error) {
    console.error("album photo storage upload failed", error);
    return photo;
  }
}

/** dataUrl 사진을 Storage에 올려 fileUrl을 채운 뒤 슬림화 */
export async function prepareAlbumDaysForSync(
  days: Chapter3AlbumDay[],
): Promise<Chapter3AlbumDay[]> {
  if (!isSupabaseConfigured) {
    return slimAlbumDaysForRemote(days);
  }

  const nextDays: Chapter3AlbumDay[] = [];

  for (const day of days) {
    const nextPlaces = [];
    for (const place of day.places) {
      const nextPhotos: Chapter3AlbumPhoto[] = [];
      for (const photo of place.photos) {
        nextPhotos.push(await uploadAlbumPhotoToStorage(photo));
      }
      nextPlaces.push({ ...place, photos: nextPhotos });
    }
    nextDays.push({ ...day, places: nextPlaces });
  }

  return slimAlbumDaysForRemote(nextDays);
}
