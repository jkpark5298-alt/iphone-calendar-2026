/**
 * API 키 없이 OSM/Carto 타일을 합성해 PDF용 정적 지도를 만듭니다.
 * (네이버 Static Map 실패·미구독 시 국내/해외 공통 폴백)
 */

export type OsmTileMarker = {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
};

type TilePlacement = { z: number; x: number; y: number; left: number; top: number };

type MapLayout = {
  width: number;
  height: number;
  zoom: number;
  tiles: TilePlacement[];
  markers: { x: number; y: number; label: string; color: string }[];
};

const TILE_SIZE = 256;
const TILE_SUBDOMAINS = ["a", "b", "c", "d"] as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToWorldY(lat: number, zoom: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return y * TILE_SIZE * 2 ** zoom;
}

function estimateZoom(markers: OsmTileMarker[], width: number, height: number): number {
  if (markers.length <= 1) return 14;
  const lats = markers.map((m) => m.lat);
  const lngs = markers.map((m) => m.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  for (let z = 16; z >= 3; z--) {
    const pad = 48;
    const spanX = lngToWorldX(maxLng, z) - lngToWorldX(minLng, z);
    const spanY = latToWorldY(minLat, z) - latToWorldY(maxLat, z);
    if (spanX + pad * 2 <= width && spanY + pad * 2 <= height) return z;
  }
  return 3;
}

export function buildOsmTileLayout(
  markers: OsmTileMarker[],
  width = 800,
  height = 500,
): MapLayout | null {
  if (markers.length === 0) return null;
  const w = clamp(Math.round(width), 200, 1280);
  const h = clamp(Math.round(height), 200, 1280);
  const zoom = estimateZoom(markers, w, h);
  const lats = markers.map((m) => m.lat);
  const lngs = markers.map((m) => m.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const centerX = lngToWorldX(centerLng, zoom);
  const centerY = latToWorldY(centerLat, zoom);
  const originX = centerX - w / 2;
  const originY = centerY - h / 2;

  const minTileX = Math.floor(originX / TILE_SIZE);
  const maxTileX = Math.floor((originX + w) / TILE_SIZE);
  const minTileY = Math.floor(originY / TILE_SIZE);
  const maxTileY = Math.floor((originY + h) / TILE_SIZE);
  const maxIndex = 2 ** zoom - 1;

  const tiles: TilePlacement[] = [];
  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) {
      if (y < 0 || y > maxIndex) continue;
      const wrappedX = ((x % (maxIndex + 1)) + (maxIndex + 1)) % (maxIndex + 1);
      tiles.push({
        z: zoom,
        x: wrappedX,
        y,
        left: Math.round(x * TILE_SIZE - originX),
        top: Math.round(y * TILE_SIZE - originY),
      });
    }
  }

  return {
    width: w,
    height: h,
    zoom,
    tiles,
    markers: markers.slice(0, 40).map((m, index) => ({
      x: lngToWorldX(m.lng, zoom) - originX,
      y: latToWorldY(m.lat, zoom) - originY,
      label: (m.label || String(index + 1)).slice(0, 2),
      color: m.color || "#dc2626",
    })),
  };
}

export function osmTileUrl(z: number, x: number, y: number): string {
  const sub = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
  // Carto CDN — CORS·가용성 양호 (키 불필요)
  return `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  markers: MapLayout["markers"],
): void {
  for (const marker of markers) {
    ctx.save();
    ctx.translate(marker.x, marker.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-11, -16, -11, -32, 0, -32);
    ctx.bezierCurveTo(11, -32, 11, -16, 0, 0);
    ctx.closePath();
    ctx.fillStyle = marker.color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(marker.label, 0, -20);
    ctx.restore();
  }
}

/** 브라우저(PDF 생성)용 — canvas에 타일·마커 합성 */
export async function composeOsmTileMapInBrowser(
  markers: OsmTileMarker[],
  width = 800,
  height = 500,
): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const layout = buildOsmTileLayout(markers, width, height);
  if (!layout) return null;

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#dbe4ee";
  ctx.fillRect(0, 0, layout.width, layout.height);

  await Promise.all(
    layout.tiles.map(
      (tile) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            try {
              ctx.drawImage(img, tile.left, tile.top, TILE_SIZE, TILE_SIZE);
            } catch {
              /* ignore */
            }
            resolve();
          };
          img.onerror = () => resolve();
          img.src = osmTileUrl(tile.z, tile.x, tile.y);
        }),
    ),
  );

  drawMarkers(ctx, layout.markers);
  return canvas.toDataURL("image/jpeg", 0.88);
}

/**
 * 서버용 — 타일을 받아 next/og 없이 data URL로 합치기 어려워
 * ImageBitmap이 없는 Node에서는 브라우저 폴백에 맡기거나,
 * 개별 타일 fetch 성공 여부만 확인 후 staticmap URL을 씁니다.
 * 실제 서버 합성은 fetchOsmStaticMapDataUrl → 타일 프록시 API를 사용합니다.
 */
export async function fetchOsmTilesAsDataUrls(
  layout: MapLayout,
): Promise<{ left: number; top: number; dataUrl: string }[]> {
  const out: { left: number; top: number; dataUrl: string }[] = [];
  for (const tile of layout.tiles.slice(0, 48)) {
    try {
      const response = await fetch(osmTileUrl(tile.z, tile.x, tile.y), {
        cache: "no-store",
        headers: {
          Accept: "image/png",
          "User-Agent": "travel-diary-album-pdf/1.0",
        },
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 100) continue;
      out.push({
        left: tile.left,
        top: tile.top,
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      });
    } catch {
      /* skip tile */
    }
  }
  return out;
}
