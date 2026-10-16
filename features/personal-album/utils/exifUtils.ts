/** 사진 EXIF — 촬영 일시·GPS 좌표 추출 (JPEG + HEIC fallback) */

import { isKoreaCoordinates } from "./naverGeocodeUtils";

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i;

/** EXIF GPS 좌표 기준 국내(네이버) / 해외(구글) 판별 */
export function isDomesticPhotoLocation(lat: number, lng: number): boolean {
  return isKoreaCoordinates(lat, lng);
}

export function isAlbumImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT_RE.test(file.name || "");
}

export interface ImageExifInfo {
  dateTime?: string;
  /** EXIF 촬영 시각 epoch(ms) */
  takenAtMs?: number;
  lat?: number;
  lng?: number;
  locationLabel?: string;
  /** EXIF/IPTC/XMP에 들어 있는 텍스트 지명 */
  placeName?: string;
}

function readU16(view: DataView, offset: number, le: boolean): number {
  return view.getUint16(offset, le);
}

function readU32(view: DataView, offset: number, le: boolean): number {
  return view.getUint32(offset, le);
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

function parseRational(view: DataView, offset: number, le: boolean): number {
  const num = readU32(view, offset, le);
  const den = readU32(view, offset + 4, le);
  return den ? num / den : 0;
}

function dmsToDecimal(d: number, m: number, s: number, ref: string): number {
  let dec = d + m / 60 + s / 3600;
  if (ref === "S" || ref === "W") dec *= -1;
  return dec;
}

function parseExifRawDate(raw: string): { display?: string; ms?: number } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const parsed = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
    if (!Number.isNaN(parsed.getTime())) {
      return {
        display: parsed.toLocaleString("ko-KR", { hour12: false }),
        ms: parsed.getTime(),
      };
    }
  }
  const normalized = trimmed.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      display: parsed.toLocaleString("ko-KR", { hour12: false }),
      ms: parsed.getTime(),
    };
  }
  return { display: trimmed || undefined };
}

function applyExifDate(result: ImageExifInfo, raw: string, prefer: boolean) {
  const parsed = parseExifRawDate(raw);
  if (parsed.ms == null && !parsed.display) return;
  if (prefer || result.takenAtMs == null) {
    if (parsed.display) result.dateTime = parsed.display;
    if (parsed.ms != null) result.takenAtMs = parsed.ms;
  }
}

