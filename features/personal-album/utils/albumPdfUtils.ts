import { jsPDF } from "jspdf";
import type { SavedTravelAlbum } from "./chapter3SavedAlbumUtils";
import { countAlbumPhotos, getAlbumDateRangeText } from "./chapter3SavedAlbumUtils";
import { photoDisplayUrl } from "./chapter3AlbumSyncUtils";
import { sortAlbumPhotos } from "./albumPhotoOrderUtils";
import { resolveAlbumPlaceDescription, type Chapter3AlbumDay } from "./chapter3Utils";
import { composeOsmTileMapInBrowser } from "./osmTileMapUtils";

type AlbumDayMapBlock = {
  day: number;
  kind: "photo" | "place";
  title: string;
  mapDataUrl: string | null;
  mapError?: string;
  routeOverlays?: { points: string; color: string; width: number; height: number }[];
  markerOverlays?: { x: number; y: number; label: string; color: string }[];
  mapWidth?: number;
  mapHeight?: number;
};

type DrawnText = {
  dataUrl: string;
  widthMm: number;
  heightMm: number;
};

function slimDaysForMapApi(days: Chapter3AlbumDay[]) {
  return days.map((day) => ({
    day: day.day,
    dateLabel: day.dateLabel,
    places: day.places.map((place) => ({
      name: place.name || "",
      address: place.address || "",
    })),
    photos: sortAlbumPhotos(day.places.flatMap((place) => place.photos)).map((photo) => ({
      id: photo.id,
      lat: photo.exifLat,
      lng: photo.exifLng,
    })),
  }));
}

function safeFileName(title: string): string {
  const base = (title || "여행앨범").replace(/[\\/:*?"<>|]+/g, "_").trim() || "여행앨범";
  return `${base}.pdf`;
}

/** jsPDF 기본 폰트는 한글 미지원 → 캔버스로 래스터화 */
function drawTextImage(
  text: string,
  opts: {
    fontSizePx: number;
    maxWidthPx: number;
    color?: string;
    fontWeight?: "normal" | "bold";
    lineHeight?: number;
  },
): DrawnText | null {
  const value = text?.trim();
  if (!value) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const weight = opts.fontWeight || "normal";
  const font = `${weight} ${opts.fontSizePx}px "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif`;
  ctx.font = font;
  const lineHeight = opts.lineHeight || opts.fontSizePx * 1.35;

  const words = value.split("");
  const lines: string[] = [];
  let current = "";
  for (const ch of words) {
    if (ch === "\n") {
      lines.push(current);
      current = "";
      continue;
    }
    const next = current + ch;
    if (ctx.measureText(next).width > opts.maxWidthPx && current) {
      lines.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  const width = Math.ceil(
    Math.min(opts.maxWidthPx, Math.max(...lines.map((line) => ctx.measureText(line).width), 1)),
  );
  const height = Math.ceil(lines.length * lineHeight + 4);
  canvas.width = width + 4;
  canvas.height = height;
  ctx.font = font;
  ctx.fillStyle = opts.color || "#0f172a";
  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    ctx.fillText(line, 2, 2 + index * lineHeight);
  });

  // px → mm (96dpi 가정)
  const pxToMm = 25.4 / 96;
  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthMm: canvas.width * pxToMm,
    heightMm: canvas.height * pxToMm,
  };
}

function addTextBlock(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  opts: {
    fontSizePx: number;
    maxWidthMm: number;
    color?: string;
    fontWeight?: "normal" | "bold";
  },
): number {
  const maxWidthPx = Math.max(40, Math.round((opts.maxWidthMm * 96) / 25.4));
  const drawn = drawTextImage(text, {
    fontSizePx: opts.fontSizePx,
    maxWidthPx,
    color: opts.color,
    fontWeight: opts.fontWeight,
  });
  if (!drawn) return y;
  const drawW = Math.min(opts.maxWidthMm, drawn.widthMm);
  const drawH = drawn.heightMm * (drawW / drawn.widthMm);
  doc.addImage(drawn.dataUrl, "PNG", x, y, drawW, drawH, undefined, "FAST");
  return y + drawH + 1.5;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

type OrientedPhoto = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number) => void;
  dispose?: () => void;
};

