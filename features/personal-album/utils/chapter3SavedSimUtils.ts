import {
  normalizeSimMapConfig,
  type Chapter3SimMapConfig,
} from "./chapter3Utils";

export type SavedSimRouteLeg = {
  from: string;
  to: string;
  distanceMeters: number;
  durationMs: number;
};

export type SavedSimRouteStats = {
  legs: SavedSimRouteLeg[];
  totalDistanceMeters: number;
  totalDurationMs: number;
  computedAt: string;
};

export interface SavedSimMap {
  id: string;
  title: string;
  config: Chapter3SimMapConfig;
  routeStats?: SavedSimRouteStats | null;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "iphone-calendar-personal-album-chapter3-saved-sims-v1";

type SavedSimsRoot = {
  version: 1;
  sims: SavedSimMap[];
  updatedAt: string;
};

function emptyRoot(): SavedSimsRoot {
  return { version: 1, sims: [], updatedAt: new Date().toISOString() };
}

export function createSavedSimId(): string {
  return `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeRouteStats(raw: unknown): SavedSimRouteStats | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<SavedSimRouteStats>;
  if (!Array.isArray(data.legs)) return null;
  const legs = data.legs
    .map((leg) => ({
      from: String(leg?.from || "").trim(),
      to: String(leg?.to || "").trim(),
      distanceMeters: Math.max(0, Number(leg?.distanceMeters) || 0),
      durationMs: Math.max(0, Number(leg?.durationMs) || 0),
    }))
    .filter((leg) => leg.from && leg.to);
  return {
    legs,
    totalDistanceMeters: Math.max(0, Number(data.totalDistanceMeters) || 0),
    totalDurationMs: Math.max(0, Number(data.totalDurationMs) || 0),
    computedAt: String(data.computedAt || new Date().toISOString()),
  };
}

export function normalizeSavedSim(raw: Partial<SavedSimMap>): SavedSimMap | null {
  if (!raw?.id || typeof raw.id !== "string") return null;
  const now = new Date().toISOString();
  const config = normalizeSimMapConfig(raw.config);
  return {
    id: raw.id,
    title: String(raw.title || "여행 지도 시뮬레이션").trim() || "여행 지도 시뮬레이션",
    config,
    routeStats: normalizeRouteStats(raw.routeStats),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

export function readSavedSims(): SavedSimMap[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSimsRoot;
    if (parsed.version !== 1 || !Array.isArray(parsed.sims)) return [];
    return parsed.sims
      .map((s) => normalizeSavedSim(s))
      .filter(Boolean)
      .sort(
        (a, b) =>
          Date.parse((b as SavedSimMap).updatedAt) - Date.parse((a as SavedSimMap).updatedAt),
      ) as SavedSimMap[];
  } catch {
    return [];
  }
}

export function writeSavedSims(sims: SavedSimMap[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    const root: SavedSimsRoot = {
      version: 1,
      sims,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
    return true;
  } catch {
    return false;
  }
}

export function upsertSavedSim(input: {
  id?: string;
  title: string;
  config: Chapter3SimMapConfig;
  routeStats?: SavedSimRouteStats | null;
}): SavedSimMap {
  const now = new Date().toISOString();
  const list = readSavedSims();
  const id = input.id || createSavedSimId();
  const idx = list.findIndex((s) => s.id === id);
  const next: SavedSimMap = {
    id,
    title: input.title.trim() || "여행 지도 시뮬레이션",
    config: normalizeSimMapConfig(input.config),
    routeStats:
      input.routeStats === undefined
        ? idx >= 0
          ? list[idx].routeStats
          : null
        : input.routeStats,
    createdAt: idx >= 0 ? list[idx].createdAt : now,
    updatedAt: now,
  };
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  writeSavedSims(list);
  return next;
}

export function deleteSavedSim(id: string): SavedSimMap[] {
  const next = readSavedSims().filter((s) => s.id !== id);
  writeSavedSims(next);
  return next;
}

export function countSimPlaces(config: Chapter3SimMapConfig): number {
  return (config.days || []).reduce((n, d) => n + (d.places?.length || 0), 0);
}

export function formatSimSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