function parseIfd(
  view: DataView,
  ifdOffset: number,
  tiffStart: number,
  le: boolean,
): ImageExifInfo {
  const result: ImageExifInfo = {};
  if (ifdOffset < 0 || ifdOffset + 2 > view.byteLength) return result;

  const count = readU16(view, ifdOffset, le);
  let gpsIfdOffset = 0;
  let exifIfdOffset = 0;

  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;

    const tag = readU16(view, entry, le);
    const type = readU16(view, entry + 2, le);
    const count = readU32(view, entry + 4, le);
    const valueOffset = entry + 8;

    const readValueOffset = (): number => {
      if (type === 2) {
        const len = count;
        if (len <= 4) return valueOffset;
        return tiffStart + readU32(view, valueOffset, le);
      }
      if (count * (type === 5 ? 8 : type === 3 ? 2 : 4) <= 4) return valueOffset;
      return tiffStart + readU32(view, valueOffset, le);
    };

    if (tag === 0x0132 && type === 2) {
      const off = readValueOffset();
      applyExifDate(result, readAscii(view, off, count), false);
    }

    if (tag === 0x8769 && type === 4) {
      exifIfdOffset = tiffStart + readU32(view, valueOffset, le);
    }

    if (tag === 0x8825 && type === 4) {
      gpsIfdOffset = tiffStart + readU32(view, valueOffset, le);
    }
  }

  if (exifIfdOffset > 0 && exifIfdOffset + 2 <= view.byteLength) {
    const exifCount = readU16(view, exifIfdOffset, le);
    for (let i = 0; i < exifCount; i++) {
      const entry = exifIfdOffset + 2 + i * 12;
      if (entry + 12 > view.byteLength) break;
      const tag = readU16(view, entry, le);
      const type = readU16(view, entry + 2, le);
      const count = readU32(view, entry + 4, le);
      const valueOffset = entry + 8;
      if (type !== 2) continue;
      const off =
        count <= 4 ? valueOffset : tiffStart + readU32(view, valueOffset, le);
      const raw = readAscii(view, off, count);
      if (tag === 0x9003) applyExifDate(result, raw, true);
      else if (tag === 0x9004) applyExifDate(result, raw, false);
    }
  }

  if (gpsIfdOffset > 0) {
    const gpsCount = readU16(view, gpsIfdOffset, le);
    let latRef = "N";
    let lngRef = "E";
    let latParts: number[] = [];
    let lngParts: number[] = [];

    for (let i = 0; i < gpsCount; i++) {
      const entry = gpsIfdOffset + 2 + i * 12;
      if (entry + 12 > view.byteLength) break;
      const tag = readU16(view, entry, le);
      const type = readU16(view, entry + 2, le);
      const count = readU32(view, entry + 4, le);
      const valueOffset = entry + 8;
      const off =
        type === 2 && count <= 4
          ? valueOffset
          : type === 5 && count * 8 <= 4
            ? valueOffset
            : tiffStart + readU32(view, valueOffset, le);

      if (tag === 1 && type === 2) latRef = readAscii(view, off, 2) || "N";
      if (tag === 3 && type === 2) lngRef = readAscii(view, off, 2) || "E";
      if (tag === 2 && type === 5 && count >= 3) {
        latParts = [0, 1, 2].map((j) => parseRational(view, off + j * 8, le));
      }
      if (tag === 4 && type === 5 && count >= 3) {
        lngParts = [0, 1, 2].map((j) => parseRational(view, off + j * 8, le));
      }
    }

    if (latParts.length === 3 && lngParts.length === 3) {
      result.lat = dmsToDecimal(latParts[0], latParts[1], latParts[2], latRef);
      result.lng = dmsToDecimal(lngParts[0], lngParts[1], lngParts[2], lngRef);
      result.locationLabel = `${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
    }
  }

  return result;
}

function parseExifFromBuffer(buffer: ArrayBuffer): ImageExifInfo {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1 && size > 10) {
      const exifHeader = readAscii(view, offset + 4, 6);
      if (exifHeader === "Exif") {
        const tiffStart = offset + 10;
        const le = view.getUint16(tiffStart) === 0x4949;
        const ifd0 = tiffStart + readU32(view, tiffStart + 4, le);
        return parseIfd(view, ifd0, tiffStart, le);
      }
    }
    if (marker === 0xda) break;
    offset += 2 + size;
  }
  return {};
}

function pickExifTextPlace(parsed: Record<string, unknown>): string | undefined {
  const candidates = [
    parsed.Location,
    parsed.location,
    parsed.SubLocation,
    parsed.sublocation,
    parsed.City,
    parsed.city,
    parsed.ProvinceState,
    parsed.state,
    parsed.Country,
    parsed.country,
    parsed.CountryPrimaryLocationName,
    parsed.LocationCreated,
    parsed.LocationShown,
  ];

  const parts: string[] = [];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      const text = value.trim();
      if (!parts.includes(text)) parts.push(text);
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["name", "City", "city", "Location", "location", "Country", "country"]) {
        const nested = obj[key];
        if (typeof nested === "string" && nested.trim() && !parts.includes(nested.trim())) {
          parts.push(nested.trim());
        }
      }
    }
  }

  if (parts.length === 0) return undefined;
  return parts.slice(0, 3).join(", ");
}

async function readImageExifWithExifr(file: File): Promise<ImageExifInfo> {
  try {
    const exifr = await import("exifr");
    const parsed = (await exifr.parse(file, {
      gps: true,
      exif: true,
      iptc: true,
      xmp: true,
      ihdr: false,
      reviveValues: true,
      translateKeys: true,
    })) as Record<string, unknown> | null;
    if (!parsed) return {};

    const rawDate = parsed.DateTimeOriginal || parsed.CreateDate || parsed.ModifyDate;
    let dateTime: string | undefined;
    let takenAtMs: number | undefined;
    if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
      takenAtMs = rawDate.getTime();
      dateTime = rawDate.toLocaleString("ko-KR", { hour12: false });
    } else if (typeof rawDate === "string") {
      const parsedDate = parseExifRawDate(rawDate);
      dateTime = parsedDate.display;
      takenAtMs = parsedDate.ms;
    }

    const lat = typeof parsed.latitude === "number" ? parsed.latitude : undefined;
    const lng = typeof parsed.longitude === "number" ? parsed.longitude : undefined;
    const placeName = pickExifTextPlace(parsed);

    return {
      dateTime,
      takenAtMs,
      lat,
      lng,
      placeName,
      locationLabel:
        typeof lat === "number" && typeof lng === "number"
          ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
          : undefined,
    };
  } catch {
    return {};
  }
}

export async function readImageExif(file: File): Promise<ImageExifInfo> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || "");

  if (isHeic) {
    const fromExifr = await readImageExifWithExifr(file);
    if (fromExifr.dateTime || fromExifr.takenAtMs || fromExifr.lat !== undefined || fromExifr.placeName) {
      return fromExifr;
    }
  }

  try {
    const slice = file.slice(0, Math.min(file.size, 1024 * 1024));
    const buffer = await slice.arrayBuffer();
    const native = parseExifFromBuffer(buffer);
    if (native.dateTime || native.lat !== undefined) {
      const fromExifr = await readImageExifWithExifr(file);
      return {
        ...native,
        placeName: fromExifr.placeName || native.placeName,
        lat: native.lat ?? fromExifr.lat,
        lng: native.lng ?? fromExifr.lng,
        dateTime: fromExifr.dateTime || native.dateTime,
        takenAtMs: fromExifr.takenAtMs ?? native.takenAtMs,
        locationLabel: native.locationLabel || fromExifr.locationLabel,
      };
    }
    return readImageExifWithExifr(file);
  } catch {
    return readImageExifWithExifr(file);
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function isHeicLikeFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif")) return true;
  return /\.(heic|heif)$/i.test(file.name || "");
}

export { isHeicLikeFile };

async function convertHeicFileToJpegBlob(file: File, quality = 0.72): Promise<Blob | null> {
  try {
    const heic2any = (await import("heic2any")).default as (opts: {
      blob: Blob;
      toType?: string;
      quality?: number;
    }) => Promise<Blob | Blob[]>;
    const result = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality,
    });
    const blob = Array.isArray(result) ? result[0] : result;
    return blob instanceof Blob ? blob : null;
  } catch (error) {
    console.warn("heic convert failed", error);
    return null;
  }
}

/** 앨범 저장용 — 큰 사진은 JPEG로 압축해 localStorage 한도·표시 호환성 개선 */
export async function fileToAlbumDataUrl(file: File, maxDim = 1280, quality = 0.72): Promise<string> {
  let working: File | Blob = file;

  if (isHeicLikeFile(file)) {
    const jpeg = await convertHeicFileToJpegBlob(file, quality);
    if (jpeg) {
      working = jpeg;
    }
  }

  const raw = await readFileAsDataUrl(
    working instanceof File
      ? working
      : new File([working], (file.name || "photo").replace(/\.(heic|heif)$/i, ".jpg"), {
          type: "image/jpeg",
        }),
  );
  if (!raw.startsWith("data:")) return raw;

  // HEIC 변환 실패 시 — 미리보기 불가 포맷은 빈 JPEG 시도 대신 원본 반환하지 않음
  if (/^data:image\/(heic|heif)/i.test(raw)) {
    throw new Error("heic_preview_unsupported");
  }
  if (
    working instanceof Blob &&
    working.size < 350_000 &&
    /^data:image\/(jpeg|jpg|png|webp|gif)/i.test(raw)
  ) {
    return raw;
  }
  if (file.size < 350_000 && /^data:image\/(jpeg|jpg|png|webp|gif)/i.test(raw) && !isHeicLikeFile(file)) {
    return raw;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(raw);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(raw);
      }
    };
    img.onerror = () => resolve(raw);
    img.src = raw;
  });
}

/** GPS 좌표 문자열인지 (예: 37.56650, 126.97800) */
export function isGpsCoordinateLabel(text?: string | null): boolean {
  if (!text?.trim()) return false;
  const t = text.trim();
  return (
    /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(t) ||
    /^-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}$/.test(t)
  );
}

/** 사진에 저장된 EXIF 역지오코딩 지명 (좌표 문자열 제외) */
export function getPhotoExifPlaceName(photo: { exifPlaceName?: string }): string {
  const raw = photo.exifPlaceName?.trim() || "";
  if (isGpsCoordinateLabel(raw)) return "";
  return raw;
}

/** EXIF GPS → 역지오코딩 장소명 (좌표 대신 주소/지명만 반환) */
export async function resolveExifPlaceName(
  lat: number,
  lng: number,
  isDomestic?: boolean,
  timeoutMs = 18000,
): Promise<string | undefined> {
  const domestic = typeof isDomestic === "boolean" ? isDomestic : isDomesticPhotoLocation(lat, lng);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch("/api/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, isDomestic: domestic }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      const data = (await res.json()) as {
        ok?: boolean;
        placeName?: string;
        place?: string;
        fallback?: string;
      };
      const placeName = (data.placeName || data.place || "").trim();
      if (placeName && !isGpsCoordinateLabel(placeName) && data.ok !== false) {
        return placeName;
      }
    } catch {
      // retry
    }
    await new Promise((r) => window.setTimeout(r, 400 * (attempt + 1)));
  }

  // 실패 시 좌표를 장소명으로 쓰지 않음 → 백필에서 재시도
  return undefined;
}

export function buildMapEmbedUrl(lat: number, lng: number, isDomestic: boolean): string {
  if (isDomestic) {
    return `https://map.naver.com/v5/?c=${lng},${lat},15,0,0,0,dh`;
  }
  return `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
}
