import exifr from "exifr";

export type PhotoBookImageExif = {
  takenAt?: string;
  location?: string;
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
    // EXIF 원문 형식: 2026:07:29 14:28:00
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

/** GPSLatitude/GPSLongitude DMS 배열 → 십진수 */
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

function pickLocationText(data: Record<string, unknown>, lat?: number | null, lng?: number | null): string {
  const candidates = [
    data.GPSAreaInformation,
    data.Location,
    data.LocationCreated,
    data.LocationShown,
    data.Landmark,
    data.SubLocation,
    data.ImageDescription,
  ];
  for (const value of candidates) {
    const text = readNestedText(value);
    if (text) return text;
  }

  const placeParts = [
    data.City,
    data.ProvinceState ?? data.State,
    data.Country,
    data.CountryDestination,
  ]
    .map(readNestedText)
    .filter(Boolean);
  if (placeParts.length > 0) return placeParts.join(", ");

  if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
    if (Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001) return "";
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
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
  return { lat, lng };
}

async function extractWithExifr(file: File): Promise<PhotoBookImageExif> {
  const [data, gps] = await Promise.all([
    exifr.parse(file, {
      gps: true,
      xmp: true,
      iptc: true,
      // pick를 쓰지 않음: 아이폰 GPS 변환(latitude/longitude)에 필요한 Ref 태그까지 포함하려면 전체 파싱이 안전
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

  const location = pickLocationText(merged, lat, lng);

  return {
    takenAt: takenAt || undefined,
    location: location || undefined,
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

    const place =
      readNestedText(tags.xmp?.LocationCreated) ||
      readNestedText(tags.xmp?.LocationShown) ||
      readNestedText((tags as Record<string, { description?: string }>).Location?.description) ||
      readNestedText(tags.iptc?.["City"]?.description) ||
      readNestedText(tags.iptc?.["Country/Primary Location Name"]?.description) ||
      "";

    let location = place;
    if (!location && typeof lat === "number" && typeof lng === "number") {
      if (!(Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001)) {
        location = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
    }

    return {
      takenAt: takenAt || undefined,
      location: location || undefined,
    };
  } catch {
    return {};
  }
}

export async function extractPhotoExif(file: File): Promise<PhotoBookImageExif> {
  try {
    const primary = await extractWithExifr(file);
    if (primary.location) return primary;

    // 아이폰 HEIC 등에서 촬영일만 나오고 GPS를 못 읽는 경우 ExifReader로 재시도
    const fallback = await extractWithExifReader(file);
    return {
      takenAt: primary.takenAt || fallback.takenAt,
      location: primary.location || fallback.location,
    };
  } catch {
    return {};
  }
}

export function formatPhotoBookExifDisplay(exif?: PhotoBookImageExif | null): string | null {
  if (!exif) return null;
  const parts: string[] = [];
  if (exif.takenAt) parts.push(`📅 ${exif.takenAt}`);
  if (exif.location) parts.push(`📍 ${exif.location}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function hasPhotoBookExif(exif?: PhotoBookImageExif | null): boolean {
  return Boolean(exif?.takenAt || exif?.location);
}