/** iPhone EXIF Orientation을 반영한 실제 표시 크기·그리기 */
async function loadOrientedPhoto(src: string): Promise<OrientedPhoto | null> {
  if (!src) return null;

  try {
    const response = await fetch(src, { mode: "cors" });
    if (response.ok) {
      const blob = await response.blob();
      if (typeof createImageBitmap === "function") {
        try {
          const bitmap = await createImageBitmap(blob, {
            // iOS·Safari: 회전 메타 적용 → 가로/세로 비율 정상화
            imageOrientation: "from-image",
          } as ImageBitmapOptions);
          return {
            width: bitmap.width,
            height: bitmap.height,
            draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bitmap, dx, dy, dw, dh),
            dispose: () => bitmap.close(),
          };
        } catch {
          /* fallback below */
        }
      }
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = await loadImage(objectUrl);
        if (img) {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (width > 0 && height > 0) {
            return {
              width,
              height,
              draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(img, dx, dy, dw, dh),
            };
          }
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  } catch {
    /* CORS 등으로 fetch 실패 시 Image 직접 로드 */
  }

  const img = await loadImage(src);
  if (!img) return null;
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(img, dx, dy, dw, dh),
  };
}

/** 일자별 지도 마커 번호 = GPS 사진의 sortAlbumPhotos 순번 */
function buildDayMapPhotoNumbers(day: Chapter3AlbumDay): Map<string, number> {
  const gpsPhotos = sortAlbumPhotos(day.places.flatMap((place) => place.photos)).filter(
    (photo) =>
      typeof photo.exifLat === "number" &&
      Number.isFinite(photo.exifLat) &&
      typeof photo.exifLng === "number" &&
      Number.isFinite(photo.exifLng),
  );
  const map = new Map<string, number>();
  gpsPhotos.forEach((photo, index) => {
    map.set(photo.id, index + 1);
  });
  return map;
}

/**
 * PDF용 사진 래스터 — EXIF 방향 보정 + 원본 비율 contain
 * 셀은 사진 비율에 맞추되 최대 가로·세로 안에 맞춤 (늘리지 않음)
 */
async function rasterizeAlbumPhotoForPdf(
  src: string,
  cellWmm: number,
  maxHmm: number,
): Promise<{ dataUrl: string; widthMm: number; heightMm: number } | null> {
  const oriented = await loadOrientedPhoto(src);
  if (!oriented) return null;

  try {
    const aspect = oriented.width / Math.max(1, oriented.height);
    let widthMm = cellWmm;
    let heightMm = widthMm / aspect;
    if (heightMm > maxHmm) {
      heightMm = maxHmm;
      widthMm = heightMm * aspect;
    }
    if (widthMm > cellWmm) {
      widthMm = cellWmm;
      heightMm = widthMm / aspect;
    }

    const pxPerMm = 8;
    const canvasW = Math.max(120, Math.round(widthMm * pxPerMm));
    const canvasH = Math.max(120, Math.round(heightMm * pxPerMm));
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, 0, canvasW, canvasH);

    const scale = Math.min(canvasW / oriented.width, canvasH / oriented.height);
    const dw = oriented.width * scale;
    const dh = oriented.height * scale;
    const dx = (canvasW - dw) / 2;
    const dy = (canvasH - dh) / 2;
    oriented.draw(ctx, dx, dy, dw, dh);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.88),
      widthMm,
      heightMm,
    };
  } finally {
    oriented.dispose?.();
  }
}

/** 캡션: 지도 번호는 빨간색, 나머지는 회색 */
function addPhotoCaption(
  doc: jsPDF,
  x: number,
  y: number,
  maxWidthMm: number,
  mapNumber: number | undefined,
  restText: string,
): number {
  const rest = restText.trim();
  if (typeof mapNumber !== "number" || mapNumber <= 0) {
    if (!rest) return y;
    return addTextBlock(doc, rest, x, y, {
      fontSizePx: 11,
      maxWidthMm,
      color: "#475569",
    });
  }

  const prefix = `${mapNumber}. `;
  const maxWidthPx = Math.max(40, Math.round((maxWidthMm * 96) / 25.4));
  const numDrawn = drawTextImage(prefix, {
    fontSizePx: 12,
    maxWidthPx,
    color: "#dc2626",
    fontWeight: "bold",
  });
  if (!numDrawn) {
    return rest
      ? addTextBlock(doc, rest, x, y, {
          fontSizePx: 11,
          maxWidthMm,
          color: "#475569",
        })
      : y;
  }

  const numW = Math.min(maxWidthMm, numDrawn.widthMm);
  const numH = numDrawn.heightMm * (numW / numDrawn.widthMm);
  doc.addImage(numDrawn.dataUrl, "PNG", x, y, numW, numH, undefined, "FAST");

  if (!rest) return y + numH + 1.5;

  const restMaxMm = Math.max(8, maxWidthMm - numW);
  const restDrawn = drawTextImage(rest, {
    fontSizePx: 11,
    maxWidthPx: Math.max(40, Math.round((restMaxMm * 96) / 25.4)),
    color: "#475569",
  });
  if (!restDrawn) return y + numH + 1.5;

  const restW = Math.min(restMaxMm, restDrawn.widthMm);
  const restH = restDrawn.heightMm * (restW / restDrawn.widthMm);
  doc.addImage(restDrawn.dataUrl, "PNG", x + numW, y, restW, restH, undefined, "FAST");
  return y + Math.max(numH, restH) + 1.5;
}

