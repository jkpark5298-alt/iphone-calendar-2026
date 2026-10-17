import { getSupabase, isSupabaseConfigured, TRAVEL_DIARY_BUCKET } from "../../../lib/supabaseClient";
import { fileToViewJpegFile } from "./albumPhotoPackUtils";
import {
  albumHasIncompleteDriveMove,
  applyCompressedPhotos,
  countOriginalPhotos,
  eachAlbumPhoto,
  jpegBytesOpenable,
  migrateSourcePath,
  pathsSafeToRemove,
  photoStoragePath,
  pickNextAlbumToMigrate,
  shouldKeepMigrating,
  shouldStartStorageMigration,
  storageQuotaBytes,
  storageUsagePercent,
  ARCHIVE_JPEG_MAX_BYTES,
  type CompressedPhotoReplacement,
} from "./albumArchivePlan";
import type { SavedTravelAlbum } from "./chapter3SavedAlbumUtils";
import { archiveMigrationSkipAlbumId, noteStorageUsageRatio } from "./albumArchivePressure";
import { uploadCompressedJpegToDrive } from "./googleDriveClient";
import { removeTravelDiaryStoragePaths } from "./supabaseUtils";

const PENDING_DB = "iphone-calendar-personal-album-archive-v1";
const PENDING_STORE = "photos";
const PENDING_DELETE_KEY = "iphone-calendar-personal-album-archive-pending-deletes";

type PendingPhoto = {
  key: string;
  albumId: string;
  photoId: string;
  bytes: ArrayBuffer;
};

export type AlbumMigrationResult = {
  changed: boolean;
  albums: SavedTravelAlbum[];
  migratedTitles: string[];
};

let migrationInFlight: Promise<AlbumMigrationResult> | null = null;

function pendingKey(albumId: string, photoId: string): string {
  return `${albumId}\t${photoId}`;
}

function openPendingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PENDING_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openPendingDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, mode);
      const request = run(tx.objectStore(PENDING_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function savePendingPhoto(albumId: string, photoId: string, bytes: ArrayBuffer): Promise<void> {
  const record: PendingPhoto = { key: pendingKey(albumId, photoId), albumId, photoId, bytes };
  await withStore("readwrite", (store) => store.put(record));
}

async function readPendingPhoto(albumId: string, photoId: string): Promise<ArrayBuffer | null> {
  const record = await withStore<PendingPhoto | undefined>("readonly", (store) =>
    store.get(pendingKey(albumId, photoId)),
  );
  return record?.bytes ?? null;
}

async function clearPendingPhotos(albumId: string, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  const keys = new Set(photoIds.map((photoId) => pendingKey(albumId, photoId)));
  const db = await openPendingDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, "readwrite");
      const store = tx.objectStore(PENDING_STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      for (const key of keys) store.delete(key);
    });
  } finally {
    db.close();
  }
}

function readPendingDeletes(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_DELETE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writePendingDeletes(paths: string[]): void {
  if (typeof localStorage === "undefined") return;
  const unique = [...new Set(paths)];
  if (unique.length === 0) localStorage.removeItem(PENDING_DELETE_KEY);
  else localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(unique));
}

async function measureStorageBytes(): Promise<number> {
  const supabase = getSupabase();
  const walk = async (prefix: string, depth: number): Promise<number> => {
    if (depth > 6) return 0;
    let total = 0;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage.from(TRAVEL_DIARY_BUCKET).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      const items = data || [];
      for (const item of items) {
        if (!item.name || item.name.startsWith(".")) continue;
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        const size = item.metadata?.size;
        if (item.id && typeof size === "number") total += size;
        else if (!item.id) total += await walk(path, depth + 1);
      }
      if (items.length < 1000) break;
      offset += items.length;
    }
    return total;
  };
  return walk("", 0);
}

