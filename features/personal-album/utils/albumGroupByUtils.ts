import { formatDateSlash, resolveAlbumDayDateIso } from "./albumDateUtils";
import { sortAlbumPhotos } from "./albumPhotoOrderUtils";
import type { AlbumGroupBy } from "./chapter3SavedAlbumUtils";
import {
  consolidateManualAlbumDayPlaces,
  type Chapter3AlbumDay,
  type Chapter3AlbumPhoto,
} from "./chapter3Utils";
import { getPhotoExifPlaceName, isGpsCoordinateLabel } from "./exifUtils";

export type AlbumBrowseSection = {
  key: string;
  label: string;
  photos: Chapter3AlbumPhoto[];
  /** day 모드일 때 원본 일차 (지도용) */
  day?: Chapter3AlbumDay;
};

function allPhotosFromDays(days: Chapter3AlbumDay[]): Chapter3AlbumPhoto[] {
  return sortAlbumPhotos(
    days.flatMap((day) =>
      consolidateManualAlbumDayPlaces(day.day, day.places).flatMap((place) => place.photos),
    ),
  );
}

function photoDateIso(photo: Chapter3AlbumPhoto, day?: Chapter3AlbumDay): string {
  const exif = photo.exifDateTime?.trim() || "";
  if (/^\d{4}-\d{2}-\d{2}/.test(exif)) return exif.slice(0, 10);
  if (day) {
    const dayIso = resolveAlbumDayDateIso(day);
    if (dayIso) return dayIso;
  }
  return "";
}

function photoPlaceLabel(photo: Chapter3AlbumPhoto): string {
  const name = getPhotoExifPlaceName(photo);
  if (name && !/사진 앨범$/.test(name)) return name;
  const label = photo.exifLocationLabel?.trim() || "";
  if (label && !isGpsCoordinateLabel(label) && !/사진 앨범$/.test(label)) return label;
  return "장소 미정";
}

/** 개인 앨범 보기 — 일자 / 년도 / 장소별 섹션 */
export function buildAlbumBrowseSections(
  days: Chapter3AlbumDay[],
  groupBy: AlbumGroupBy = "day",
): AlbumBrowseSection[] {
  if (groupBy === "day") {
    return days.map((day) => {
      const photos = sortAlbumPhotos(
        consolidateManualAlbumDayPlaces(day.day, day.places).flatMap((place) => place.photos),
      );
      const label =
        formatDateSlash(resolveAlbumDayDateIso(day)) || day.dateLabel || `${day.day}일차`;
      return {
        key: `day-${day.day}`,
        label,
        photos,
        day,
      };
    });
  }

  const dayByPhotoId = new Map<string, Chapter3AlbumDay>();
  for (const day of days) {
    for (const place of consolidateManualAlbumDayPlaces(day.day, day.places)) {
      for (const photo of place.photos) {
        dayByPhotoId.set(photo.id, day);
      }
    }
  }

  const photos = allPhotosFromDays(days);
  const buckets = new Map<string, { label: string; photos: Chapter3AlbumPhoto[] }>();

  for (const photo of photos) {
    const day = dayByPhotoId.get(photo.id);
    let key: string;
    let label: string;
    if (groupBy === "year") {
      const iso = photoDateIso(photo, day);
      const year = iso ? iso.slice(0, 4) : "연도 미정";
      key = `year-${year}`;
      label = year === "연도 미정" ? year : `${year}년`;
    } else {
      label = photoPlaceLabel(photo);
      key = `place-${label}`;
    }
    const bucket = buckets.get(key) || { label, photos: [] };
    bucket.photos.push(photo);
    buckets.set(key, bucket);
  }

  const sections = Array.from(buckets.entries()).map(([key, bucket]) => ({
    key,
    label: bucket.label,
    photos: sortAlbumPhotos(bucket.photos),
  }));

  sections.sort((a, b) => {
    if (groupBy === "year") {
      if (a.label === "연도 미정") return 1;
      if (b.label === "연도 미정") return -1;
      return b.label.localeCompare(a.label, "ko");
    }
    if (a.label === "장소 미정") return 1;
    if (b.label === "장소 미정") return -1;
    return a.label.localeCompare(b.label, "ko");
  });

  return sections;
}

export const ALBUM_GROUP_BY_OPTIONS: { value: AlbumGroupBy; label: string }[] = [
  { value: "day", label: "일자" },
  { value: "year", label: "년도별" },
  { value: "place", label: "장소별" },
];
