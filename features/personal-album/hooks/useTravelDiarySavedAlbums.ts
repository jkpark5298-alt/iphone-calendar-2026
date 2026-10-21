"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chapter3AlbumDay } from "../utils/chapter3Utils";
import {
  albumIsHiddenByTombstone,
  albumsAreSameFamily,
  capDeletedAlbums,
  clearSavedAlbumsStorage,
  countAlbumPhotos,
  createFreshAlbumPlanId,
  createSavedAlbumId,
  findDraftForOrigin,
  readSavedAlbumsRoot,
  repairAndDedupeAlbums,
  searchSavedAlbums,
  writeSavedAlbumsRoot,
  type AlbumKind,
  type SavedTravelAlbum,
  type SavedTravelAlbumStatus,
} from "../utils/chapter3SavedAlbumUtils";
import { parseManualTripIdFromPlanId } from "../utils/chapter3Utils";
import { listChapter3AlbumPlanEntries } from "../utils/chapter3Storage";
import {
  applyTravelAlbumsStateToLocalStorage,
  loadTravelAlbumsFromSupabase,
  probeTravelAlbumsUpdatedAt,
  mergeTravelAlbumsStates,
  readTravelAlbumsStateFromLocalStorage,
  saveTravelAlbumsToSupabase,
  type TravelAlbumsState,
} from "../utils/travelAlbumsSupabaseUtils";
import { dispatchChapter3CloudSync } from "../utils/chapter3CloudSyncUtils";
import { photoIsArchived, storageQuotaBytes } from "../utils/albumArchivePlan";
import { measureStorageBytes, runAlbumStorageMigration } from "../utils/albumArchiveMigration";
import {
  formatStorageUsageLabel,
  noteStorageUsageRatio,
} from "../utils/albumArchivePressure";
import { isSupabaseConfigured } from "../../../lib/supabaseClient";

function recoverOrphanedPlanAlbums(
  albums: SavedTravelAlbum[],
  deleted: SavedTravelAlbum[] = [],
): SavedTravelAlbum[] {
  if (typeof window === "undefined") return albums;
  const next = [...albums];
  const deletedIds = new Set(deleted.map((album) => album.id));
  const deletedPlanIds = new Set(
    deleted.map((album) => album.sourcePlanId?.trim()).filter(Boolean) as string[],
  );

  for (const entry of listChapter3AlbumPlanEntries()) {
    if (countAlbumPhotos(entry.days) === 0) continue;
    if (deletedPlanIds.has(entry.planId)) continue;
    const already = next.some(
      (album) => album.sourcePlanId === entry.planId || album.id === entry.planId,
    );
    if (already) continue;
    // 삭제 목록에 같은 계획/계열이 있으면 복구하지 않음
    const blocked = deleted.some(
      (album) =>
        album.sourcePlanId === entry.planId ||
        album.id === entry.planId ||
        deletedIds.has(album.id),
    );
    if (blocked) continue;

    const now = entry.updatedAt || new Date().toISOString();
    next.push({
      id: createSavedAlbumId(),
      title: "여행 앨범",
      status: "saved",
      sourcePlanId: entry.planId,
      days: entry.days,
      createdAt: now,
      updatedAt: now,
      savedAt: now,
    });
  }
  return next;
}

