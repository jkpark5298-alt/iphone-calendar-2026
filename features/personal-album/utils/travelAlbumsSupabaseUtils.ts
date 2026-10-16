/**
 * travelAlbumsSupabaseUtils.ts
 * 여행 앨범 · 수동 여행 계획 Supabase 동기화 (PC · 아이폰 공유)
 */
import { getSupabase, isSupabaseConfigured } from "../../../lib/supabaseClient";
import {
  normalizeSavedAlbum,
  readSavedAlbumsRoot,
  writeSavedAlbumsRoot,
  capDeletedAlbums,
  albumIsHiddenByTombstone,
  type SavedTravelAlbum,
} from "./chapter3SavedAlbumUtils";
import {
  hydrateAlbumDaysFromRemote,
  prepareAlbumDaysForSync,
  slimAlbumDaysForRemote,
} from "./chapter3AlbumSyncUtils";
import {
  readManualTripsStore,
  writeManualTripsStore,
  type Chapter3ManualTripsStore,
} from "./chapter3ManualStorage";
import { ensureManualTripSegmentIds } from "./chapter3Utils";
import { getTravelDiarySessionId } from "./travelDiarySession";

export function getTravelAlbumsSessionId(): string {
  return getTravelDiarySessionId();
}

/** @deprecated use getTravelAlbumsSessionId() */
export const TRAVEL_ALBUMS_SESSION_ID = "default";

export type TravelAlbumsState = {
  albums: SavedTravelAlbum[];
  deletedAlbums?: SavedTravelAlbum[];
  manualTrips?: Chapter3ManualTripsStore | null;
  updatedAt: string;
};

let cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;

export function normalizeManualTripsStore(
  store?: Partial<Chapter3ManualTripsStore> | null,
): Chapter3ManualTripsStore | null {
  if (!store) return null;
  const trips = Array.isArray(store.trips)
    ? store.trips.map((trip) => ensureManualTripSegmentIds(trip))
    : [];
  return {
    trips,
    activeSource: store.activeSource === "manual" ? "manual" : "chapter2",
    activeTripId: typeof store.activeTripId === "string" ? store.activeTripId : null,
    updatedAt: store.updatedAt || new Date().toISOString(),
  };
}

export function normalizeTravelAlbumsState(
  state?: Partial<TravelAlbumsState> | null,
): TravelAlbumsState {
  const albums = Array.isArray(state?.albums)
    ? state.albums
        .map((a) => {
          const normalized = normalizeSavedAlbum(a);
          if (!normalized) return null;
          return {
            ...normalized,
            days: hydrateAlbumDaysFromRemote(normalized.days),
          };
        })
        .filter((a): a is SavedTravelAlbum => Boolean(a))
    : [];
  return {
    albums,
    deletedAlbums: capDeletedAlbums(
      Array.isArray(state?.deletedAlbums)
        ? state.deletedAlbums
            .map((a) => normalizeSavedAlbum(a))
            .filter((a): a is SavedTravelAlbum => Boolean(a))
        : [],
    ),
    manualTrips: normalizeManualTripsStore(state?.manualTrips),
    updatedAt: state?.updatedAt || new Date().toISOString(),
  };
}

export function readTravelAlbumsStateFromLocalStorage(): TravelAlbumsState | null {
  if (typeof window === "undefined") return null;
  const root = readSavedAlbumsRoot();
  const manualTrips = readManualTripsStore();
  if (
    root.albums.length === 0 &&
    manualTrips.trips.length === 0 &&
    !localStorage.getItem("iphone-calendar-personal-album-saved-albums-v1")
  ) {
    return null;
  }
  return normalizeTravelAlbumsState({
    albums: root.albums,
    deletedAlbums: root.deletedAlbums,
    manualTrips,
    updatedAt: root.updatedAt,
  });
}

