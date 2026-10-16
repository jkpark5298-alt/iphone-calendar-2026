import { composeOsmTileMapDataUrl } from "./osmTileMapServer";
import type { OsmTileMarker } from "./osmTileMapUtils";

/**
 * Google Static Maps 키가 없을 때 / 네이버 Static Map 실패 시 정적 지도
 */

export type OsmStaticMarker = OsmTileMarker;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function estimateZoom(
  markers: OsmStaticMarker[],
  width: number,
  height: number,
): number {
  if (markers.length <= 1) return 14;
  const lats = markers.map((m) => m.lat);
  const lngs = markers.map((m) => m.lng);
  const latSpan = Math.max(0.001, Math.max(...lats) - Math.min(...lats));
  const lngSpan = Math.max(0.001, Math.max(...lngs) - Math.min(...lngs));
  const latZoom = Math.log2(170 / latSpan);
  const lngZoom = Math.log2((360 * (width / height)) / lngSpan);
  return clamp(Math.floor(Math.min(latZoom, lngZoom)) - 1, 3, 16);
}

/** Nominatim 지오코딩 (서버 전용, User-Agent 필수) */
export async function geocodeWithNominatim(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q,
      format: "json",
      limit: "1",
    }).toString()}`;
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "travel-diary-album-pdf/1.0 (contact: travel-diary)",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { lat?: string; lon?: string }[];
    const hit = data?.[0];
    if (!hit?.lat || !hit?.lon) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * OpenStreetMap/Carto 정적 지도 이미지 (data URL).
 * 1) 타일 합성(안정) → 2) staticmap.openstreetmap.de
 */
export async function fetchOsmStaticMapDataUrl(
  markers: OsmStaticMarker[],
  width = 800,
  height = 500,
): Promise<string | null> {
  if (markers.length === 0) return null;

  const tiled = await composeOsmTileMapDataUrl(markers, width, height);
  if (tiled) return tiled;

  const lats = markers.map((m) => m.lat);
  const lngs = markers.map((m) => m.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const zoom = estimateZoom(markers, width, height);
  const w = clamp(Math.round(width), 200, 1024);
  const h = clamp(Math.round(height), 200, 1024);

  const markerParam = markers
    .slice(0, 25)
    .map((m) => `${m.lat},${m.lng},lightblue1`)
    .join("|");

  const candidates = [
    `https://staticmap.openstreetmap.de/staticmap.php?center=${centerLat},${centerLng}&zoom=${zoom}&size=${w}x${h}&maptype=mapnik&markers=${encodeURIComponent(markerParam)}`,
    `https://staticmap.openstreetmap.de/staticmap.php?center=${centerLat},${centerLng}&zoom=${zoom}&size=${w}x${h}&maptype=mapnik&markers=${centerLat},${centerLng},red-pushpin`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "image/*",
          "User-Agent": "travel-diary-album-pdf/1.0 (contact: travel-diary)",
        },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("image")) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 500) continue;
      const mime = contentType.split(";")[0] || "image/png";
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      /* try next */
    }
  }

  return null;
}
