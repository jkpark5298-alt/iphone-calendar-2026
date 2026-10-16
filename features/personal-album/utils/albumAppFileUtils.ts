import { slimAlbumDaysForRemote } from "./chapter3AlbumSyncUtils";
import {
  createFreshAlbumPlanId,
  type SavedTravelAlbum,
} from "./chapter3SavedAlbumUtils";

export const TRAVEL_ALBUM_APP_FILE_TYPE = "travel-diary-album";

type AlbumAppFile = {
  type: typeof TRAVEL_ALBUM_APP_FILE_TYPE;
  version: 1;
  exportedAt: string;
  album: SavedTravelAlbum;
};

function safeFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${base || "여행앨범"}.traveldiary.json`;
}

export function serializeAlbumAppFile(album: SavedTravelAlbum): string {
  const file: AlbumAppFile = {
    type: TRAVEL_ALBUM_APP_FILE_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    album: {
      ...album,
      deletedAt: undefined,
      days: slimAlbumDaysForRemote(album.days),
    },
  };
  return JSON.stringify(file);
}

export function parseAlbumAppFile(text: string): SavedTravelAlbum {
  const parsed = JSON.parse(text) as Partial<AlbumAppFile>;
  const album = parsed?.album;
  if (
    parsed?.type !== TRAVEL_ALBUM_APP_FILE_TYPE ||
    parsed.version !== 1 ||
    !album ||
    typeof album.title !== "string" ||
    !Array.isArray(album.days)
  ) {
    throw new Error("여행 앨범 앱파일이 아닙니다.");
  }
  return {
    ...album,
    title: album.title.trim() || "여행 앨범",
    days: album.days,
    status: album.status === "draft" ? "draft" : "saved",
    deletedAt: undefined,
  };
}

/** 불러온 파일은 새 앨범으로 넣어 기존 확정본·삭제 기록과 겹치지 않게 한다. */
export function prepareImportedAlbum(album: SavedTravelAlbum): SavedTravelAlbum {
  const now = new Date().toISOString();
  const id = `album-file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    ...album,
    id,
    status: "saved",
    // fresh- 접두사로 제목이 같아도 기존 앨범과 합쳐지지 않게 한다.
    sourcePlanId: createFreshAlbumPlanId(),
    sourceLabel: album.sourceLabel || "앱파일",
    originAlbumId: undefined,
    deletedAt: undefined,
    savedAt: now,
    createdAt: album.createdAt || now,
    updatedAt: now,
    days: slimAlbumDaysForRemote(album.days || []),
  };
}

function isMobileSharePreferred(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios || /Android/i.test(ua);
}

function downloadAlbumFile(file: File): "downloaded" {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}

/**
 * 파일 전달. PC는 항상 다운로드(다운로드 폴더).
 * 모바일만 공유 시트를 쓰고, 취소(Abort) 시 다운로드로 넘긴다.
 */
export async function deliverAlbumFile(
  file: File,
  options?: { forceDownload?: boolean },
): Promise<"shared" | "downloaded"> {
  const forceDownload = options?.forceDownload === true || !isMobileSharePreferred();
  if (forceDownload) {
    return downloadAlbumFile(file);
  }

  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share === "function") {
    const data: ShareData = { files: [file], title: file.name };
    const canShare = typeof nav.canShare !== "function" || nav.canShare(data);
    if (canShare) {
      try {
        await nav.share(data);
        return "shared";
      } catch (error) {
        // 공유 취소 시에도 파일이 남도록 다운로드로 이어간다.
        if ((error as Error)?.name !== "AbortError") {
          console.warn("album file share failed, falling back to download", error);
        }
      }
    }
  }

  return downloadAlbumFile(file);
}

export async function saveAlbumAppFile(album: SavedTravelAlbum): Promise<"shared" | "downloaded"> {
  const json = serializeAlbumAppFile(album);
  const fileName = safeFileName(album.title);
  const file = new File([json], fileName, { type: "application/json" });
  return deliverAlbumFile(file);
}
