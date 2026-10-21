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

  // 목록에 없다는 이유만으로 상대 앨범을 지우지 않음.
  // 삭제는 deletedAlbums(삭제 기록)로만 반영한다.
  // 예전: 로컬 updatedAt이 더 최신이면 로컬 id 목록을 전체로 보고 나머지를 삭제 → 아이폰 부분 목록이 서버 앨범을 지움.

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

  const localAlbumCount = local.albums.length;
  const remoteAlbumCount = remote.albums.length;
  // 빈 로컬 + 최신 updatedAt 이 원격 앨범을 통째로 지우는 사고 방지
  if (localAlbumCount === 0 && remoteAlbumCount > 0) {
    return normalizeTravelAlbumsState(remote);
  }

  let deletedMerged = mergeAlbumRecords(local.deletedAlbums || [], remote.deletedAlbums || []);

  const localTime = Date.parse(local.updatedAt || "");
  const remoteTime = Date.parse(remote.updatedAt || "");
  // 이 기기에서 방금 복원·저장한 앨범은 서버의 예전 삭제 기록으로 다시 지우지 않음
  // (로컬에 활성 앨범이 있을 때만 — 빈 로컬의 최신 시각으로 삭제 기록을 무시하지 않음)
  if (localTime >= remoteTime && localAlbumCount > 0) {
    const localActiveIds = new Set(local.albums.map((album) => album.id));
    deletedMerged = deletedMerged.filter((tomb) => !localActiveIds.has(tomb.id));
  }

  const isDeleted = (album: SavedTravelAlbum) =>
    albumIsHiddenByTombstone(album, deletedMerged);

  const localActive = local.albums.filter((album) => !isDeleted(album));
  const remoteActive = remote.albums.filter((album) => !isDeleted(album));

  const albums = mergeAlbumRecords(localActive, remoteActive).filter(
    (album) => !isDeleted(album),
  );

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
      localTime >= remoteTime && localAlbumCount > 0
        ? local.updatedAt
        : remote.updatedAt || local.updatedAt || new Date().toISOString(),
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

/**
 * 서버 앨범의 수정 시각만 확인한다 (몇십 바이트).
 * 주기적으로 확인할 때 전체 자료(수백 KB)를 매번 받지 않으려고 쓴다.
 * 확인하지 못하면 null → 호출한 쪽에서 전체를 받아 확인한다.
 */
export const probeTravelAlbumsUpdatedAt = async (): Promise<string | null> => {
  if (!isSupabaseConfigured) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("travel_albums_state")
      .select("updated_at_kst")
      .eq("session_id", getTravelAlbumsSessionId())
      .maybeSingle();
    if (error || !data) return null;
    const value = (data as { updated_at_kst?: string | null }).updated_at_kst;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
};

/**
 * 앨범 전체(약 80KB)를 서버에서 받는다.
 * 앱을 열 때 여러 곳에서 거의 동시에 호출해 같은 데이터를 4번씩 받던 문제를 막으려고,
 * 이미 받는 중이면 그 결과를 같이 쓰고, 방금(3초 안에) 받았으면 그 값을 다시 쓴다.
 */
const ALBUM_LOAD_REUSE_MS = 3000;
let albumLoadInFlight: Promise<TravelAlbumsState | null> | null = null;
let albumLoadRecent: { at: number; value: TravelAlbumsState | null } | null = null;

export const loadTravelAlbumsFromSupabase = async (): Promise<TravelAlbumsState | null> => {
  if (albumLoadInFlight) return albumLoadInFlight;
  if (albumLoadRecent && Date.now() - albumLoadRecent.at < ALBUM_LOAD_REUSE_MS) return albumLoadRecent.value;
  albumLoadInFlight = fetchTravelAlbumsFromSupabase()
    .then((value) => {
      albumLoadRecent = value ? { at: Date.now(), value } : null;
      return value;
    })
    .finally(() => {
      albumLoadInFlight = null;
    });
  return albumLoadInFlight;
};

/** 저장한 직후에는 예전 값을 다시 쓰지 않도록 비운다. */
export const forgetRecentTravelAlbumsLoad = () => {
  albumLoadRecent = null;
};

