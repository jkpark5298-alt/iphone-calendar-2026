import { formatDateSlash, resolveAlbumDayDateIso, sortAlbumDaysByDate } from "./albumDateUtils";
import { createEmptyAlbumDay, type Chapter3AlbumDay, type Chapter3AlbumPhoto } from "./chapter3Utils";

function isValidDateMs(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0;
}

function dateMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

function applyMeridiem(hour: number, meridiem: "am" | "pm" | ""): number {
  if (meridiem === "pm" && hour < 12) return hour + 12;
  if (meridiem === "am" && hour === 12) return 0;
  return hour;
}

/** EXIF 촬영 시각(ms). 없거나 파싱 실패면 null */
/** 촬영 시각의 로컬 달력 날짜(YYYY-MM-DD). 없으면 null */
export function photoTakenDateIso(
  photo: Pick<Chapter3AlbumPhoto, "exifTakenAt" | "exifDateTime">,
): string | null {
  const ms = parsePhotoTakenAtMs(photo);
  if (ms == null) return null;
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parsePhotoTakenAtMs(
  photo: Pick<Chapter3AlbumPhoto, "exifTakenAt" | "exifDateTime">,
): number | null {
  if (typeof photo.exifTakenAt === "number" && isValidDateMs(photo.exifTakenAt)) {
    return photo.exifTakenAt;
  }
  return parseExifDateTimeMs(photo.exifDateTime);
}

export function hasPhotoTakenAt(photo: Pick<Chapter3AlbumPhoto, "exifTakenAt" | "exifDateTime">): boolean {
  return parsePhotoTakenAtMs(photo) != null;
}

export function backfillPhotoTakenAt(photo: Chapter3AlbumPhoto): Chapter3AlbumPhoto {
  if (typeof photo.exifTakenAt === "number" && isValidDateMs(photo.exifTakenAt)) return photo;
  const ms = parseExifDateTimeMs(photo.exifDateTime);
  return ms != null ? { ...photo, exifTakenAt: ms } : photo;
}

export function normalizeAlbumDaysPhotos(days: Chapter3AlbumDay[]): Chapter3AlbumDay[] {
  return days.map((day) => {
    const places = day.places.map((place) => ({
      ...place,
      photos: place.photos.map(backfillPhotoTakenAt),
    }));
    const allPhotos = places.flatMap((place) => place.photos);
    const needsOrder = allPhotos.some((photo) => typeof photo.sortOrder !== "number");
    if (!needsOrder || allPhotos.length === 0) {
      return { ...day, places };
    }
    const ordered = sortAlbumPhotos(allPhotos);
    const orderById = new Map(ordered.map((photo, index) => [photo.id, index]));
    return {
      ...day,
      places: places.map((place) => ({
        ...place,
        photos: place.photos.map((photo) =>
          orderById.has(photo.id) ? { ...photo, sortOrder: orderById.get(photo.id)! } : photo,
        ),
      })),
    };
  });
}

/**
 * ko-KR 로케일(2024. 8. 21. 15:05:00 / 오후 3시 5분), EXIF 원문, ISO, 미국식 등
 * 기존 Date.parse는 한국어 문자열을 Invalid Date로 만들어 업로드 순서가 유지됐습니다.
 */
export function parseExifDateTimeMs(value?: string | null): number | null {
  if (!value?.trim()) return null;
  const trimmed = value
    .trim()
    .replace(/[\u00a0\u202f\u2007\u2009\u200a]/g, " ")
    .replace(/[．｡]/g, ".");

  const exifRaw = trimmed.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (exifRaw) {
    return dateMs(
      Number(exifRaw[1]),
      Number(exifRaw[2]),
      Number(exifRaw[3]),
      Number(exifRaw[4]),
      Number(exifRaw[5]),
      Number(exifRaw[6]),
    );
  }

  const meridiem: "am" | "pm" | "" = /오후|\bPM\b/i.test(trimmed)
    ? "pm"
    : /오전|\bAM\b/i.test(trimmed)
      ? "am"
      : "";

  const hangulTime = trimmed.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?(?:\s*(\d{1,2})\s*초)?/);
  const forMatch = trimmed.replace(/오전|오후|\bAM\b|\bPM\b/gi, " ");
  const isoLike = forMatch.match(
    /(\d{4})[-/.년]\s*(\d{1,2})[-/.월]\s*(\d{1,2})(?:일)?(?:\s*[.\-T]?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (isoLike) {
    let hour = isoLike[4] != null ? Number(isoLike[4]) : hangulTime ? Number(hangulTime[1]) : 0;
    const minute =
      isoLike[5] != null ? Number(isoLike[5]) : hangulTime?.[2] != null ? Number(hangulTime[2]) : 0;
    const second =
      isoLike[6] != null ? Number(isoLike[6]) : hangulTime?.[3] != null ? Number(hangulTime[3]) : 0;
    hour = applyMeridiem(hour, meridiem);
    const ms = dateMs(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]), hour, minute, second);
    const capturedTime = isoLike[4] != null || Boolean(hangulTime);
    const stringLooksLikeMidnight =
      !capturedTime && !/\d{1,2}\s*:\s*\d{2}/.test(trimmed) && !/\d{1,2}\s*시/.test(trimmed);
    if (ms != null && (capturedTime || stringLooksLikeMidnight)) return ms;
  }

  const tokens = [...trimmed.matchAll(/\d+/g)].map((match) => ({
    raw: match[0],
    value: Number(match[0]),
  }));
  const yearIdx = tokens.findIndex((token) => token.raw.length === 4 && token.value >= 1990 && token.value <= 2100);
  if (yearIdx >= 0) {
    const year = tokens[yearIdx].value;
    let month = 0;
    let day = 0;
    if (yearIdx === 0 && tokens.length >= 3) {
      month = tokens[1].value;
      day = tokens[2].value;
    } else if (yearIdx >= 2) {
      const first = tokens[yearIdx - 2].value;
      const second = tokens[yearIdx - 1].value;
      if (first > 12) {
        day = first;
        month = second;
      } else {
        month = first;
        day = second;
      }
    }

    const afterYear = tokens.slice(yearIdx === 0 ? 3 : yearIdx + 1);
    let hour = 0;
    let minute = 0;
    let second = 0;
    if (hangulTime) {
      hour = Number(hangulTime[1]);
      minute = hangulTime[2] != null ? Number(hangulTime[2]) : 0;
      second = hangulTime[3] != null ? Number(hangulTime[3]) : 0;
    } else if (afterYear.length >= 2) {
      hour = afterYear[0].value;
      minute = afterYear[1].value;
      second = afterYear[2]?.value ?? 0;
    } else if (afterYear.length === 1 && afterYear[0].value <= 23) {
      hour = afterYear[0].value;
    }
    hour = applyMeridiem(hour, meridiem);
    const ms = dateMs(year, month, day, hour, minute, second);
    if (ms != null) return ms;
  }

  const iso = Date.parse(trimmed);
  return Number.isNaN(iso) ? null : iso;
}