function mergeManualTripsStores(
  local: Chapter3ManualTripsStore | null | undefined,
  remote: Chapter3ManualTripsStore | null | undefined,
): Chapter3ManualTripsStore | null {
  if (!local && !remote) return null;
  if (!local) return remote ? normalizeManualTripsStore(remote) : null;
  if (!remote) return normalizeManualTripsStore(local);

  const tripMap = new Map<string, Chapter3ManualTripsStore["trips"][number]>();
  for (const trip of local.trips) tripMap.set(trip.id, trip);
  for (const remoteTrip of remote.trips) {
    const existing = tripMap.get(remoteTrip.id);
    if (!existing) {
      tripMap.set(remoteTrip.id, remoteTrip);
      continue;
    }
    const existingTime = Date.parse(existing.updatedAt || existing.createdAt || "");
    const remoteTime = Date.parse(remoteTrip.updatedAt || remoteTrip.createdAt || "");
    tripMap.set(remoteTrip.id, remoteTime >= existingTime ? remoteTrip : existing);
  }

  const localTime = Date.parse(local.updatedAt || "");
  const remoteTime = Date.parse(remote.updatedAt || "");
  const useRemoteMeta = remoteTime > localTime;

  return normalizeManualTripsStore({
    trips: Array.from(tripMap.values()),
    activeSource: useRemoteMeta ? remote.activeSource : local.activeSource,
    activeTripId: useRemoteMeta ? remote.activeTripId : local.activeTripId,
    updatedAt: new Date(Math.max(localTime, remoteTime, 0) || Date.now()).toISOString(),
  });
}

function pickNewerAlbum(a: SavedTravelAlbum, b: SavedTravelAlbum): SavedTravelAlbum {
  const timeA = Date.parse(a.updatedAt || a.createdAt || "");
  const timeB = Date.parse(b.updatedAt || b.createdAt || "");
  if (timeA !== timeB) return timeA >= timeB ? a : b;
  // 동일 시각이면 확정 상태를 우선 (동기화로 확정이 임시로 강등되지 않게)
  if (a.status === "saved" && b.status !== "saved") return a;
  if (b.status === "saved" && a.status !== "saved") return b;
  return a;
}

function mergeSameIdAlbum(local: SavedTravelAlbum, remote: SavedTravelAlbum): SavedTravelAlbum {
  const newer = pickNewerAlbum(local, remote);
  const older = newer === local ? remote : local;
  // 같은 id에서 최신이 draft여도, 다른 쪽이 확정이면 확정 상태를 유지
  if (older.status === "saved" && newer.status === "draft") {
    return {
      ...newer,
      status: "saved",
      originAlbumId: undefined,
      savedAt: older.savedAt || newer.savedAt || older.updatedAt || newer.updatedAt,
    };
  }
  return newer;
}

function mergeAlbumRecords(
  local: SavedTravelAlbum[],
  remote: SavedTravelAlbum[],
  options?: { localUpdatedAt?: string; remoteUpdatedAt?: string },
): SavedTravelAlbum[] {
  const map = new Map<string, SavedTravelAlbum>();
  for (const album of local) map.set(album.id, album);
  for (const remoteAlbum of remote) {
    const existing = map.get(remoteAlbum.id);
    if (!existing) {
      map.set(remoteAlbum.id, remoteAlbum);
      continue;
    }
    map.set(remoteAlbum.id, mergeSameIdAlbum(existing, remoteAlbum));
  }

  // 로컬이 더 최신이면 로컬에서 삭제된 앨범은 원격에서 다시 넣지 않음
  const localTime = Date.parse(options?.localUpdatedAt || "");
  const remoteTime = Date.parse(options?.remoteUpdatedAt || "");
  if (localTime > remoteTime) {
    const localIds = new Set(local.map((a) => a.id));
    for (const id of map.keys()) {
      if (!localIds.has(id)) map.delete(id);
    }
  }

  // 같은 sourcePlanId라도 확정·임시는 각각 1개씩 유지
  // (예전: 최신 1개만 남겨 임시가 확정을 덮어쓰는 버그가 있었음)
  const byPlanSaved = new Map<string, SavedTravelAlbum>();
  const byPlanDraft = new Map<string, SavedTravelAlbum>();
  const withoutPlan: SavedTravelAlbum[] = [];
  const sorted = Array.from(map.values()).sort(
    (a, b) =>
      Date.parse(b.updatedAt || b.createdAt || "") -
      Date.parse(a.updatedAt || a.createdAt || ""),
  );
  for (const album of sorted) {
    const planId = album.sourcePlanId?.trim();
    if (!planId) {
      withoutPlan.push(album);
      continue;
    }
    if (album.status === "draft") {
      const prev = byPlanDraft.get(planId);
      byPlanDraft.set(planId, prev ? pickNewerAlbum(prev, album) : album);
    } else {
      const prev = byPlanSaved.get(planId);
      byPlanSaved.set(planId, prev ? pickNewerAlbum(prev, album) : album);
    }
  }

  return [...byPlanSaved.values(), ...byPlanDraft.values(), ...withoutPlan].sort(
    (a, b) =>
      Date.parse(b.updatedAt || b.createdAt || "") -
      Date.parse(a.updatedAt || a.createdAt || ""),
  );
}

