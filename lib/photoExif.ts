import exifr from "exifr";

export type PhotoBookImageExif = {
  takenAt?: string;
  location?: string;
};

function formatExifDate(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function pickLocationText(data: Record<string, unknown>): string {
  const candidates = [
    data.GPSAreaInformation,
    data.Location,
    data.LocationCreated,
    data.LocationShown,
    data.Landmark,
    data.SubLocation,
  ];
  for (const value of candidates) {
    if (value == null || value === "") continue;
    const text = String(value).trim();
    if (text) return text;
  }

  const placeParts = [
    data.City,
    data.ProvinceState ?? data.State,
    data.Country,
    data.CountryDestination,
  ]
    .map((part) => (part == null || part === "" ? "" : String(part).trim()))
    .filter(Boolean);
  if (placeParts.length > 0) return placeParts.join(", ");

  if (typeof data.latitude === "number" && typeof data.longitude === "number") {
    return `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`;
  }
  return "";
}

export async function extractPhotoExif(file: File): Promise<PhotoBookImageExif> {
  try {
    // 아이폰 사진앱(HEIC/JPEG) EXIF + GPS + 위치 메타를 폭넓게 읽습니다.
    const [data, gps] = await Promise.all([
      exifr.parse(file, {
        gps: true,
        xmp: true,
        iptc: true,
        ihdr: false,
        icc: false,
        jfif: false,
        pick: [
          "DateTimeOriginal",
          "CreateDate",
          "ModifyDate",
          "DateTimeDigitized",
          "latitude",
          "longitude",
          "GPSLatitude",
          "GPSLongitude",
          "GPSAreaInformation",
          "Location",
          "LocationCreated",
          "LocationShown",
          "Landmark",
          "SubLocation",
          "City",
          "State",
          "ProvinceState",
          "Country",
          "CountryDestination",
        ],
      }),
      exifr.gps(file).catch(() => null),
    ]);

    const merged: Record<string, unknown> = { ...(data || {}) };
    if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
      merged.latitude = gps.latitude;
      merged.longitude = gps.longitude;
    }

    if (!data && !gps) return {};

    const takenAt =
      formatExifDate(merged.DateTimeOriginal) ||
      formatExifDate(merged.CreateDate) ||
      formatExifDate(merged.DateTimeDigitized) ||
      formatExifDate(merged.ModifyDate);

    const location = pickLocationText(merged);

    return {
      takenAt: takenAt || undefined,
      location: location || undefined,
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