async function compressPhotoBytes(url: string, fileName: string | undefined): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`사진을 받지 못했습니다 (${response.status})`);
  const blob = await response.blob();
  const source = new File([blob], fileName || "photo.jpg", { type: blob.type || "image/jpeg" });
  const jpeg = await fileToViewJpegFile(source);
  if (jpeg.size <= 0 || jpeg.size > ARCHIVE_JPEG_MAX_BYTES) {
    throw new Error("압축 사진이 저장 한도를 넘습니다.");
  }
  const bytes = await jpeg.arrayBuffer();
  if (!jpegBytesOpenable(new Uint8Array(bytes))) throw new Error("압축 사진을 열 수 없습니다.");
  const decoded = await createImageBitmap(jpeg);
  decoded.close();
  return bytes;
}

async function uploadVerifiedJpeg(
  albumId: string,
  photoId: string,
  bytes: ArrayBuffer,
): Promise<CompressedPhotoReplacement> {
  const file = new File([bytes], `${photoId}.jpg`, { type: "image/jpeg" });
  const uploaded = await uploadCompressedJpegToDrive(file, albumId, photoId);
  const remote = await fetch(uploaded.fileUrl);
  if (!remote.ok) throw new Error("압축 파일을 다시 열지 못했습니다.");
  const remoteBytes = new Uint8Array(await remote.arrayBuffer());
  if (remoteBytes.length !== bytes.byteLength || !jpegBytesOpenable(remoteBytes)) {
    throw new Error("압축 파일이 Drive에서 열리지 않습니다.");
  }
  return {
    photoId,
    fileUrl: uploaded.fileUrl,
    driveFileId: uploaded.fileId,
    bytes: remoteBytes.length,
  };
}

async function retryPendingDeletes(albums: SavedTravelAlbum[]): Promise<void> {
  const pending = readPendingDeletes();
  if (pending.length === 0) return;
  const referenced = new Set<string>();
  for (const album of albums) {
    for (const photo of eachAlbumPhoto(album)) {
      const path = photoStoragePath(photo);
      if (path) referenced.add(path);
    }
  }
  const ready = pending.filter((path) => !referenced.has(path));
  if (ready.length === 0) return;
  const removed = await removeTravelDiaryStoragePaths(ready);
  if (removed) writePendingDeletes(pending.filter((path) => !ready.includes(path)));
}

