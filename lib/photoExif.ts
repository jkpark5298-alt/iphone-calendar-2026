import exifr from "exifr";

export type PhotoBookImageExif = {
  takenAt?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
};

function formatExifDate(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return formatDateParts(date);
    const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return formatDateParts(date);
}

function formatDateParts(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (value && typeof value === "object" && "numerator" in (value as object) && "denominator" in (value as object)) {
    const num = Number((value as { numerator: number }).numerator);
    const den = Number((value as { denominator: number }).denominator);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
  }
  return null;
}

function dmsToDecimal(value: unknown, ref?: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const refText = String(ref || "").toUpperCase();
    if (refText === "S" || refText === "W") return -Math.abs(value);
    return value;
  }

  if (!Array.isArray(value) || value.length < 2) return null;
  const deg = asNumber(value[0]);
  const min = asNumber(value[1]);
  const sec = asNumber(value[2] ?? 0);
  if (deg == null || min == null || sec == null) return null;
  let decimal = Math.abs(deg) + min / 60 + sec / 3600;
  const refText = String(ref || "").toUpperCase();
  if (refText === "S" || refText === "W" || deg < 0) decimal = -decimal;
  return Number.isFinite(decimal) ? decimal : null;
}

function readNestedText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    return value.map(readNestedText).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.description === "string") return obj.description.trim();
    if (typeof obj.value === "string" || typeof obj.value === "number") return String(obj.value).trim();
    const parts = [
      obj.Sublocation ?? obj.SubLocation,
      obj.City,
      obj.ProvinceState ?? obj.State,
      obj.CountryCode ?? obj.Country,
    ]
      .map(readNestedText)
      .filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }
  return "";
}

function isCoordinateText(text?: string): boolean {
  if (!text) return false;
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(text.trim());
}

function pickEmbeddedPlaceName(data: Record<string, unknown>): string {
  const candidates = [
    data.GPSAreaInformation,
    data.Location,
    data.LocationCreated,
    data.LocationShown,
    data.Landmark,
    data.SubLocation,
  ];
  for (const value of candidates) {
    const text = readNestedText(value);
    if (text && !isCoordinateText(text)) return text;
  }

  const placeParts = [
    data.City,
    data.ProvinceState ?? data.State,
  ]
    .map(readNestedText)
    .filter(Boolean);
  if (placeParts.length >= 2) return `${placeParts[0]} - ${placeParts[1]}`;
  if (placeParts.length === 1) return placeParts[0];
  return "";
}

function resolveLatLng(data: Record<string, unknown>, gps?: { latitude?: number; longitude?: number } | null) {
  let lat =
    (typeof gps?.latitude === "number" && Number.isFinite(gps.latitude) ? gps.latitude : null) ??
    asNumber(data.latitude);
  let lng =
    (typeof gps?.longitude === "number" && Number.isFinite(gps.longitude) ? gps.longitude : null) ??
    asNumber(data.longitude);

  if (lat == null || lng == null) {
    lat = dmsToDecimal(data.GPSLatitude, data.GPSLatitudeRef) ?? lat;
    lng = dmsToDecimal(data.GPSLongitude, data.GPSLongitudeRef) ?? lng;
  }

  if ((lat == null || lng == null) && data.GPSPosition) {
    const text = String(data.GPSPosition);
    const m = text.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (m) {
      lat = Number(m[1]);
      lng = Number(m[2]);
    }
  }

  if (lat != null && (!Number.isFinite(lat) || Number.isNaN(lat))) lat = null;
  if (lng != null && (!Number.isFinite(lng) || Number.isNaN(lng))) lng = null;
  if (lat != null && lng != null && Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001) {
    return { lat: null, lng: null };
  }
  return { lat, lng };
}

async function extractWithExifr(file: File): Promise<PhotoBookImageExif> {
  const [data, gps] = await Promise.all([
    exifr.parse(file, {
      gps: true,
      xmp: true,
      iptc: true,
      mergeOutput: true,
    }).catch(() => null),
    exifr.gps(file).catch(() => null),
  ]);

  if (!data && !gps) return {};

  const merged: Record<string, unknown> = { ...(data || {}) };
  const { lat, lng } = resolveLatLng(merged, gps);

  const takenAt =
    formatExifDate(merged.DateTimeOriginal) ||
    formatExifDate(merged.CreateDate) ||
    formatExifDate(merged.DateTimeDigitized) ||
    formatExifDate(merged.ModifyDate);

  const location = pickEmbeddedPlaceName(merged) || undefined;

  return {
    takenAt: takenAt || undefined,
    location,
    latitude: lat ?? undefined,
    longitude: lng ?? undefined,
  };
}

