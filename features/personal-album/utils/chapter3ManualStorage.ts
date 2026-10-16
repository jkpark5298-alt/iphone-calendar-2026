import type { Chapter3AlbumSource, Chapter3ManualTrip } from "./chapter3Utils";

const MANUAL_TRIPS_KEY = "iphone-calendar-personal-album-chapter3-manual-trips-v1";

export type Chapter3ManualTripsStore = {
  trips: Chapter3ManualTrip[];
  activeSource: Chapter3AlbumSource;
  activeTripId: string | null;
  updatedAt: string;
};

const defaultStore = (): Chapter3ManualTripsStore => ({
  trips: [],
  activeSource: "chapter2",
  activeTripId: null,
  updatedAt: new Date().toISOString(),
});

export function readManualTripsStore(): Chapter3ManualTripsStore {
  if (typeof window === "undefined") return defaultStore();
  try {
    const raw = localStorage.getItem(MANUAL_TRIPS_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw) as Chapter3ManualTripsStore;
    return {
      ...defaultStore(),
      ...parsed,
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
    };
  } catch {
    return defaultStore();
  }
}

export function writeManualTripsStore(store: Chapter3ManualTripsStore): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    MANUAL_TRIPS_KEY,
    JSON.stringify({ ...store, updatedAt: new Date().toISOString() }),
  );
}

export function clearManualTripsStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(MANUAL_TRIPS_KEY);
}