async function migrateAlbum(
  album: SavedTravelAlbum,
  albums: SavedTravelAlbum[],
  quota: number,
  onStatus: (message: string) => void,
  isCancelled: () => boolean,
): Promise<{
  album: SavedTravelAlbum;
  changed: boolean;
  pathsToDelete: string[];
  clearPhotoIds: string[];
}> {
  const unchanged = { album, changed: false, pathsToDelete: [] as string[], clearPhotoIds: [] as string[] };
  const targets = eachAlbumPhoto(album)
    .map((photo) => ({ photo, oldPath: migrateSourcePath(photo) }))
    .filter((item): item is { photo: typeof item.photo; oldPath: string } => Boolean(item.oldPath));
  if (targets.length === 0) return unchanged;

  const ready: { photoId: string; oldPath: string; size: number }[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    if (isCancelled()) return unchanged;
    const target = targets[index];
    onStatus(`저장 공간을 줄이는 중 — 「${album.title}」 압축 ${index + 1}/${targets.length}`);
    try {
      let stored = await readPendingPhoto(album.id, target.photo.id);
      const pendingView = stored ? new Uint8Array(stored) : null;
      const pendingOk = Boolean(
        pendingView && jpegBytesOpenable(pendingView) && pendingView.byteLength <= ARCHIVE_JPEG_MAX_BYTES,
      );
      if (!pendingOk) {
        stored = await compressPhotoBytes(target.photo.fileUrl || target.photo.dataUrl, target.photo.fileName);
        await savePendingPhoto(album.id, target.photo.id, stored);
      }
      if (!stored) continue;
      ready.push({ photoId: target.photo.id, oldPath: target.oldPath, size: stored.byteLength });
    } catch (error) {
      console.error("album archive compress skipped", album.id, target.photo.id, error);
    }
  }
  if (ready.length === 0) return unchanged;

  const archiveBytes = ready.reduce((sum, item) => sum + item.size, 0);
  const used = await measureStorageBytes();
  noteStorageUsageRatio(used, quota);
  const overQuota = quota - used < archiveBytes + 1024 * 1024;

  const uploadReady = async (
    items: { photoId: string; oldPath: string; size: number }[],
    label: string,
  ): Promise<{ done: CompressedPhotoReplacement[]; failed: typeof items }> => {
    const done: CompressedPhotoReplacement[] = [];
    const failed: typeof items = [];
    for (let index = 0; index < items.length; index += 1) {
      if (isCancelled()) break;
      const item = items[index];
      onStatus(`저장 공간을 줄이는 중 — 「${album.title}」 ${label} ${index + 1}/${items.length}`);
      const stored = await readPendingPhoto(album.id, item.photoId);
      if (!stored) {
        failed.push(item);
        continue;
      }
      try {
        done.push(await uploadVerifiedJpeg(album.id, item.photoId, stored));
      } catch (error) {
        console.error("album archive upload failed", album.id, item.photoId, error);
        failed.push(item);
      }
    }
    return { done, failed };
  };

  // 유예 기간에는 압축본을 먼저 올린다. 한도 때문에 거절되면, 확인된 사진의 원본만 지우고 다시 올린다.
  let uploaded = await uploadReady(ready, "올리는 중");
  const deletedPhotoIds = new Set<string>();
  if (uploaded.failed.length > 0 && overQuota) {
    const failedIds = new Set(uploaded.failed.map((item) => item.photoId));
    const removable = pathsSafeToRemove(
      uploaded.failed.map((item) => item.oldPath),
      albums,
      album.id,
      failedIds,
    );
    if (removable.length > 0) {
      const removed = await removeTravelDiaryStoragePaths(removable);
      if (removed) {
        for (const item of uploaded.failed) {
          if (removable.includes(item.oldPath)) deletedPhotoIds.add(item.photoId);
        }
        writePendingDeletes([...readPendingDeletes(), ...removable]);
        const retried = await uploadReady(
          uploaded.failed.filter((item) => deletedPhotoIds.has(item.photoId)),
          "다시 올리는 중",
        );
        uploaded = { done: [...uploaded.done, ...retried.done], failed: retried.failed };
      }
    }
  }
  const replacements = uploaded.done;
  if (replacements.length === 0) return unchanged;

  const updatedAt = new Date().toISOString();
  const next = applyCompressedPhotos(album, replacements, updatedAt);
  const uploadedIds = new Set(replacements.map((item) => item.photoId));
  const pathsToDelete = pathsSafeToRemove(
    ready
      .filter((item) => uploadedIds.has(item.photoId) && !deletedPhotoIds.has(item.photoId))
      .map((item) => item.oldPath),
    albums.map((item) => (item.id === album.id ? next : item)),
    album.id,
    uploadedIds,
  );
  return {
    album: next,
    changed: true,
    pathsToDelete,
    clearPhotoIds: replacements.map((item) => item.photoId),
  };
}

/** false를 돌려주면 이번 앨범 결과를 버리고 멈춘다 (원본 삭제도 하지 않음). */
export type AlbumReadyHandler = (
  albums: SavedTravelAlbum[],
  migrated: { before: SavedTravelAlbum; after: SavedTravelAlbum },
) => Promise<boolean>;

export async function runAlbumStorageMigration(
  albums: SavedTravelAlbum[],
  options: {
    deletedAlbums?: SavedTravelAlbum[];
    onStatus?: (message: string) => void;
    onAlbumReady?: AlbumReadyHandler;
    /** 마이그레이션 도중 바뀐 최신 목록 — 시작 시점 사본으로 다른 앨범을 덮지 않게 */
    getAlbums?: () => SavedTravelAlbum[];
    isCancelled?: () => boolean;
  } = {},
): Promise<AlbumMigrationResult> {
  if (migrationInFlight) return migrationInFlight;
  migrationInFlight = runAlbumStorageMigrationInner(albums, options).finally(() => {
    migrationInFlight = null;
  });
  return migrationInFlight;
}

