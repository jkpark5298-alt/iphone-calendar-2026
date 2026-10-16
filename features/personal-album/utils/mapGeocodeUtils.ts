import {
  normalizePlaceDedupeKey,
  parsePlaceWithAddress,
  resolvePlaceForMapGeocode,
} from "./planUtils";
import { geocodePlaceForMap, getStrictAddressQuery, lookupKnownMapCoord } from "./naverGeocodeUtils";

type MapCoord = { lat: number; lng: number };

function normalizeAddressKey(address: string): string {
  return address.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 동일 장소 — 여러 문자열 키로 coord 저장 */
export function registerMapCoordAliases(
  coordMap: Map<string, MapCoord>,
  place: string,
  resolved: string,
  coord: MapCoord,
): void {
  coordMap.set(place, coord);
  if (resolved !== place) coordMap.set(resolved, coord);

  for (const variant of [place, resolved]) {
    const parsed = parsePlaceWithAddress(variant);
    coordMap.set(normalizePlaceDedupeKey(variant), coord);
    if (parsed.address) {
      coordMap.set(normalizeAddressKey(parsed.address), coord);
    }
    const strict = getStrictAddressQuery(variant);
    if (strict) coordMap.set(normalizeAddressKey(strict), coord);
  }
}

/** 화면 지도와 동일 — geocode API 결과 그대로 사용 (검증 좌표 강제 덮어쓰기 없음, 단 known 우선) */
export function getMapPlaceCoord(
  place: string,
  coordMap: Map<string, MapCoord>,
  addressLookup?: Map<string, string>,
): MapCoord | null {
  const resolved = addressLookup
    ? resolvePlaceForMapGeocode(place, addressLookup)
    : place;

  // 알려진 검증 좌표(known preset)가 있으면 우선 반환
  const known = lookupKnownMapCoord(place) || lookupKnownMapCoord(resolved);
  if (known) return known;

  const direct = coordMap.get(place);
  if (direct) return direct;

  const fromResolved = coordMap.get(resolved);
  if (fromResolved) return fromResolved;

  const dedupeKey = normalizePlaceDedupeKey(place);
  const fromKey = coordMap.get(dedupeKey);
  if (fromKey) return fromKey;

  const strict = getStrictAddressQuery(resolved) || getStrictAddressQuery(place);
  if (strict) {
    const fromAddr = coordMap.get(normalizeAddressKey(strict));
    if (fromAddr) return fromAddr;
  }

  return null;
}

/** @deprecated getMapPlaceCoord — PDF·화면 공통 geocode API 경로 */
export function resolveMapPlaceCoord(
  place: string,
  coordMap: Map<string, MapCoord>,
  addressLookup?: Map<string, string>,
): MapCoord | null {
  return getMapPlaceCoord(place, coordMap, addressLookup);
}

/** PDF용 — 화면(NaverMap)과 동일: 전체 주소 geocoding → API 좌표 저장 */
export async function buildMapCoordMap(
  places: string[],
  addressLookup: Map<string, string>,
  regionHint: string | undefined,
  credentials: { keyId: string; keySecret: string },
): Promise<Map<string, MapCoord>> {
  const coordMap = new Map<string, MapCoord>();

  for (const place of places) {
    if (getMapPlaceCoord(place, coordMap, addressLookup)) continue;

    const resolved = resolvePlaceForMapGeocode(place, addressLookup);
    const hit = await geocodePlaceForMap(
      resolved,
      regionHint,
      credentials.keyId,
      credentials.keySecret,
      undefined,
      addressLookup,
    );

    if (hit) {
      registerMapCoordAliases(coordMap, place, resolved, { lat: hit.lat, lng: hit.lng });
    }
  }

  return coordMap;
}