export function compareAlbumPhotos(a: Chapter3AlbumPhoto, b: Chapter3AlbumPhoto): number {
  const takenA = parsePhotoTakenAtMs(a);
  const takenB = parsePhotoTakenAtMs(b);
  const orderA = a.sortOrder;
  const orderB = b.sortOrder;
  const bothHaveOrder = typeof orderA === "number" && typeof orderB === "number";

  // 사용자가 정한 표시 순서가 있으면 최우선 (드래그 이동·재진입 유지)
  if (bothHaveOrder && orderA !== orderB) return orderA - orderB;

  if (takenA != null && takenB != null && takenA !== takenB) {
    return takenA - takenB;
  }

  if (takenA != null && takenB == null) return -1;
  if (takenA == null && takenB != null) return 1;

  return 0;
}

export function sortAlbumPhotos(photos: Chapter3AlbumPhoto[]): Chapter3AlbumPhoto[] {
  return photos
    .map((photo, index) => ({ photo: backfillPhotoTakenAt(photo), index }))
    .sort((a, b) => {
      const compared = compareAlbumPhotos(a.photo, b.photo);
      return compared !== 0 ? compared : a.index - b.index;
    })
    .map(({ photo }) => photo);
}

export function assignPhotoSortOrders(photos: Chapter3AlbumPhoto[]): Chapter3AlbumPhoto[] {
  return photos.map((photo, index) =>
    photo.sortOrder === index ? photo : { ...photo, sortOrder: index },
  );
}

/** 촬영 시각이 있는 사진은 시각 순으로 삽입, 없는 사진은 맨 뒤(선택 순서 유지) */
export function insertPhotosByTakenAt(
  existing: Chapter3AlbumPhoto[],
  incoming: Chapter3AlbumPhoto[],
): Chapter3AlbumPhoto[] {
  const sortedIncoming = incoming
    .map((photo, index) => ({ photo: backfillPhotoTakenAt(photo), index }))
    .sort((a, b) => {
      const takenA = parsePhotoTakenAtMs(a.photo);
      const takenB = parsePhotoTakenAtMs(b.photo);
      if (takenA != null && takenB != null && takenA !== takenB) return takenA - takenB;
      if (takenA != null && takenB == null) return -1;
      if (takenA == null && takenB != null) return 1;
      return a.index - b.index;
    })
    .map(({ photo }) => photo);

  let list = sortAlbumPhotos(existing);
  for (const photo of sortedIncoming) {
    const taken = parsePhotoTakenAtMs(photo);
    let insertAt = list.length;
    if (taken != null) {
      insertAt = 0;
      for (let i = 0; i < list.length; i++) {
        const otherTaken = parsePhotoTakenAtMs(list[i]);
        if (otherTaken != null && otherTaken <= taken) insertAt = i + 1;
      }
    }
    list = [...list.slice(0, insertAt), photo, ...list.slice(insertAt)];
  }
  return assignPhotoSortOrders(list);
}