async function runAlbumStorageMigrationInner(
  albums: SavedTravelAlbum[],
  options: {
    deletedAlbums?: SavedTravelAlbum[];
    onStatus?: (message: string) => void;
    onAlbumReady?: AlbumReadyHandler;
    getAlbums?: () => SavedTravelAlbum[];
    isCancelled?: () => boolean;
  },
): Promise<AlbumMigrationResult> {
  const unchanged = { changed: false, albums, migratedTitles: [] as string[] };
  if (!isSupabaseConfigured || typeof indexedDB === "undefined") return unchanged;
  const onStatus = options.onStatus || (() => {});
  const isCancelled = options.isCancelled || (() => false);
  const quota = storageQuotaBytes();

  try {
    const guarded = [...albums, ...(options.deletedAlbums || [])];
    await retryPendingDeletes(guarded);
    let used = await measureStorageBytes();
    noteStorageUsageRatio(used, quota);
    const pendingDeletes = readPendingDeletes().length > 0;
    // 예전: 확정 앨범에 원본만 있어도 무조건 Drive 이전 → 용량 여유여도 돌아감
    // 지금: 80% 이상일 때만 시작. 이미 일부만 옮긴 앨범은 이어서 마무리
    const needsResumeIncomplete = albums.some(albumHasIncompleteDriveMove);
    const overMigrateThreshold = shouldStartStorageMigration(used, quota);
    if (!overMigrateThreshold && !pendingDeletes && !needsResumeIncomplete) {
      return unchanged;
    }

    const driveStatus = await fetch("/api/google-drive/status")
      .then((response) => response.json() as Promise<{ connected?: boolean }>)
      .catch(() => ({ connected: false }));
    if (!driveStatus.connected) {
      onStatus("무료 저장 공간이 한도를 넘었습니다. Google Drive를 연결하면 압축본을 그쪽으로 옮깁니다.");
      return unchanged;
    }

    let current = albums.slice();
    const migratedTitles: string[] = [];
    let started = false;
    while (
      !isCancelled() &&
      (started
        ? shouldKeepMigrating(used, quota) ||
          current.some(albumHasIncompleteDriveMove) ||
          (overMigrateThreshold &&
            current.some(
              (album) => album.status === "saved" && !album.deletedAt && countOriginalPhotos(album) > 0,
            ))
        : overMigrateThreshold || needsResumeIncomplete)
    ) {
      if (options.getAlbums) current = options.getAlbums().slice();
      const nextAlbum = pickNextAlbumToMigrate(current, archiveMigrationSkipAlbumId());
      if (!nextAlbum || countOriginalPhotos(nextAlbum) === 0) break;
      onStatus(
        `무료 저장 공간 ${storageUsagePercent(used, quota)}% — 「${nextAlbum.title}」 사진을 압축본으로 옮기는 중`,
      );
      const guardedNow = [...current, ...(options.deletedAlbums || [])];
      const result = await migrateAlbum(nextAlbum, guardedNow, quota, onStatus, isCancelled);
      if (!result.changed) break;
      const nextList = current.map((album) => (album.id === result.album.id ? result.album : album));
      const saved = options.onAlbumReady
        ? await options.onAlbumReady(nextList, { before: nextAlbum, after: result.album })
        : true;
      if (!saved) break;
      if (result.pathsToDelete.length > 0) {
        const removed = await removeTravelDiaryStoragePaths(result.pathsToDelete);
        if (!removed) writePendingDeletes([...readPendingDeletes(), ...result.pathsToDelete]);
      }
      await clearPendingPhotos(result.album.id, result.clearPhotoIds);
      current = options.getAlbums ? options.getAlbums().slice() : nextList;
      await retryPendingDeletes([...current, ...(options.deletedAlbums || [])]);
      migratedTitles.push(result.album.title);
      started = true;
      used = await measureStorageBytes();
      noteStorageUsageRatio(used, quota);
    }
    if (migratedTitles.length === 0) return { ...unchanged, albums: current };
    return { changed: true, albums: current, migratedTitles };
  } catch (error) {
    console.error("album storage migration failed", error);
    return unchanged;
  }
}
