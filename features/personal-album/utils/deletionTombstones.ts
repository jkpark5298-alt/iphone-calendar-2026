/** 원격에서 지운 뒤 로컬 자동 업로드로 되살아나는 것 방지 */

const DELETED_BUNDLES_KEY = "iphone-calendar-personal-album-deleted-bundle-ids-v1";
const DELETED_PLACES_KEY = "iphone-calendar-personal-album-deleted-place-ids-v1";

function readIdList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeIdList(key: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    // 최근 500개만 유지
    localStorage.setItem(key, JSON.stringify(ids.slice(-500)));
  } catch {
    // ignore quota
  }
}

export function markBundleDeleted(bundleId: number | string): void {
  const id = String(bundleId);
  const next = readIdList(DELETED_BUNDLES_KEY).filter((x) => x !== id);
  next.push(id);
  writeIdList(DELETED_BUNDLES_KEY, next);
}

export function isBundleMarkedDeleted(bundleId: number | string): boolean {
  return readIdList(DELETED_BUNDLES_KEY).includes(String(bundleId));
}

export function clearBundleDeletedMark(bundleId: number | string): void {
  writeIdList(
    DELETED_BUNDLES_KEY,
    readIdList(DELETED_BUNDLES_KEY).filter((x) => x !== String(bundleId)),
  );
}

export function markTravelPlaceDeleted(placeId: string): void {
  const next = readIdList(DELETED_PLACES_KEY).filter((x) => x !== placeId);
  next.push(placeId);
  writeIdList(DELETED_PLACES_KEY, next);
}

export function isTravelPlaceMarkedDeleted(placeId: string): boolean {
  return readIdList(DELETED_PLACES_KEY).includes(placeId);
}

export function filterOutDeletedTravelPlaces<T extends { id: string }>(places: T[]): T[] {
  const deleted = new Set(readIdList(DELETED_PLACES_KEY));
  if (deleted.size === 0) return places;
  return places.filter((p) => !deleted.has(p.id));
}
