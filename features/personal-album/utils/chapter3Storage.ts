import type { Chapter3AlbumDay } from "./chapter3Utils";
import { normalizeSimMapConfig, type Chapter3SimMapConfig } from "./chapter3Utils";
import {
  hydrateAlbumDaysFromRemote,
  slimAlbumDaysForLocal,
} from "./chapter3AlbumSyncUtils";

const ALBUM_STORAGE_KEY = "iphone-calendar-personal-album-chapter3-album-v2";
const SIM_MAP_STORAGE_KEY = "iphone-calendar-personal-album-chapter3-sim-map-v1";

type Chapter3AlbumRootStore = {
  version: 2;
  byPlanId: Record<string, { days: Chapter3AlbumDay[]; updatedAt: string }>;
};

function readAlbumRoot(): Chapter3AlbumRootStore {
  if (typeof window === "undefined") {
    return { version: 2, byPlanId: {} };
  }
  try {
    const raw = localStorage.getItem(ALBUM_STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem("iphone-calendar-personal-album-chapter3-album-v1");
      if (legacy) {
        const old = JSON.parse(legacy) as { planId?: string; days?: Chapter3AlbumDay[] };
        if (old.planId && Array.isArray(old.days)) {
          return {
            version: 2,
            byPlanId: {
              [old.planId]: {
                days: hydrateAlbumDaysFromRemote(old.days),
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }
      }
      return { version: 2, byPlanId: {} };
    }
    const parsed = JSON.parse(raw) as Chapter3AlbumRootStore;
    if (parsed.version === 2 && parsed.byPlanId) {
      const byPlanId: Chapter3AlbumRootStore["byPlanId"] = {};
      for (const [id, entry] of Object.entries(parsed.byPlanId)) {
        byPlanId[id] = {
          ...entry,
          days: hydrateAlbumDaysFromRemote(entry.days || []),
        };
      }
      return { version: 2, byPlanId };
    }
    return { version: 2, byPlanId: {} };
  } catch {
    return { version: 2, byPlanId: {} };
  }
}

function writeAlbumRoot(root: Chapter3AlbumRootStore): boolean {
  if (typeof window === "undefined") return false;
  try {
    // base64 원본 대신 URL만 저장해 용량 한도 회피
    const slimmed: Chapter3AlbumRootStore = {
      version: 2,
      byPlanId: {},
    };
    for (const [id, entry] of Object.entries(root.byPlanId)) {
      slimmed.byPlanId[id] = {
        updatedAt: entry.updatedAt,
        days: slimAlbumDaysForLocal(entry.days || []),
      };
    }
    localStorage.setItem(ALBUM_STORAGE_KEY, JSON.stringify(slimmed));
    return true;
  } catch {
    return false;
  }
}

export function listChapter3AlbumPlanEntries(): {
  planId: string;
  days: Chapter3AlbumDay[];
  updatedAt: string;
}[] {
  const root = readAlbumRoot();
  return Object.entries(root.byPlanId).map(([planId, entry]) => ({
    planId,
    days: entry.days || [],
    updatedAt: entry.updatedAt,
  }));
}

export function readChapter3Album(planId: string): Chapter3AlbumDay[] | null {
  if (!planId) return null;
  const entry = readAlbumRoot().byPlanId[planId];
  return entry?.days ?? null;
}

export function writeChapter3Album(planId: string, days: Chapter3AlbumDay[]): boolean {
  if (typeof window === "undefined" || !planId) return false;
  const root = readAlbumRoot();
  root.byPlanId[planId] = {
    days: slimAlbumDaysForLocal(days),
    updatedAt: new Date().toISOString(),
  };
  return writeAlbumRoot(root);
}

export function removeChapter3Album(planId: string): void {
  if (typeof window === "undefined" || !planId) return;
  const root = readAlbumRoot();
  if (!root.byPlanId[planId]) return;
  delete root.byPlanId[planId];
  writeAlbumRoot(root);
}

export function readChapter3SimMap(): Chapter3SimMapConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SIM_MAP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.days)) return null;
    return normalizeSimMapConfig(parsed);
  } catch {
    return null;
  }
}

export function writeChapter3SimMap(config: Chapter3SimMapConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SIM_MAP_STORAGE_KEY, JSON.stringify(config));
}

export function clearChapter3Storage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ALBUM_STORAGE_KEY);
  localStorage.removeItem("iphone-calendar-personal-album-chapter3-album-v1");
  localStorage.removeItem(SIM_MAP_STORAGE_KEY);
}

export function clearChapter3AlbumStorage(): void {
  clearChapter3Storage();
}