export function mergeTravelAlbumsStates(
  local: TravelAlbumsState | null,
  remote: TravelAlbumsState | null,
): TravelAlbumsState | null {
  if (!local && !remote) return null;
  if (!local) return normalizeTravelAlbumsState(remote);
  if (!remote) return normalizeTravelAlbumsState(local);

  let deletedMerged = mergeAlbumRecords(local.deletedAlbums || [], remote.deletedAlbums || [], {
    localUpdatedAt: local.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

  const localTime = Date.parse(local.updatedAt || "");
  const remoteTime = Date.parse(remote.updatedAt || "");
  // 이 기기에서 방금 복원·저장한 앨범은 서버의 예전 삭제 기록으로 다시 지우지 않음
  if (localTime >= remoteTime) {
    const localActiveIds = new Set(local.albums.map((album) => album.id));
    deletedMerged = deletedMerged.filter((tomb) => !localActiveIds.has(tomb.id));
  }

  const isDeleted = (album: SavedTravelAlbum) =>
    albumIsHiddenByTombstone(album, deletedMerged);

  const localActive = local.albums.filter((album) => !isDeleted(album));
  const remoteActive = remote.albums.filter((album) => !isDeleted(album));

  const albums = mergeAlbumRecords(localActive, remoteActive, {
    localUpdatedAt: local.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
  }).filter((album) => !isDeleted(album));

  const activeIds = new Set(albums.map((album) => album.id));
  const deletedAlbums = capDeletedAlbums(
    deletedMerged.filter((album) => !activeIds.has(album.id)),
  );
  const manualTrips = mergeManualTripsStores(local.manualTrips, remote.manualTrips);
  return normalizeTravelAlbumsState({
    albums,
    deletedAlbums,
    manualTrips,
    updatedAt:
      localTime >= remoteTime
        ? local.updatedAt
        : remote.updatedAt || new Date().toISOString(),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTravelAlbumsState(row: any): TravelAlbumsState {
  const rawAlbums = Array.isArray(row?.albums) ? row.albums : [];
  const nestedDeleted = Array.isArray(row?.deleted_albums) ? row.deleted_albums : [];
  const fromAlbums = rawAlbums.filter((a: { deletedAt?: string }) => a?.deletedAt);
  const active = rawAlbums.filter((a: { deletedAt?: string }) => !a?.deletedAt);
  return normalizeTravelAlbumsState({
    albums: active,
    deletedAlbums: [...nestedDeleted, ...fromAlbums],
    manualTrips: row?.manual_trips,
    updatedAt: row?.updated_at_kst || row?.updated_at || new Date().toISOString(),
  });
}

function travelAlbumsStateToRow(state: TravelAlbumsState) {
  return {
    session_id: getTravelAlbumsSessionId(),
    albums: [
      ...state.albums.map((album) => ({
        ...album,
        days: slimAlbumDaysForRemote(album.days),
      })),
      ...(state.deletedAlbums || []).map((album) => ({
        ...album,
        deletedAt: album.deletedAt || album.updatedAt,
        days: slimAlbumDaysForRemote(album.days),
      })),
    ],
    manual_trips: state.manualTrips || null,
    updated_at_kst: state.updatedAt || new Date().toISOString(),
  };
}

export function applyTravelAlbumsStateToLocalStorage(state: TravelAlbumsState): void {
  writeSavedAlbumsRoot({
    version: 1,
    albums: state.albums,
    deletedAlbums: state.deletedAlbums || [],
    updatedAt: state.updatedAt,
  });
  if (state.manualTrips) {
    writeManualTripsStore(state.manualTrips);
  }
}

async function flushChapter3CloudSave(): Promise<boolean> {
  if (cloudSaveInFlight) {
    cloudSaveQueued = true;
    return false;
  }
  cloudSaveInFlight = true;
  try {
    const localRoot = readSavedAlbumsRoot();
    const state = normalizeTravelAlbumsState({
      albums: localRoot.albums,
      deletedAlbums: localRoot.deletedAlbums,
      manualTrips: readManualTripsStore(),
      updatedAt: localRoot.updatedAt,
    });
    return await saveTravelAlbumsToSupabase(state);
  } finally {
    cloudSaveInFlight = false;
    if (cloudSaveQueued) {
      cloudSaveQueued = false;
      return flushChapter3CloudSave();
    }
  }
}

export function scheduleChapter3CloudSave(delayMs = 800): void {
  if (typeof window === "undefined") return;
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    cloudSaveTimer = null;
    void flushChapter3CloudSave();
  }, delayMs);
}

export const loadTravelAlbumsFromSupabase = async (): Promise<TravelAlbumsState | null> => {
  if (!isSupabaseConfigured) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("travel_albums_state")
      .select("*")
      .eq("session_id", getTravelAlbumsSessionId())
      .maybeSingle();
    if (error) {
      console.error("travel albums Supabase load failed", error);
      return null;
    }
    if (!data) return null;
    return rowToTravelAlbumsState(data);
  } catch (error) {
    console.error("travel albums Supabase load failed", error);
    return null;
  }
};

export const saveTravelAlbumsToSupabase = async (
  state: TravelAlbumsState,
): Promise<boolean> => {
  if (!isSupabaseConfigured) return false;
  try {
    const supabase = getSupabase();
    const preparedAlbums: SavedTravelAlbum[] = [];
    for (const album of state.albums) {
      const syncedDays = await prepareAlbumDaysForSync(album.days);
      preparedAlbums.push({
        ...album,
        days: syncedDays,
      });
    }
    const preparedDeleted: SavedTravelAlbum[] = [];
    for (const album of state.deletedAlbums || []) {
      const syncedDays = await prepareAlbumDaysForSync(album.days);
      preparedDeleted.push({
        ...album,
        deletedAt: album.deletedAt || album.updatedAt,
        days: syncedDays,
      });
    }

    const normalized = normalizeTravelAlbumsState({
      albums: preparedAlbums,
      deletedAlbums: preparedDeleted,
      manualTrips: state.manualTrips ?? readManualTripsStore(),
      updatedAt: state.updatedAt || new Date().toISOString(),
    });

    // 로컬에는 표시용 URL이 채워진 상태 유지
    applyTravelAlbumsStateToLocalStorage(normalized);

    const remotePayload = travelAlbumsStateToRow(normalized);

    const { error } = await supabase
      .from("travel_albums_state")
      .upsert(remotePayload, { onConflict: "session_id" });
    if (error) {
      console.error("travel albums Supabase save failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("travel albums Supabase save failed", error);
    return false;
  }
};

export const clearTravelAlbumsFromSupabase = async (): Promise<boolean> => {
  if (!isSupabaseConfigured) return true;
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("travel_albums_state")
      .delete()
      .eq("session_id", getTravelAlbumsSessionId());
    if (error) {
      console.error("travel albums Supabase clear failed", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("travel albums Supabase clear failed", error);
    return false;
  }
};