export function applyPhotoSortOrdersToDay(
  day: Chapter3AlbumDay,
  ordered: Chapter3AlbumPhoto[],
): Chapter3AlbumDay {
  const orderById = new Map(ordered.map((photo, index) => [photo.id, index]));
  return {
    ...day,
    places: day.places.map((place) => ({
      ...place,
      photos: place.photos.map((photo) =>
        orderById.has(photo.id) ? { ...photo, sortOrder: orderById.get(photo.id)! } : photo,
      ),
    })),
  };
}

export function reorderPhotosByIds(
  photos: Chapter3AlbumPhoto[],
  orderedIds: string[],
): Chapter3AlbumPhoto[] | null {
  const sorted = sortAlbumPhotos(photos);
  const idSet = new Set(orderedIds);
  const nextSubset = orderedIds
    .map((id) => sorted.find((photo) => photo.id === id))
    .filter((photo): photo is Chapter3AlbumPhoto => Boolean(photo));
  if (nextSubset.length !== orderedIds.length) return null;

  let cursor = 0;
  const merged = sorted.map((photo) => (idSet.has(photo.id) ? nextSubset[cursor++] : photo));
  return assignPhotoSortOrders(merged);
}

const UNDATED_DAY_LABEL = "날짜 없음";

function cloneAlbumDays(days: Chapter3AlbumDay[]): Chapter3AlbumDay[] {
  return days.map((day) => ({
    ...day,
    places: day.places.map((place) => ({ ...place, photos: [...place.photos] })),
  }));
}

function isBlankAlbumDay(day: Chapter3AlbumDay): boolean {
  return !resolveAlbumDayDateIso(day) && day.places.every((place) => place.photos.length === 0);
}

function preferredPhotoPlaceId(day: Chapter3AlbumDay, fallbackPlaceId?: string): string | null {
  const albumPlace = day.places.find((place) => /사진 앨범$/.test((place.name || "").trim()));
  if (albumPlace) return albumPlace.id;
  if (fallbackPlaceId && day.places.some((place) => place.id === fallbackPlaceId)) {
    return fallbackPlaceId;
  }
  return day.places[0]?.id ?? null;
}

function appendPhotosOnDay(
  day: Chapter3AlbumDay,
  incoming: Chapter3AlbumPhoto[],
  fallbackPlaceId?: string,
): Chapter3AlbumDay {
  const placeId = preferredPhotoPlaceId(day, fallbackPlaceId);
  const withPlace =
    placeId != null
      ? day
      : {
          ...day,
          places: [
            ...day.places,
            {
              id: `d${day.day}-album-general`,
              name: "사진 앨범",
              address: "",
              description: "",
              kind: "destination" as const,
              photos: [],
            },
          ],
        };
  const targetId = placeId ?? `d${day.day}-album-general`;
  const incomingIds = new Set(incoming.map((photo) => photo.id));
  const nextDay: Chapter3AlbumDay = {
    ...withPlace,
    places: withPlace.places.map((place) =>
      place.id === targetId ? { ...place, photos: [...place.photos, ...incoming] } : place,
    ),
  };
  const allPhotos = nextDay.places.flatMap((place) => place.photos);
  const ordered = insertPhotosByTakenAt(
    allPhotos.filter((photo) => !incomingIds.has(photo.id)),
    allPhotos.filter((photo) => incomingIds.has(photo.id)),
  );
  const orderById = new Map(ordered.map((photo, index) => [photo.id, index]));
  const orderedById = new Map(ordered.map((photo) => [photo.id, photo]));
  return {
    ...nextDay,
    places: nextDay.places.map((place) => ({
      ...place,
      photos: place.photos
        .map((photo) => {
          const index = orderById.get(photo.id);
          if (index == null) return photo;
          return { ...(orderedById.get(photo.id) || photo), sortOrder: index };
        })
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    })),
  };
}

export type ExifPhotoMergeResult = {
  days: Chapter3AlbumDay[];
  datedCount: number;
  undatedCount: number;
  dayCount: number;
  focusDay: number | null;
  focusPlaceId: string | null;
};