function parsePolylinePoints(points: string): { x: number; y: number }[] {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

async function rasterizeMapBlock(block: AlbumDayMapBlock): Promise<string | null> {
  if (!block.mapDataUrl) return null;
  const hasOverlay = Boolean(block.routeOverlays?.length || block.markerOverlays?.length);
  if (!hasOverlay) return block.mapDataUrl;

  const w = block.mapWidth || 1024;
  const h = block.mapHeight || 640;
  const img = await loadImage(block.mapDataUrl);
  if (!img) return block.mapDataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return block.mapDataUrl;

  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  for (const overlay of block.routeOverlays || []) {
    const pts = parsePolylinePoints(overlay.points);
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = overlay.color || "#16a34a";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  for (const marker of block.markerOverlays || []) {
    const label = (marker.label || "").slice(0, 2);
    const color = marker.color || "#dc2626";
    ctx.save();
    ctx.translate(marker.x, marker.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-12, -18, -12, -36, 0, -36);
    ctx.bezierCurveTo(12, -36, 12, -18, 0, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Malgun Gothic, Apple SD Gothic Neo, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, -22);
    ctx.restore();
  }

  return canvas.toDataURL("image/jpeg", 0.86);
}

async function fetchAlbumMaps(album: SavedTravelAlbum): Promise<AlbumDayMapBlock[]> {
  let maps: AlbumDayMapBlock[] = [];
  try {
    const response = await fetch("/api/album-map-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        days: slimDaysForMapApi(album.days),
        regionHint: album.sourceLabel || album.title,
      }),
    });
    const data = (await response.json()) as {
      ok?: boolean;
      maps?: AlbumDayMapBlock[];
    };
    if (response.ok && data.ok && Array.isArray(data.maps)) maps = data.maps;
  } catch (error) {
    console.warn("album-map-pdf fetch failed", error);
  }
  return fillMissingMapsInBrowser(album, maps);
}

/** 네이버 Static Map 실패 시 브라우저에서 OSM 타일로 지도 생성 */
async function fillMissingMapsInBrowser(
  album: SavedTravelAlbum,
  maps: AlbumDayMapBlock[],
): Promise<AlbumDayMapBlock[]> {
  const next = [...maps];

  for (const day of album.days) {
    const gpsPhotos = sortAlbumPhotos(day.places.flatMap((place) => place.photos)).filter(
      (photo) =>
        typeof photo.exifLat === "number" &&
        Number.isFinite(photo.exifLat) &&
        typeof photo.exifLng === "number" &&
        Number.isFinite(photo.exifLng),
    );

    const photoIdx = next.findIndex((m) => m.day === day.day && m.kind === "photo");
    const photoBlock = photoIdx >= 0 ? next[photoIdx] : null;
    if (gpsPhotos.length > 0 && !photoBlock?.mapDataUrl) {
      const mapDataUrl = await composeOsmTileMapInBrowser(
        gpsPhotos.map((photo, index) => ({
          lat: photo.exifLat as number,
          lng: photo.exifLng as number,
          label: String(index + 1),
          color: "#dc2626",
        })),
        800,
        500,
      );
      const block: AlbumDayMapBlock = {
        day: day.day,
        kind: "photo",
        title: "사진 촬영 위치 지도",
        mapDataUrl,
        mapError: mapDataUrl ? undefined : photoBlock?.mapError || "지도를 만들지 못했습니다.",
      };
      if (photoIdx >= 0) next[photoIdx] = block;
      else next.push(block);
    }
  }

  return next;
}

function ensureSpace(doc: jsPDF, y: number, need: number, margin: number, pageH: number): number {
  if (y + need <= pageH - margin) return y;
  doc.addPage();
  return margin;
}