export function useTravelDiarySavedAlbums(showPasteHint: (msg: string) => void) {
  const [albums, setAlbums] = useState<SavedTravelAlbum[]>([]);
  const [deletedAlbums, setDeletedAlbums] = useState<SavedTravelAlbum[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState("PC·아이폰 앨범 동기화 준비 중");
  const [storageStatus, setStorageStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const hydratedRef = useRef(false);
  const albumsRef = useRef<SavedTravelAlbum[]>([]);
  const deletedAlbumsRef = useRef<SavedTravelAlbum[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCloudSaveRef = useRef<TravelAlbumsState | null>(null);
  const flushCloudSaveRef = useRef<() => void>(() => {});
  const persistRef = useRef<
    (
      next: SavedTravelAlbum[],
      options?: { deleted?: SavedTravelAlbum[]; updatedAt?: string },
    ) => void
  >(() => {});
  const showPasteHintRef = useRef(showPasteHint);
  const refreshingRef = useRef(false);
  const lastRemoteUpdatedAtRef = useRef("");
  /** 서버에서 마지막으로 받은 수정 시각 (바뀌지 않았으면 전체를 다시 받지 않는다) */
  const lastServerUpdatedAtRef = useRef("");

  const applyAlbumLists = useCallback(
    (nextAlbums: SavedTravelAlbum[], nextDeleted: SavedTravelAlbum[]) => {
      const withoutDeleted = nextAlbums.filter(
        (album) => !albumIsHiddenByTombstone(album, nextDeleted),
      );
      const repaired = repairAndDedupeAlbums(withoutDeleted);
      const deleted = capDeletedAlbums(
        nextDeleted.filter((album) => !repaired.some((item) => item.id === album.id)),
      );
      albumsRef.current = repaired;
      deletedAlbumsRef.current = deleted;
      setAlbums(repaired);
      setDeletedAlbums(deleted.filter((album) => album.deletedReason !== "confirmed"));
      return { albums: repaired, deletedAlbums: deleted };
    },
    [],
  );

  const applyMergedState = useCallback(
    (
      merged: TravelAlbumsState,
      syncMessage: string,
      options?: { pushRemote?: boolean },
    ) => {
      const recovered = recoverOrphanedPlanAlbums(
        merged.albums,
        merged.deletedAlbums || [],
      );
      const lists = applyAlbumLists(recovered, merged.deletedAlbums || []);
      applyTravelAlbumsStateToLocalStorage({
        albums: lists.albums,
        deletedAlbums: lists.deletedAlbums,
        manualTrips: merged.manualTrips,
        updatedAt: merged.updatedAt,
      });
      if (merged.manualTrips) {
        dispatchChapter3CloudSync({ manualTrips: merged.manualTrips });
      }
      lastRemoteUpdatedAtRef.current = merged.updatedAt;
      setSyncStatus(syncMessage.replace("{count}", String(lists.albums.length)));

      if (options?.pushRemote) {
        void saveTravelAlbumsToSupabase({
          albums: lists.albums,
          deletedAlbums: lists.deletedAlbums,
          manualTrips: merged.manualTrips,
          updatedAt: merged.updatedAt,
        }).then((ok) => {
          setSyncStatus(
            ok
              ? `PC·아이폰 Supabase 동기화 완료 (${lists.albums.length}건)`
              : "PC·아이폰 Supabase 업로드 실패",
          );
        });
      }
    },
    [applyAlbumLists],
  );

  const refreshFromSupabase = useCallback(async () => {
    if (!hydratedRef.current || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      // 서버 수정 시각이 그대로면 전체(수백 KB)를 받지 않는다.
      if (lastServerUpdatedAtRef.current) {
        const serverUpdatedAt = await probeTravelAlbumsUpdatedAt();
        if (serverUpdatedAt && serverUpdatedAt === lastServerUpdatedAtRef.current) return;
      }
      const remoteState = await loadTravelAlbumsFromSupabase();
      if (!remoteState) return;
      lastServerUpdatedAtRef.current = remoteState.updatedAt || "";

      const localState = readTravelAlbumsStateFromLocalStorage();
      const merged = mergeTravelAlbumsStates(localState, remoteState);
      if (!merged) return;

      const remoteTime = Date.parse(remoteState.updatedAt || "");
      const lastSeen = Date.parse(lastRemoteUpdatedAtRef.current || "");
      const albumsChanged =
        JSON.stringify(repairAndDedupeAlbums(merged.albums)) !==
        JSON.stringify(albumsRef.current);

      if (remoteTime > lastSeen || albumsChanged) {
        applyMergedState(merged, `PC·아이폰 Supabase 동기화 완료 ({count}건)`);
      }
    } finally {
      refreshingRef.current = false;
    }
  }, [applyMergedState]);

  const persist = useCallback(
    (
      next: SavedTravelAlbum[],
      options?: { deleted?: SavedTravelAlbum[]; updatedAt?: string },
    ) => {
      const nextDeleted = options?.deleted ?? deletedAlbumsRef.current;
      const updatedAt = options?.updatedAt || new Date().toISOString();
      const lists = applyAlbumLists(next, nextDeleted);
      const ok = writeSavedAlbumsRoot({
        version: 1,
        albums: lists.albums,
        deletedAlbums: lists.deletedAlbums,
        updatedAt,
      });
      if (!ok) {
        showPasteHint("⚠️ 앨범 저장 공간이 부족합니다. 일부 사진을 줄여 주세요.");
      }

      if (!hydratedRef.current) return;
      pendingCloudSaveRef.current = {
        albums: lists.albums,
        deletedAlbums: lists.deletedAlbums,
        updatedAt,
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        flushCloudSaveRef.current();
      }, 800);
    },
    [applyAlbumLists, showPasteHint],
  );

  const flushCloudSave = useCallback(() => {
    const pending = pendingCloudSaveRef.current;
    if (!pending) return;
    pendingCloudSaveRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSyncStatus("PC·아이폰 Supabase 저장 중");
    void saveTravelAlbumsToSupabase(pending).then((okSync) => {
      if (okSync) {
        // 저장 중에 목록이 또 바뀌었으면 예전 저장본으로 화면을 되돌리지 않는다
        if (albumsRef.current === pending.albums) {
          const root = readSavedAlbumsRoot();
          applyAlbumLists(root.albums, root.deletedAlbums || []);
        }
        setSyncStatus(`PC·아이폰 Supabase 저장 완료 (${albumsRef.current.length}건)`);
      } else {
        setSyncStatus("PC·아이폰 Supabase 저장 실패 — 사진 용량/네트워크를 확인해 주세요");
        showPasteHint("⚠️ 앨범 클라우드 동기화에 실패했습니다. 다시 저장해 주세요.");
      }
    });
  }, [applyAlbumLists, showPasteHint]);

  flushCloudSaveRef.current = flushCloudSave;
  persistRef.current = persist;
  showPasteHintRef.current = showPasteHint;

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      // 원격 응답 전에 로컬을 먼저 그려 「앨범이 사라졌다 나왔다」 깜빡임을 막음
      const localState = readTravelAlbumsStateFromLocalStorage();
      if (localState) {
        const localRecovered = recoverOrphanedPlanAlbums(
          localState.albums,
          localState.deletedAlbums || [],
        );
        applyAlbumLists(localRecovered, localState.deletedAlbums || []);
        lastRemoteUpdatedAtRef.current = localState.updatedAt || "";
        setSyncStatus(
          `로컬 앨범 표시 중 (${repairAndDedupeAlbums(localRecovered).length}건) · 동기화…`,
        );
      } else {
        setSyncStatus("PC·아이폰 Supabase 불러오는 중");
      }

      const remoteState = await loadTravelAlbumsFromSupabase();
      if (cancelled) return;
      lastServerUpdatedAtRef.current = remoteState?.updatedAt || "";

      const merged = mergeTravelAlbumsStates(localState, remoteState);
      if (merged) {
        const recovered = recoverOrphanedPlanAlbums(
          merged.albums,
          merged.deletedAlbums || [],
        );
        const albumsDeduped = repairAndDedupeAlbums(recovered);
        const localAlbumCount = localState?.albums.length || 0;
        const remoteAlbumCount = remoteState?.albums.length || 0;
        const hadLocalOnly =
          localAlbumCount > 0 &&
          Boolean(
            localState &&
              (!remoteState ||
                (localState.updatedAt || "") > (remoteState.updatedAt || "")),
          );
        const hadDuplicates = albumsDeduped.length < merged.albums.length;
        const beforeStatusKey = merged.albums
          .map((a) => `${a.id}:${a.status}`)
          .sort()
          .join("|");
        const afterStatusKey = albumsDeduped
          .map((a) => `${a.id}:${a.status}`)
          .sort()
          .join("|");
        const statusRepaired = beforeStatusKey !== afterStatusKey;
        // 빈 로컬·빈 병합 결과를 클라우드에 올리지 않음 (원격 앨범 삭제 사고 방지)
        const safeToPush =
          albumsDeduped.length > 0 || remoteAlbumCount === 0;
        // 클라우드가 비었는데 이 기기에 앨범이 있으면 복구 업로드 (빈 덮어쓰기 사고 복구)
        const needsCloudRestore =
          albumsDeduped.length > 0 && remoteAlbumCount === 0;

        applyMergedState(
          { ...merged, albums: albumsDeduped },
          remoteState
            ? `PC·아이폰 Supabase 동기화 완료 ({count}건)`
            : "PC·아이폰 Supabase 동기화 완료 (서버 자료 없음)",
          {
            pushRemote: Boolean(
              safeToPush &&
                (hadLocalOnly ||
                  needsCloudRestore ||
                  (localAlbumCount > 0 && !remoteState) ||
                  hadDuplicates ||
                  statusRepaired),
            ),
          },
        );
      } else {
        const root = readSavedAlbumsRoot();
        const recovered = recoverOrphanedPlanAlbums(root.albums, root.deletedAlbums || []);
        applyAlbumLists(recovered, root.deletedAlbums || []);
        setSyncStatus("여행 앨범 로컬 저장만 사용");
      }

      hydratedRef.current = true;
      setHydrated(true);
    };

    void hydrate();
    return () => {
      cancelled = true;
      // 언마운트 시에만 클라우드 flush (의존성 변경으로 재실행될 때 목록이 비지 않게)
      flushCloudSaveRef.current();
    };
    // mount 1회만: 콜백 identity 변경으로 hydrate가 재시작되면 목록이 깜빡임
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PC · 아이폰 간 주기적 동기화 (포커스 · 30초)
  useEffect(() => {
    if (!hydrated) return;

    const handleRefresh = () => {
      void refreshFromSupabase();
    };

    window.addEventListener("focus", handleRefresh);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushCloudSave();
        return;
      }
      handleRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshFromSupabase();
      }
    }, 30000);

    return () => {
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [hydrated, refreshFromSupabase, flushCloudSave]);

  const refreshStorageStatus = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setStorageStatus(null);
      return;
    }
    try {
      const used = await measureStorageBytes();
      const quota = storageQuotaBytes();
      noteStorageUsageRatio(used, quota);
      setStorageStatus(formatStorageUsageLabel(used, quota));
    } catch (error) {
      console.error("supabase storage usage failed", error);
      setStorageStatus(formatStorageUsageLabel() || "Supabase 저장 공간을 확인하지 못했습니다");
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      await refreshStorageStatus();
      if (cancelled) return;
      const result = await runAlbumStorageMigration(albumsRef.current, {
        deletedAlbums: deletedAlbumsRef.current,
        onStatus: (message) => {
          if (!cancelled) setSyncStatus(message);
        },
        isCancelled: () => cancelled,
        getAlbums: () => albumsRef.current,
        onAlbumReady: async (_nextAlbums, { before, after }) => {
          // 압축하는 동안 그 앨범이 수정·삭제됐으면 예전 사본으로 덮지 않는다
          const live = albumsRef.current.find((album) => album.id === after.id);
          if (!live || live.updatedAt !== before.updatedAt) return false;
          const updatedAt = new Date().toISOString();
          persistRef.current(
            albumsRef.current.map((album) => (album.id === after.id ? after : album)),
            { updatedAt },
          );
          return saveTravelAlbumsToSupabase({
            albums: albumsRef.current,
            deletedAlbums: deletedAlbumsRef.current,
            updatedAt,
          });
        },
      });
      if (cancelled) return;
      await refreshStorageStatus();
      if (cancelled || result.migratedTitles.length === 0) return;
      const titles = result.migratedTitles.map((title) => `「${title}」`).join(", ");
      showPasteHintRef.current(`저장 공간이 80%를 넘어 ${titles} 사진을 압축 파일로 옮겼습니다.`);
      setSyncStatus(`압축 파일로 옮김 ${titles}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, refreshStorageStatus]);

  const filteredAlbums = useMemo(
    () => searchSavedAlbums(albums, searchTerm),
    [albums, searchTerm],
  );

  const upsertAlbum = useCallback(
    (input: {
      id?: string;
      title: string;
      status: SavedTravelAlbumStatus;
      kind?: AlbumKind;
      sourcePlanId: string;
      sourceLabel?: string;
      days: Chapter3AlbumDay[];
      originAlbumId?: string;
    }): SavedTravelAlbum => {
      const now = new Date().toISOString();
      const prev = albumsRef.current;
      const originAlbumId = input.originAlbumId?.trim() || undefined;
      const byId = input.id ? prev.find((a) => a.id === input.id) : undefined;
      const kind: AlbumKind =
        input.kind === "travel"
          ? "travel"
          : input.kind === "personal"
            ? "personal"
            : byId?.kind === "travel"
              ? "travel"
              : "personal";
      const defaultTitle = kind === "personal" ? "개인앨범" : "여행 앨범";
      const sameKind = (album: SavedTravelAlbum) =>
        (album.kind === "travel" ? "travel" : "personal") === kind;

      let existing: SavedTravelAlbum | undefined;
      if (input.status === "draft") {
        const savedTarget =
          byId?.status === "saved" && sameKind(byId)
            ? byId
            : originAlbumId
              ? prev.find(
                  (a) => a.id === originAlbumId && a.status === "saved" && sameKind(a),
                )
              : undefined;
        const draftOriginId = savedTarget?.id || originAlbumId;
        const byOriginDraft = draftOriginId
          ? findDraftForOrigin(prev, draftOriginId)
          : undefined;
        const byPlanDraft =
          !byOriginDraft && input.sourcePlanId
            ? prev.find(
                (a) =>
                  a.status === "draft" &&
                  a.sourcePlanId === input.sourcePlanId &&
                  sameKind(a),
              )
            : undefined;
        existing =
          byId?.status === "draft" && sameKind(byId)
            ? byId
            : byOriginDraft && sameKind(byOriginDraft)
              ? byOriginDraft
              : byPlanDraft;
      } else {
        const byPlanSaved = input.sourcePlanId
          ? prev.find(
              (a) =>
                a.status === "saved" &&
                a.sourcePlanId === input.sourcePlanId &&
                sameKind(a),
            )
          : undefined;
        const manualTripId = parseManualTripIdFromPlanId(input.sourcePlanId || "");
        const byManualSaved =
          !byPlanSaved && manualTripId
            ? prev.find(
                (a) =>
                  a.status === "saved" &&
                  sameKind(a) &&
                  parseManualTripIdFromPlanId(a.sourcePlanId || "") === manualTripId,
              )
            : undefined;
        existing =
          byId?.status === "saved" && sameKind(byId)
            ? byId
            : byId && sameKind(byId)
              ? byId
              : byPlanSaved || byManualSaved;
      }

      const resolvedOrigin =
        input.status === "draft"
          ? originAlbumId ||
            (existing?.status === "draft" ? existing.originAlbumId : undefined) ||
            (byId?.status === "saved" && sameKind(byId) ? byId.id : undefined)
          : undefined;

      const nextAlbum: SavedTravelAlbum = {
        id: existing?.id || (byId?.status === input.status && sameKind(byId) ? byId.id : undefined) || createSavedAlbumId(),
        title: input.title.trim() || existing?.title || defaultTitle,
        status: input.status,
        kind,
        sourcePlanId: input.sourcePlanId || existing?.sourcePlanId || "",
        sourceLabel: input.sourceLabel ?? existing?.sourceLabel,
        days: input.days,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        savedAt:
          input.status === "saved" ? existing?.savedAt || now : existing?.savedAt,
        confirmedAt: input.status === "saved" ? now : undefined,
        originAlbumId: input.status === "draft" ? resolvedOrigin : undefined,
        photoArchive: (() => {
          const archivedCount = input.days.reduce(
            (sum, day) =>
              sum +
              day.places.reduce(
                (placeSum, place) =>
                  placeSum + place.photos.filter((photo) => photoIsArchived(photo) || photo.archived).length,
                0,
              ),
            0,
          );
          if (!existing?.photoArchive && archivedCount === 0) return undefined;
          return {
            version: 1 as const,
            updatedAt: now,
            photoCount: archivedCount || existing?.photoArchive?.photoCount || 0,
            compressedBytes: existing?.photoArchive?.compressedBytes || 0,
          };
        })(),
      };

      let next = existing
        ? prev.map((a) => (a.id === existing!.id ? nextAlbum : a))
        : [nextAlbum, ...prev];

      let nextDeleted: SavedTravelAlbum[] | undefined;
      if (input.status === "saved" && nextAlbum.id) {
        // 확정 시 같은 여행의 임시본은 모두 제거. 다른 기기 사본이 되살리지 않게 삭제 기록을 남긴다.
        const absorbed = next.filter(
          (a) => a.id !== nextAlbum.id && a.status === "draft" && albumsAreSameFamily(a, nextAlbum),
        );
        if (absorbed.length > 0) {
          const absorbedIds = new Set(absorbed.map((a) => a.id));
          next = next.filter((a) => !absorbedIds.has(a.id));
          nextDeleted = capDeletedAlbums([
            ...absorbed.map((album) => ({
              ...album,
              deletedAt: now,
              deletedReason: "confirmed" as const,
            })),
            ...deletedAlbumsRef.current.filter((a) => !absorbedIds.has(a.id)),
          ]);
        }
      }

      persist(next, nextDeleted ? { deleted: nextDeleted } : undefined);
      return nextAlbum;
    },
    [persist],
  );

  const updateAlbumMeta = useCallback(
    (id: string, patch: Partial<Pick<SavedTravelAlbum, "title" | "status" | "days">>) => {
      const now = new Date().toISOString();
      const next = albumsRef.current.map((a) =>
        a.id === id
          ? {
              ...a,
              ...patch,
              title: patch.title?.trim() || a.title,
              updatedAt: now,
            }
          : a,
      );
      persist(next);
    },
    [persist],
  );

  const updateAlbumPhotoMemo = useCallback(
    (albumId: string, photoId: string, memo: string) => {
      const album = albumsRef.current.find((item) => item.id === albumId);
      if (!album) return;
      let changed = false;
      const days = album.days.map((day) => ({
        ...day,
        places: day.places.map((place) => ({
          ...place,
          photos: place.photos.map((photo) => {
            if (photo.id !== photoId || (photo.memo || "") === memo) return photo;
            changed = true;
            return { ...photo, memo };
          }),
        })),
      }));
      if (!changed) return;
      updateAlbumMeta(albumId, { days });
    },
    [updateAlbumMeta],
  );

  const deleteAlbum = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      const target = albumsRef.current.find((a) => a.id === id);
      if (!target) {
        const next = albumsRef.current.filter((a) => a.id !== id);
        persist(next, { deleted: deletedAlbumsRef.current, updatedAt: now });
        return;
      }

      // 같은 여행(확정+임시) 계열을 함께 삭제해 재진입 시 되살아나지 않게 함
      const removed = albumsRef.current.filter(
        (a) => a.id === id || albumsAreSameFamily(a, target),
      );
      const removedIds = new Set(removed.map((a) => a.id));
      const next = albumsRef.current.filter((a) => !removedIds.has(a.id));
      const nextDeleted = capDeletedAlbums([
        ...removed.map((album) => ({ ...album, deletedAt: now })),
        ...deletedAlbumsRef.current.filter((a) => !removedIds.has(a.id)),
      ]);
      persist(next, { deleted: nextDeleted, updatedAt: now });
    },
    [persist],
  );

  const restoreAlbum = useCallback(
    (id: string) => {
      const target = deletedAlbumsRef.current.find((a) => a.id === id);
      if (!target) return null;
      const now = new Date().toISOString();
      const { deletedAt: _deletedAt, ...rest } = target;
      // 같은 제목·여행 계열이 이미 있으면 합쳐지지 않게 새 앨범으로 복원한다.
      const conflicts = albumsRef.current.some((album) => albumsAreSameFamily(album, target));
      const restored: SavedTravelAlbum = conflicts
        ? {
            ...rest,
            id: createSavedAlbumId(),
            title: `${target.title.replace(/\s*\(복원\)\s*$/, "").trim() || "여행 앨범"} (복원)`,
            sourcePlanId: createFreshAlbumPlanId(),
            sourceLabel: target.sourceLabel || "삭제 복원",
            originAlbumId: undefined,
            status: "saved",
            savedAt: target.savedAt || now,
            createdAt: target.createdAt || now,
            updatedAt: now,
            days: target.days,
          }
        : {
            ...rest,
            updatedAt: now,
            status: target.savedAt ? "saved" : target.status,
            originAlbumId: target.savedAt ? undefined : target.originAlbumId,
          };
      persist([restored, ...albumsRef.current.filter((a) => a.id !== restored.id && a.id !== id)], {
        deleted: deletedAlbumsRef.current.filter((a) => a.id !== id),
        updatedAt: now,
      });
      flushCloudSave();
      return restored;
    },
    [flushCloudSave, persist],
  );

  const restoreAllDeletedAlbums = useCallback(() => {
    const targets = deletedAlbumsRef.current.filter((album) => album.deletedReason !== "confirmed");
    if (targets.length === 0) return [];
    const restoredList: SavedTravelAlbum[] = [];
    for (const target of targets) {
      const restored = restoreAlbum(target.id);
      if (restored) restoredList.push(restored);
    }
    return restoredList;
  }, [restoreAlbum]);

  const isAlbumDeleted = useCallback(
    (id: string) => deletedAlbumsRef.current.some((album) => album.id === id),
    [],
  );

  const clearAll = useCallback(() => {
    clearSavedAlbumsStorage();
    persist([], { deleted: [], updatedAt: new Date().toISOString() });
  }, [persist]);

  return {
    albums,
    deletedAlbums,
    filteredAlbums,
    hydrated,
    syncStatus,
    storageStatus,
    refreshStorageStatus,
    searchTerm,
    setSearchTerm,
    upsertAlbum,
    updateAlbumMeta,
    updateAlbumPhotoMemo,
    deleteAlbum,
    restoreAlbum,
    restoreAllDeletedAlbums,
    findDraftForOrigin: (originAlbumId: string) =>
      findDraftForOrigin(albumsRef.current, originAlbumId),
    clearAll,
    isAlbumDeleted,
    countAlbumPhotos,
    refreshFromSupabase,
  };
}