/**
 * 촬영일이 있는 사진은 같은 날짜 일차로 모으고, 일차 안에서는 촬영 시각순으로 둔다.
 * 날짜가 없는 사진은 지정한 일차 또는 「날짜 없음」에 둔다.
 */
export function mergePhotosByExifDate(
  days: Chapter3AlbumDay[],
  incoming: Chapter3AlbumPhoto[],
  options?: { fallbackDay?: number; fallbackPlaceId?: string; manualMode?: boolean },
): ExifPhotoMergeResult {
  const photos = incoming.map(backfillPhotoTakenAt);
  const byDate = new Map<string, Chapter3AlbumPhoto[]>();
  const undated: Chapter3AlbumPhoto[] = [];
  for (const photo of photos) {
    const dateIso = photoTakenDateIso(photo);
    if (!dateIso) {
      undated.push(photo);
      continue;
    }
    const group = byDate.get(dateIso);
    if (group) group.push(photo);
    else byDate.set(dateIso, [photo]);
  }

  let next = cloneAlbumDays(days);
  const dates = [...byDate.keys()].sort();
  let claimedBlank = false;

  for (const dateIso of dates) {
    const group = byDate.get(dateIso) || [];
    let target = next.find((day) => resolveAlbumDayDateIso(day) === dateIso);
    if (!target && !claimedBlank) {
      const blank =
        (options?.fallbackDay != null
          ? next.find((day) => day.day === options.fallbackDay && isBlankAlbumDay(day))
          : undefined) || next.find((day) => isBlankAlbumDay(day));
      if (blank) {
        claimedBlank = true;
        target = {
          ...blank,
          dateIso,
          dateLabel: formatDateSlash(dateIso),
        };
        next = next.map((day) => (day.day === blank.day ? target! : day));
      }
    }
    if (!target) {
      const dayNumber = next.reduce((max, day) => Math.max(max, day.day), 0) + 1;
      target = {
        ...createEmptyAlbumDay(dayNumber, {
          dateIso,
          manualMode: options?.manualMode,
        }),
        dateIso,
        dateLabel: formatDateSlash(dateIso),
      };
      next = [...next, target];
    } else if (!target.dateIso) {
      target = { ...target, dateIso, dateLabel: formatDateSlash(dateIso) };
      next = next.map((day) => (day.day === target!.day ? target! : day));
    }
    const fallbackOnThisDay =
      options?.fallbackDay === target.day ? options.fallbackPlaceId : undefined;
    next = next.map((day) =>
      day.day === target!.day ? appendPhotosOnDay(day, group, fallbackOnThisDay) : day,
    );
  }

  if (undated.length > 0) {
    const fallback =
      options?.fallbackDay != null ? next.find((day) => day.day === options.fallbackDay) : undefined;
    const fallbackDate = fallback ? resolveAlbumDayDateIso(fallback) : "";
    const fallbackKept = Boolean(
      fallback && (fallbackDate ? !dates.includes(fallbackDate) : Boolean(options?.fallbackPlaceId)),
    );
    let target = fallbackKept ? fallback : undefined;
    if (!target) {
      target = next.find((day) => day.dateLabel === UNDATED_DAY_LABEL && !resolveAlbumDayDateIso(day));
    }
    if (!target) {
      const dayNumber = next.reduce((max, day) => Math.max(max, day.day), 0) + 1;
      target = {
        ...createEmptyAlbumDay(dayNumber, { manualMode: options?.manualMode }),
        dateLabel: UNDATED_DAY_LABEL,
      };
      next = [...next, target];
    }
    const fallbackOnThisDay =
      options?.fallbackDay === target.day ? options.fallbackPlaceId : undefined;
    next = next.map((day) =>
      day.day === target!.day ? appendPhotosOnDay(day, undated, fallbackOnThisDay) : day,
    );
  }

  const ordered = sortAlbumDaysByDate(next);
  const focusDate = dates[0];
  const focus =
    (focusDate ? ordered.find((day) => resolveAlbumDayDateIso(day) === focusDate) : undefined) ||
    ordered.find((day) => day.places.some((place) => place.photos.some((photo) => photos.some((item) => item.id === photo.id))));
  const focusPlaceId = focus
    ? preferredPhotoPlaceId(focus, options?.fallbackDay === focus.day ? options.fallbackPlaceId : undefined)
    : null;

  return {
    days: ordered,
    datedCount: photos.length - undated.length,
    undatedCount: undated.length,
    dayCount: dates.length,
    focusDay: focus?.day ?? null,
    focusPlaceId,
  };
}

export function movePhotoIndex<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
