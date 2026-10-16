import { getNaverGeocodeCredentials } from "./naverGeocodeUtils";
import {
  computeMapViewport,
  markersToMercatorOverlayPoints,
  pathToSvgPoints,
  simplifyPath,
  type MapOverlayPoint,
  type MapViewport,
} from "./mapProjectionUtils";
import { fetchDrivingRoutePath, markerPathFallback } from "./naverDirectionsUtils";

const STATIC_MAP_ENDPOINT = "https://maps.apigw.ntruss.com/map-static/v2/raster";
const DEFAULT_MAP_WIDTH = 1024;
const DEFAULT_MAP_HEIGHT = 640;

export type StaticMapMarker = {
  lng: number;
  lat: number;
  label: string;
  color: string;
};

export type StaticMapRouteOverlay = {
  points: string;
  color: string;
  width: number;
  height: number;
};

export type NaverStaticMapResult = {
  mapDataUrl: string | null;
  routeOverlays: StaticMapRouteOverlay[];
  markerOverlays: MapOverlayPoint[];
  mapWidth: number;
  mapHeight: number;
  usedRoadRoute: boolean;
};

/** #ef4444 → 0xef4444 */
export function toNaverStaticColor(hex: string): string {
  const cleaned = hex.replace("#", "").trim();
  if (/^0x/i.test(hex)) return hex;
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `0x${cleaned}`;
  return "0x3b82f6";
}

/** 겹치는 마커(전주 등) — SVG 핀만 분산, Directions 좌표는 원본 */
export function spreadStaticMapMarkersForDisplay(markers: StaticMapMarker[]): StaticMapMarker[] {
  const minDeg = 0.0045;
  const result = markers.map((m) => ({ ...m }));

  for (let i = 0; i < result.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = result[i];
      const b = result[j];
      const dLat = a.lat - b.lat;
      const dLng = a.lng - b.lng;
      const dist = Math.hypot(dLat, dLng);
      if (dist >= minDeg) continue;

      const angle = dist > 1e-9 ? Math.atan2(dLat, dLng) : ((i - j) * Math.PI) / 3;
      const push = (minDeg - dist) / 2 + minDeg * 0.15;
      a.lat += Math.sin(angle) * push;
      a.lng += Math.cos(angle) * push;
      b.lat -= Math.sin(angle) * push;
      b.lng -= Math.cos(angle) * push;
    }
  }

  return result;
}

