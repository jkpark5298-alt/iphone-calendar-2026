export type MapViewport = {
  centerLng: number;
  centerLat: number;
  level: number;
};

export type LatLngBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type MapOverlayPoint = {
  x: number;
  y: number;
  label: string;
  color: string;
};

const TILE_SIZE = 256;

function levelScale(level: number): number {
  return 2 ** level;
}

function lngToWorldX(lng: number, scale: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * scale;
}

function latToWorldY(lat: number, scale: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return y * TILE_SIZE * scale;
}

function worldXToLng(x: number, level: number): number {
  const scale = levelScale(level);
  return (x / (TILE_SIZE * scale)) * 360 - 180;
}

function worldYToLat(y: number, level: number): number {
  const scale = levelScale(level);
  const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * scale);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function projectToWorld(lng: number, lat: number, level: number): { x: number; y: number } {
  const scale = levelScale(level);
  return { x: lngToWorldX(lng, scale), y: latToWorldY(lat, scale) };
}

/** Naver Static Map auto-fit과 맞추기 위한 선형(위경도) 오버레이 */
export function computeLinearMapBounds(
  points: { lat: number; lng: number }[],
  paddingRatio = 0.1,
): LatLngBounds {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);

  const latSpan = Math.max(maxLat - minLat, 0.008);
  const lngSpan = Math.max(maxLng - minLng, 0.008);
  const latPad = latSpan * paddingRatio;
  const lngPad = lngSpan * paddingRatio;

  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

export function latLngToLinearPixel(
  lat: number,
  lng: number,
  bounds: LatLngBounds,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const lngSpan = bounds.maxLng - bounds.minLng || 0.001;
  const latSpan = bounds.maxLat - bounds.minLat || 0.001;
  return {
    x: ((lng - bounds.minLng) / lngSpan) * mapWidth,
    y: ((bounds.maxLat - lat) / latSpan) * mapHeight,
  };
}

export function simplifyPath(path: [number, number][], maxPoints = 500): [number, number][] {
  if (path.length <= maxPoints) return path;
  const step = Math.ceil(path.length / maxPoints);
  const result: [number, number][] = [];
  for (let i = 0; i < path.length; i += step) {
    result.push(path[i]);
  }
  const last = path[path.length - 1];
  const tail = result[result.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) {
    result.push(last);
  }
  return result;
}

export function pathToLinearSvgPoints(
  path: [number, number][],
  bounds: LatLngBounds,
  mapWidth: number,
  mapHeight: number,
): string {
  return simplifyPath(path)
    .map(([lng, lat]) => {
      const { x, y } = latLngToLinearPixel(lat, lng, bounds, mapWidth, mapHeight);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function markersToLinearOverlayPoints(
  markers: { lat: number; lng: number; label: string; color: string }[],
  bounds: LatLngBounds,
  mapWidth: number,
  mapHeight: number,
): MapOverlayPoint[] {
  return markers.map((m) => {
    const { x, y } = latLngToLinearPixel(m.lat, m.lng, bounds, mapWidth, mapHeight);
    return { x, y, label: m.label, color: m.color };
  });
}

// --- Mercator (Naver Static Map center+level 과 동일 좌표계) ---

export function latLngToPixel(
  lat: number,
  lng: number,
  viewport: MapViewport,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const scale = levelScale(viewport.level);
  const worldX = lngToWorldX(lng, scale);
  const worldY = latToWorldY(lat, scale);
  const centerX = lngToWorldX(viewport.centerLng, scale);
  const centerY = latToWorldY(viewport.centerLat, scale);
  return {
    x: mapWidth / 2 + (worldX - centerX),
    y: mapHeight / 2 + (worldY - centerY),
  };
}

/** Mercator 월드 좌표 기준 fitBounds — 위경도 bbox 대신 전체 포인트 투영 */
export function computeMapViewport(
  points: { lat: number; lng: number }[],
  mapWidth: number,
  mapHeight: number,
  padding = 56,
): MapViewport {
  if (points.length === 0) {
    return { centerLat: 37.5665, centerLng: 126.978, level: 10 };
  }

  const usableWidth = Math.max(mapWidth - padding * 2, 64);
  const usableHeight = Math.max(mapHeight - padding * 2, 64);
  const mapAspect = usableWidth / usableHeight;

  for (let level = 20; level >= 0; level -= 1) {
    const projected = points.map((p) => projectToWorld(p.lng, p.lat, level));
    let minX = Math.min(...projected.map((p) => p.x));
    let maxX = Math.max(...projected.map((p) => p.x));
    let minY = Math.min(...projected.map((p) => p.y));
    let maxY = Math.max(...projected.map((p) => p.y));

    let spanX = maxX - minX;
    let spanY = maxY - minY;
    const minWorldSpan = Math.max(usableWidth, usableHeight) * 0.12;
    spanX = Math.max(spanX, minWorldSpan);
    spanY = Math.max(spanY, minWorldSpan);

    if (spanX / spanY < mapAspect) {
      spanX = spanY * mapAspect;
    } else {
      spanY = spanX / mapAspect;
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    minX = centerX - spanX / 2;
    maxX = centerX + spanX / 2;
    minY = centerY - spanY / 2;
    maxY = centerY + spanY / 2;

    if (spanX > usableWidth || spanY > usableHeight) continue;

    const centerLng = worldXToLng(centerX, level);
    const centerLat = worldYToLat(centerY, level);
    const viewport: MapViewport = { centerLng, centerLat, level };

    const fits = points.every((p) => {
      const px = latLngToPixel(p.lat, p.lng, viewport, mapWidth, mapHeight);
      return (
        px.x >= padding &&
        px.x <= mapWidth - padding &&
        px.y >= padding &&
        px.y <= mapHeight - padding
      );
    });

    if (fits) return viewport;
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    centerLat: (Math.min(...lats) + Math.max(...lats)) / 2,
    centerLng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    level: 6,
  };
}

export function markersToMercatorOverlayPoints(
  markers: { lat: number; lng: number; label: string; color: string }[],
  viewport: MapViewport,
  mapWidth: number,
  mapHeight: number,
): MapOverlayPoint[] {
  return markers.map((m) => {
    const { x, y } = latLngToPixel(m.lat, m.lng, viewport, mapWidth, mapHeight);
    return { x, y, label: m.label, color: m.color };
  });
}

export function pathToSvgPoints(
  path: [number, number][],
  viewport: MapViewport,
  mapWidth: number,
  mapHeight: number,
): string {
  return simplifyPath(path)
    .map(([lng, lat]) => {
      const { x, y } = latLngToPixel(lat, lng, viewport, mapWidth, mapHeight);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