async function extractWithExifReader(file: File): Promise<PhotoBookImageExif> {
  try {
    const ExifReader = (await import("exifreader")).default;
    const tags = await ExifReader.load(await file.arrayBuffer(), {
      expanded: true,
      includeUnknown: true,
    });

    const takenAt =
      formatExifDate(tags.exif?.DateTimeOriginal?.description) ||
      formatExifDate(tags.exif?.DateTimeOriginal?.value) ||
      formatExifDate(tags.exif?.DateTimeDigitized?.description) ||
      formatExifDate(tags.exif?.DateTime?.description) ||
      formatExifDate(tags.xmp?.DateTimeOriginal?.description) ||
      formatExifDate((tags as { DateTimeOriginal?: { description?: string } }).DateTimeOriginal?.description);

    const gps = tags.gps as
      | { Latitude?: number; Longitude?: number; latitude?: number; longitude?: number }
      | undefined;
    let lat = typeof gps?.Latitude === "number" ? gps.Latitude : typeof gps?.latitude === "number" ? gps.latitude : null;
    let lng = typeof gps?.Longitude === "number" ? gps.Longitude : typeof gps?.longitude === "number" ? gps.longitude : null;

    if (lat == null || lng == null) {
      const latTag = (tags as Record<string, { description?: string; value?: unknown }>).GPSLatitude
        ?? tags.exif?.GPSLatitude;
      const lngTag = (tags as Record<string, { description?: string; value?: unknown }>).GPSLongitude
        ?? tags.exif?.GPSLongitude;
      const latRef = (tags as Record<string, { description?: string; value?: unknown }>).GPSLatitudeRef
        ?? tags.exif?.GPSLatitudeRef;
      const lngRef = (tags as Record<string, { description?: string; value?: unknown }>).GPSLongitudeRef
        ?? tags.exif?.GPSLongitudeRef;
      lat = dmsToDecimal(latTag?.value ?? latTag?.description, latRef?.value ?? latRef?.description) ?? lat;
      lng = dmsToDecimal(lngTag?.value ?? lngTag?.description, lngRef?.value ?? lngRef?.description) ?? lng;
    }

    if (lat != null && lng != null && Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001) {
      lat = null;
      lng = null;
    }

    const place =
      readNestedText(tags.xmp?.LocationCreated) ||
      readNestedText(tags.xmp?.LocationShown) ||
      readNestedText((tags as Record<string, { description?: string }>).Location?.description) ||
      "";

    return {
      takenAt: takenAt || undefined,
      location: place && !isCoordinateText(place) ? place : undefined,
      latitude: lat ?? undefined,
      longitude: lng ?? undefined,
    };
  } catch {
    return {};
  }
}

/** GPS → "파주시 - 기산리" 형태 장소명으로 보강 */
export async function resolvePhotoExifPlaceName(exif: PhotoBookImageExif): Promise<PhotoBookImageExif> {
  if (exif.location && !isCoordinateText(exif.location)) {
    return exif;
  }

  const lat = exif.latitude;
  const lng = exif.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { ...exif, location: undefined };
  }

  try {
    const response = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`);
    if (!response.ok) return { ...exif, location: undefined };
    const data = (await response.json()) as { place?: string };
    const place = String(data.place || "").trim();
    if (place) {
      return { ...exif, location: place };
    }
  } catch (error) {
    console.warn("resolvePhotoExifPlaceName failed", error);
  }

  // 장소명 변환 실패 시에는 좌표 대신 일자만 보이도록 location을 비웁니다.
  return { ...exif, location: undefined };
}

export async function extractPhotoExif(file: File): Promise<PhotoBookImageExif> {
  try {
    const primary = await extractWithExifr(file);
    const fallback = primary.latitude == null || primary.longitude == null || !primary.takenAt
      ? await extractWithExifReader(file)
      : {};

    const merged: PhotoBookImageExif = {
      takenAt: primary.takenAt || fallback.takenAt,
      location: primary.location || fallback.location,
      latitude: primary.latitude ?? fallback.latitude,
      longitude: primary.longitude ?? fallback.longitude,
    };

    return resolvePhotoExifPlaceName(merged);
  } catch {
    return {};
  }
}

/**
 * 표시 규칙:
 * 1) 위치가 있으면 위치 표시 (일자도 있으면 함께)
 * 2) 위치가 없고 일자가 있으면 일자만 표시
 */
export function getPhotoBookExifViewLines(exif?: PhotoBookImageExif | null): string[] {
  if (!exif) return [];
  const lines: string[] = [];
  if (exif.location) {
    lines.push(`📍 ${exif.location}`);
    if (exif.takenAt) lines.push(`📅 ${exif.takenAt}`);
    return lines;
  }
  if (exif.takenAt) {
    lines.push(`📅 ${exif.takenAt}`);
  }
  return lines;
}

export function formatPhotoBookExifDisplay(exif?: PhotoBookImageExif | null): string | null {
  const lines = getPhotoBookExifViewLines(exif);
  return lines.length > 0 ? lines.join(" · ") : null;
}

export function hasPhotoBookExif(exif?: PhotoBookImageExif | null): boolean {
  return getPhotoBookExifViewLines(exif).length > 0;
}