/** center+level — 배경 타일 (마커·경로는 Mercator SVG) */
async function fetchStaticMapBuffer(
  width: number,
  height: number,
  viewport: MapViewport,
  markers?: StaticMapMarker[],
): Promise<Buffer | null> {
  const credentials = getNaverGeocodeCredentials();
  if (!credentials) return null;

  const w = Math.min(Math.max(width, 100), 1024);
  const h = Math.min(Math.max(height, 100), 1024);
  const query = new URLSearchParams({
    w: String(w),
    h: String(h),
    format: "png",
    scale: "2",
    lang: "ko",
    maptype: "basic",
    center: `${viewport.centerLng},${viewport.centerLat}`,
    level: String(viewport.level),
  });

  // 마커를 Static Map URL에 직접 넣어 오버레이 실패해도 위치가 보이게
  if (markers && markers.length > 0) {
    const markerParts = markers.slice(0, 15).map((m, index) => {
      const label = encodeURIComponent(String(m.label || index + 1).slice(0, 2));
      const color = toNaverStaticColor(m.color || "#dc2626");
      return `type:d|size:mid|color:${color}|pos:${m.lng} ${m.lat}|label:${label}`;
    });
    for (const part of markerParts) {
      query.append("markers", part);
    }
  }

  const url = `${STATIC_MAP_ENDPOINT}?${query.toString()}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/png",
        "X-NCP-APIGW-API-KEY-ID": credentials.keyId,
        "X-NCP-APIGW-API-KEY": credentials.keySecret,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        "Naver Static Map failed",
        response.status,
        detail.slice(0, 200),
      );
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 200) return null;
    return buffer;
  } catch (error) {
    console.warn("Naver Static Map request error", error);
    return null;
  }
}

function bufferToDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function fetchStaticMapDataUrl(
  markers: StaticMapMarker[],
  width = DEFAULT_MAP_WIDTH,
  height = DEFAULT_MAP_HEIGHT,
): Promise<string | null> {
  if (markers.length === 0) return null;
  const viewport = computeMapViewport(
    markers.map((m) => ({ lat: m.lat, lng: m.lng })),
    width,
    height,
    52,
  );
  const buffer = await fetchStaticMapBuffer(width, height, viewport, markers);
  return buffer ? bufferToDataUrl(buffer) : null;
}

function collectBoundsPoints(
  markers: StaticMapMarker[],
  paths: [number, number][][],
): { lat: number; lng: number }[] {
  const points = markers.map((m) => ({ lat: m.lat, lng: m.lng }));
  for (const path of paths) {
    for (const [lng, lat] of simplifyPath(path, 80)) {
      points.push({ lat, lng });
    }
  }
  return points;
}

async function appendInterDayRoutePaths(
  markerGroups: { markers: StaticMapMarker[]; color: string }[],
  routePaths: { path: [number, number][]; color: string; usedRoad: boolean }[],
): Promise<void> {
  for (let i = 0; i < markerGroups.length - 1; i++) {
    const prev = markerGroups[i].markers.at(-1);
    const next = markerGroups[i + 1].markers[0];
    if (!prev || !next) continue;
    if (prev.lat === next.lat && prev.lng === next.lng) continue;

    const coords = [
      { lng: prev.lng, lat: prev.lat },
      { lng: next.lng, lat: next.lat },
    ];
    await appendRoutePath(routePaths, coords, markerGroups[i + 1].color);
  }
}

async function appendRoutePath(
  routePaths: { path: [number, number][]; color: string; usedRoad: boolean }[],
  coords: { lng: number; lat: number }[],
  color: string,
): Promise<void> {
  if (coords.length < 2) return;

  let route = await fetchDrivingRoutePath(coords);
  const usedRoad = Boolean(route?.path?.length);
  const path = route?.path || markerPathFallback(coords);
  routePaths.push({ path, color, usedRoad });
}

/** geocode → Directions 5 도로선 + Mercator SVG(마커·경로) + 동일 viewport Static Map */
export async function fetchNaverStaticMapWithRoadRoutes(
  markerGroups: { markers: StaticMapMarker[]; color: string }[],
  width = DEFAULT_MAP_WIDTH,
  height = DEFAULT_MAP_HEIGHT,
  options?: { linkDays?: boolean },
): Promise<NaverStaticMapResult> {
  const flatMarkers = markerGroups.flatMap((g) => g.markers).slice(0, 20);
  const empty: NaverStaticMapResult = {
    mapDataUrl: null,
    routeOverlays: [],
    markerOverlays: [],
    mapWidth: width,
    mapHeight: height,
    usedRoadRoute: false,
  };

  if (flatMarkers.length === 0) return empty;

  const routePaths: { path: [number, number][]; color: string; usedRoad: boolean }[] = [];

  for (const group of markerGroups) {
    if (group.markers.length < 2) continue;
    const coords = group.markers.map((m) => ({ lng: m.lng, lat: m.lat }));
    await appendRoutePath(routePaths, coords, group.color);
  }

  if (options?.linkDays !== false && markerGroups.length > 1) {
    await appendInterDayRoutePaths(markerGroups, routePaths);
  }

  const viewport = computeMapViewport(
    collectBoundsPoints(flatMarkers, routePaths.map((r) => r.path)),
    width,
    height,
    52,
  );

  const displayMarkers = spreadStaticMapMarkersForDisplay(flatMarkers);
  const buffer = await fetchStaticMapBuffer(width, height, viewport, displayMarkers);
  if (!buffer) return empty;

  const routeOverlays =
    routePaths.length > 0
      ? routePaths.map((r) => ({
          points: pathToSvgPoints(r.path, viewport, width, height),
          color: r.color,
          width,
          height,
        }))
      : [];

  const markerOverlays = markersToMercatorOverlayPoints(
    displayMarkers.map((m) => ({
      lat: m.lat,
      lng: m.lng,
      label: m.label,
      color: m.color,
    })),
    viewport,
    width,
    height,
  );

  return {
    mapDataUrl: bufferToDataUrl(buffer),
    routeOverlays,
    markerOverlays,
    mapWidth: width,
    mapHeight: height,
    usedRoadRoute: routePaths.some((r) => r.usedRoad),
  };
}

export async function fetchNaverDayMapWithRoadRoute(
  markers: StaticMapMarker[],
  color: string,
  width = DEFAULT_MAP_WIDTH,
  height = DEFAULT_MAP_HEIGHT,
): Promise<NaverStaticMapResult> {
  return fetchNaverStaticMapWithRoadRoutes([{ markers, color }], width, height);
}