const fetchTravelAlbumsFromSupabase = async (): Promise<TravelAlbumsState | null> => {
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

/**
 * 저장 직전에 서버 내용과 맞춘다.
 * - 이 기기에 없는 서버 앨범은 삭제 기록이 있을 때만 빼고, 없으면 저장본에 다시 넣는다.
 * - 같은 id인데 서버 쪽이 더 최신이면 서버 것을 쓴다 (다른 기기의 최신 수정을 예전 사본으로 덮지 않게).
 * - 서버의 삭제 기록도 합친다.
 */
export function keepRemoteAlbumsMissingLocally(
  state: TravelAlbumsState,
  remote: TravelAlbumsState | null,
): TravelAlbumsState {
  if (!remote) return state;
  const localDeleted = state.deletedAlbums || [];
  const localDeletedIds = new Set(localDeleted.map((album) => album.id));
  const tombstones = [
    ...localDeleted,
    ...(remote.deletedAlbums || []).filter((album) => !localDeletedIds.has(album.id)),
  ];
  const remoteById = new Map(remote.albums.map((album) => [album.id, album]));
  let changed = tombstones.length !== localDeleted.length;

  const albums = state.albums.map((album) => {
    const remoteAlbum = remoteById.get(album.id);
    if (!remoteAlbum) return album;
    const localTime = Date.parse(album.updatedAt || album.createdAt || "");
    const remoteTime = Date.parse(remoteAlbum.updatedAt || remoteAlbum.createdAt || "");
    if (!(remoteTime > localTime)) return album;
    changed = true;
    return mergeSameIdAlbum(album, remoteAlbum);
  });
  const ids = new Set(albums.map((album) => album.id));
  const missing = remote.albums.filter(
    (album) => !ids.has(album.id) && !albumIsHiddenByTombstone(album, tombstones),
  );
  if (missing.length > 0) changed = true;
  if (!changed) return state;

  const active = [...albums, ...missing].filter(
    (album) => !albumIsHiddenByTombstone(album, tombstones),
  );
  const activeIds = new Set(active.map((album) => album.id));
  return {
    ...state,
    albums: active,
    deletedAlbums: capDeletedAlbums(tombstones.filter((album) => !activeIds.has(album.id))),
  };
}

async function withRemoteAlbumsKept(state: TravelAlbumsState): Promise<TravelAlbumsState> {
  const remote = await loadTravelAlbumsFromSupabase();
  const kept = keepRemoteAlbumsMissingLocally(state, remote);
  if (kept.albums.length !== state.albums.length) {
    console.warn(
      "travel albums: keeping remote albums missing from this device",
      kept.albums.length - state.albums.length,
    );
  }
  return kept;
}

export const saveTravelAlbumsToSupabase = async (
  state: TravelAlbumsState,
): Promise<boolean> => {
  if (!isSupabaseConfigured) return false;
  try {
    // 저장 전에 서버와 맞출 때는 방금 받아 둔 값을 쓰지 않고 새로 받는다.
    forgetRecentTravelAlbumsLoad();
    const stateToSave = await withRemoteAlbumsKept(state);

    const supabase = getSupabase();
    const preparedAlbums: SavedTravelAlbum[] = [];
    for (const album of stateToSave.albums) {
      const syncedDays = await prepareAlbumDaysForSync(album.days);
      preparedAlbums.push({
        ...album,
        days: syncedDays,
      });
    }
    const preparedDeleted: SavedTravelAlbum[] = [];
    for (const album of stateToSave.deletedAlbums || []) {
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
      manualTrips: stateToSave.manualTrips ?? readManualTripsStore(),
      updatedAt: stateToSave.updatedAt || new Date().toISOString(),
    });

    // 로컬에는 표시용 URL이 채워진 상태 유지.
    // 저장하는 동안 이 기기에서 새로 저장된 내용이 있으면 예전 사본으로 덮지 않는다.
    if (typeof window !== "undefined" && readSavedAlbumsRoot().updatedAt === state.updatedAt) {
      applyTravelAlbumsStateToLocalStorage(normalized);
    }

    const remotePayload = travelAlbumsStateToRow(normalized);

    const { error } = await supabase
      .from("travel_albums_state")
      .upsert(remotePayload, { onConflict: "session_id" });
    forgetRecentTravelAlbumsLoad();
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
