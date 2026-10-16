/** EXIF DateTime(2016:04:28 12:30:00) / ISO → YYYY/MM/DD */
export function formatExifDateSlash(value: string | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const exif = trimmed.match(/^(\d{4}):(\d{2}):(\d{2})/);
  if (exif) return `${exif[1]}/${exif[2]}/${exif[3]}`;
  return formatDateSlash(trimmed);
}

/** ISO(YYYY-MM-DD) 또는 Date 파싱 가능 문자열 → YYYY/MM/DD */
export function formatDateSlash(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}/${isoMatch[2]}/${isoMatch[3]}`;
  }

  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashMatch) {
    const month = slashMatch[2].padStart(2, "0");
    const day = slashMatch[3].padStart(2, "0");
    return `${slashMatch[1]}/${month}/${day}`;
  }

  const dotted = trimmed.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (dotted) {
    const month = dotted[2].padStart(2, "0");
    const day = dotted[3].padStart(2, "0");
    return `${dotted[1]}/${month}/${day}`;
  }

  const korean = trimmed.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if (korean) {
    const month = korean[2].padStart(2, "0");
    const day = korean[3].padStart(2, "0");
    return `${korean[1]}/${month}/${day}`;
  }

  const parsed = Date.parse(trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00`);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}/${m}/${d}`;
  }

  return "";
}

export function resolveAlbumDayDateIso(day: {
  dateIso?: string;
  dateLabel?: string;
}): string {
  if (day.dateIso?.trim()) return day.dateIso.trim();

  const fromLabel = day.dateLabel?.trim();
  if (!fromLabel) return "";

  const isoFromLabel = fromLabel.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (isoFromLabel) {
    const month = isoFromLabel[2].padStart(2, "0");
    const dayNum = isoFromLabel[3].padStart(2, "0");
    return `${isoFromLabel[1]}-${month}-${dayNum}`;
  }

  return "";
}

/** 촬영일이 있는 일차를 앞쪽에, 날짜가 없는 일차를 뒤에 둔다. */
export function sortAlbumDaysByDate<T extends { day: number; dateIso?: string; dateLabel?: string }>(
  days: T[],
): T[] {
  return [...days].sort((a, b) => {
    const dateA = resolveAlbumDayDateIso(a);
    const dateB = resolveAlbumDayDateIso(b);
    if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
    if (dateA && !dateB) return -1;
    if (!dateA && dateB) return 1;
    return a.day - b.day;
  });
}
