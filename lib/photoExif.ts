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

export async function extractPhotoExif(file: File): Promise<PhotoBookImageExif> {
  try {
    const data = await exifr.parse(file, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "ModifyDate",
        "latitude",
        "longitude",
        "GPSAreaInformation",
        "Location",
        "City",
        "State",
        "Country",
      ],
    });

    if (!data) return {};

    const takenAt =
      formatExifDate(data.DateTimeOriginal) ||
      formatExifDate(data.CreateDate) ||
      formatExifDate(data.ModifyDate);

    let location = "";
    if (data.GPSAreaInformation) {
      location = String(data.GPSAreaInformation);
    } else if (data.Location) {
      location = String(data.Location);
    } else if (data.City || data.State || data.Country) {
      location = [data.City, data.State, data.Country].filter(Boolean).join(", ");
    } else if (typeof data.latitude === "number" && typeof data.longitude === "number") {
      location = `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`;
    }

    return {
      takenAt: takenAt || undefined,
      location: location || undefined,
    };
  } catch {
    return {};
  }
}

export function formatPhotoBookExifDisplay(exif?: PhotoBookImageExif): string | null {
  if (!exif) return null;
  const parts: string[] = [];
  if (exif.takenAt) parts.push(`📅 ${exif.takenAt}`);
  if (exif.location) parts.push(`📍 ${exif.location}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