async function buildTravelAlbumPdfBlob(album: SavedTravelAlbum): Promise<Blob> {
  const maps = await fetchAlbumMaps(album);
  const mapsByDay = new Map<number, AlbumDayMapBlock[]>();
  for (const block of maps) {
    const list = mapsByDay.get(block.day) || [];
    list.push(block);
    mapsByDay.set(block.day, list);
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = margin;

  const photoCount = countAlbumPhotos(album.days);
  const dateRange = getAlbumDateRangeText(album.days);

  y = addTextBlock(doc, album.title || "여행 앨범", margin, y, {
    fontSizePx: 28,
    maxWidthMm: contentW,
    fontWeight: "bold",
  });
  y = addTextBlock(
    doc,
    `${dateRange} · 사진 ${photoCount}장 · ${album.status === "draft" ? "작업 중" : "확정"} · ${album.days.length}일`,
    margin,
    y,
    { fontSizePx: 13, maxWidthMm: contentW, color: "#64748b" },
  );
  y += 4;

  for (const day of album.days) {
    y = ensureSpace(doc, y, 16, margin, pageH);
    y = addTextBlock(doc, `${day.day}일차 · ${day.dateLabel || ""}`, margin, y, {
      fontSizePx: 20,
      maxWidthMm: contentW,
      fontWeight: "bold",
      color: "#0369a1",
    });

    const dayMaps = [
      ...(mapsByDay.get(day.day) || []).filter((m) => m.kind === "place"),
      ...(mapsByDay.get(day.day) || []).filter((m) => m.kind === "photo"),
    ];
    const mapPhotoNumbers = buildDayMapPhotoNumbers(day);

    for (const block of dayMaps) {
      const raster = await rasterizeMapBlock(block);
      if (!raster) {
        if (block.mapError) {
          y = ensureSpace(doc, y, 10, margin, pageH);
          y = addTextBlock(doc, `${block.title}: ${block.mapError}`, margin, y, {
            fontSizePx: 12,
            maxWidthMm: contentW,
            color: "#64748b",
          });
        }
        continue;
      }

      const mapH = Math.min(92, contentW * 0.62);
      y = ensureSpace(doc, y, mapH + 14, margin, pageH);
      y = addTextBlock(doc, block.title, margin, y, {
        fontSizePx: 14,
        maxWidthMm: contentW,
        fontWeight: "bold",
      });
      try {
        const format = raster.startsWith("data:image/png") ? "PNG" : "JPEG";
        doc.addImage(raster, format, margin, y, contentW, mapH, undefined, "FAST");
        y += mapH + 8;
      } catch (error) {
        console.warn("map addImage failed", error);
        y += 4;
      }
    }

    for (const place of day.places) {
      y = ensureSpace(doc, y, 14, margin, pageH);
      y = addTextBlock(doc, place.name || "장소", margin, y, {
        fontSizePx: 16,
        maxWidthMm: contentW,
        fontWeight: "bold",
      });

      if (place.address?.trim()) {
        y = ensureSpace(doc, y, 8, margin, pageH);
        y = addTextBlock(doc, `주소: ${place.address}`, margin, y, {
          fontSizePx: 12,
          maxWidthMm: contentW,
          color: "#475569",
        });
      }
      const placeDescription = resolveAlbumPlaceDescription(place, day);
      if (placeDescription) {
        y = ensureSpace(doc, y, 8, margin, pageH);
        y = addTextBlock(doc, placeDescription, margin, y, {
          fontSizePx: 12,
          maxWidthMm: contentW,
          color: "#475569",
        });
      }

      const photos = sortAlbumPhotos(place.photos);
      const colGap = 4;
      const cols = 2;
      const cellW = (contentW - colGap * (cols - 1)) / cols;
      const maxPhotoH = 58;

      for (let i = 0; i < photos.length; i += cols) {
        const row = photos.slice(i, i + cols);
        const rendered: {
          photo: (typeof photos)[number];
          x: number;
          raster: { dataUrl: string; widthMm: number; heightMm: number } | null;
          mapNumber?: number;
        }[] = [];

        let rowImgH = 0;
        for (let c = 0; c < row.length; c++) {
          const photo = row[c];
          const src = photoDisplayUrl(photo);
          const mapNumber = mapPhotoNumbers.get(photo.id);
          const raster = src
            ? await rasterizeAlbumPhotoForPdf(src, cellW, maxPhotoH)
            : null;
          if (raster) rowImgH = Math.max(rowImgH, raster.heightMm);
          rendered.push({
            photo,
            x: margin + c * (cellW + colGap),
            raster,
            mapNumber,
          });
        }

        y = ensureSpace(doc, y, rowImgH + 22, margin, pageH);
        const imgY = y;
        let metaMaxY = imgY + rowImgH + 2;

        for (const item of rendered) {
          if (item.raster) {
            try {
              // 셀 가로 중앙에 원본 비율 이미지 배치 (가로로 늘리지 않음)
              const drawX = item.x + (cellW - item.raster.widthMm) / 2;
              doc.addImage(
                item.raster.dataUrl,
                "JPEG",
                drawX,
                imgY,
                item.raster.widthMm,
                item.raster.heightMm,
                undefined,
                "FAST",
              );
            } catch (error) {
              console.warn("photo addImage failed", error);
            }
          }

          let metaY = imgY + (item.raster?.heightMm || rowImgH) + 2;
          const memo = (item.photo.memo || "").trim();
          const placeName = item.photo.exifPlaceName?.trim();
          const rest = memo || placeName || item.photo.exifDateTime || "";
          if (typeof item.mapNumber === "number" || rest) {
            metaY = addPhotoCaption(doc, item.x, metaY, cellW, item.mapNumber, rest);
          }
          metaMaxY = Math.max(metaMaxY, metaY + 2);
        }

        y = metaMaxY + 2;
      }

      y += 3;
    }
  }

  return doc.output("blob");
}

async function sharePdfFile(file: File): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  if (typeof nav.share !== "function") return false;
  const data: ShareData = { files: [file], title: file.name, text: file.name };
  if (typeof nav.canShare === "function" && !nav.canShare(data)) return false;
  try {
    await nav.share(data);
    return true;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return true;
    console.warn("navigator.share failed", error);
    return false;
  }
}

function downloadPdfBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function openPdfActionWindow(blob: Blob, fileName: string): Window | null {
  const url = URL.createObjectURL(blob);
  const win = window.open("about:blank", "_blank", "width=480,height=420");
  if (!win) {
    URL.revokeObjectURL(url);
    return null;
  }
  try {
    win.opener = null;
  } catch {
    /* ignore */
  }

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${fileName}</title>
  <style>
    body { font-family: "Apple SD Gothic Neo","Malgun Gothic",sans-serif; margin: 0; padding: 28px 20px; color: #0f172a; background: #f8fafc; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 13px; line-height: 1.55; color: #475569; margin: 0 0 18px; }
    .actions { display: grid; gap: 10px; }
    a, button {
      display: block; width: 100%; box-sizing: border-box; text-align: center;
      border: none; border-radius: 10px; padding: 14px 12px; font-size: 15px; font-weight: 700;
      text-decoration: none; cursor: pointer;
    }
    .primary { background: #2563eb; color: #fff; }
    .secondary { background: #e2e8f0; color: #0f172a; }
  </style>
</head>
<body>
  <h1>여행 앨범 PDF 준비 완료</h1>
  <p>아이폰에서는 <strong>공유 → GoodNotes(굿노트)</strong>를 선택하세요.<br/>PC에서는 파일을 저장한 뒤 굿노트로 가져오면 됩니다.</p>
  <div class="actions">
    <button type="button" class="primary" id="shareBtn">공유 (굿노트 등)</button>
    <a class="secondary" id="downloadLink" href="${url}" download="${fileName}">PDF 파일 저장</a>
    <a class="secondary" href="${url}" target="_blank" rel="noopener">PDF 열기</a>
  </div>
  <script>
    const fileUrl = ${JSON.stringify(url)};
    const fileName = ${JSON.stringify(fileName)};
    document.getElementById("shareBtn").addEventListener("click", async function () {
      try {
        const res = await fetch(fileUrl);
        const blob = await res.blob();
        const file = new File([blob], fileName, { type: "application/pdf" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: fileName });
          return;
        }
        alert("이 기기에서는 공유 시트를 열 수 없습니다. 「PDF 파일 저장」을 사용해 주세요.");
      } catch (e) {
        if (e && e.name === "AbortError") return;
        alert("공유에 실패했습니다. 「PDF 파일 저장」 후 굿노트에서 가져와 주세요.");
      }
    });
  </script>
</body>
</html>`);
  win.document.close();
  window.setTimeout(() => URL.revokeObjectURL(url), 300_000);
  return win;
}

/**
 * 실제 PDF 파일을 만들어 공유/저장합니다.
 * 인쇄 HTML은 굿노트로 전송되지 않으므로 File Share / 다운로드를 사용합니다.
 */
export async function openTravelAlbumPdfWindow(album: SavedTravelAlbum): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const blob = await buildTravelAlbumPdfBlob(album);
    const fileName = safeFileName(album.title);
    const file = new File([blob], fileName, { type: "application/pdf" });

    const shared = await sharePdfFile(file);
    if (shared) return true;

    const actionWin = openPdfActionWindow(blob, fileName);
    if (actionWin) return true;

    downloadPdfBlob(blob, fileName);
    return true;
  } catch (error) {
    console.error("openTravelAlbumPdfWindow failed", error);
    window.alert("PDF를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return false;
  }
}
