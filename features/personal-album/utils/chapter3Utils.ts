import type { AdditionalTravelInfo, DayPlan, PlanRequest, PlanScheduleSegment } from "../types";
import { initialPlanRequest } from "./locationUtils";
import {
  getSegmentMapLabel,
  isMovementPlaceText,
  parsePlaceWithAddress,
  formatPlaceWithAddress,
} from "./planUtils";
import { getPlanDayColor } from "./planConstants";
import { formatDateSlash } from "./albumDateUtils";
import { getPhotoExifPlaceName } from "./exifUtils";
import type { MapRouteDaySegment } from "./planUtils";

export type Chapter3PlaceKind = "destination" | "accommodation" | "restaurant" | "attraction";

export interface Chapter3MapPlaceItem {
  id: string;
  name: string;
  address: string;
  kind: Chapter3PlaceKind;
  icon: string;
  label: string;
  day: number;
}

export interface Chapter3RouteLeg {
  from: string;
  to: string;
  transport: string;
  day: number;
  distanceKm?: number;
}

export interface Chapter3AlbumPhoto {
  id: string;
  dataUrl: string;
  fileName?: string;
  memo: string;
  exifDateTime?: string;
  /** EXIF 촬영 시각 epoch(ms) — 지도·앨범 표시 순서용 */
  exifTakenAt?: number;
  /** 일차 안 표시 순서. 촬영 시각이 없는 사진을 직접 옮길 때 저장 */
  sortOrder?: number;
  exifLat?: number;
  exifLng?: number;
  exifLocationLabel?: string;
  /** EXIF/IPTC 지명 또는 GPS 역지오코딩 장소명 (수동 입력 장소명과 별도) */
  exifPlaceName?: string;
  /** 사용자가 촬영 지명을 직접 수정한 경우 GPS 자동 변환으로 덮어쓰지 않음 */
  exifPlaceEdited?: boolean;
  /** Supabase Storage 공개 URL — PC·아이폰 동기화용 */
  fileUrl?: string;
  storagePath?: string;
  /** 원본 대신 Google Drive 압축본을 보고 있을 때 */
  archived?: boolean;
  /** Google Drive 파일 ID. 화면 주소는 /api/google-drive/file */
  driveFileId?: string;
  /** 같은 사진을 다시 올릴 때 한 장만 남기기 위한 식별 키 */
  dedupeKey?: string;
  /** 원본 파일 용량. 촬영 시각이 없을 때 같은 파일명과 함께 중복 판단 */
  fileSize?: number;
  createdAt: string;
}

export interface Chapter3AlbumPlace {
  id: string;
  name: string;
  address: string;
  description: string;
  kind: Chapter3PlaceKind;
  photos: Chapter3AlbumPhoto[];
}

export interface Chapter3AlbumDay {
  day: number;
  dateLabel: string;
  dateIso?: string;
  places: Chapter3AlbumPlace[];
}

function isGenericAlbumPlaceLabel(name: string): boolean {
  return /사진 앨범$/.test(name.trim());
}

/** 해당 일자(또는 장소) 사진에서 촬영 위치를 순서대로 모은다. */
export function collectPhotoPlaceNames(photos: Chapter3AlbumPhoto[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const photo of photos || []) {
    const name = getPhotoExifPlaceName(photo);
    if (!name || isGenericAlbumPlaceLabel(name)) continue;
    const key = name.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function formatPhotoPlacesAsDescription(photos: Chapter3AlbumPhoto[]): string {
  return collectPhotoPlaceNames(photos).join("\n\n");
}

/** 자동 장소 설명(· 또는 단락)을 장소별 줄로 나눈다. */
export function splitPhotoPlaceDescriptionParts(text: string | undefined): string[] {
  return (text || "")
    .split(/\s*·\s*|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 일차 전체 사진 장소. 「사진 앨범」 블록은 일자 단위로 본다. */
export function photosForPlaceDescription(
  place: Chapter3AlbumPlace,
  day?: Chapter3AlbumDay,
): Chapter3AlbumPhoto[] {
  if (day && isGenericAlbumPlaceLabel(place.name || "")) {
    const all = day.places.flatMap((item) => item.photos || []);
    return all.length > 0 ? all : place.photos || [];
  }
  return place.photos || [];
}

/** 직접 쓴 설명이 사진 장소 목록(또는 그 일부)이면 자동 값으로 본다. */
export function isAutoPhotoPlaceDescription(
  description: string | undefined,
  photos: Chapter3AlbumPhoto[],
): boolean {
  const current = splitPhotoPlaceDescriptionParts(description);
  if (current.length === 0) return true;
  const names = new Set(collectPhotoPlaceNames(photos).map((name) => name.toLowerCase()));
  if (names.size === 0) return false;
  return current.every((part) => names.has(part.toLowerCase()));
}

export function resolveAlbumPlaceDescription(
  place: Chapter3AlbumPlace,
  day?: Chapter3AlbumDay,
): string {
  const photos = photosForPlaceDescription(place, day);
  const derived = formatPhotoPlacesAsDescription(photos);
  const custom = place.description?.trim() || "";
  if (!custom || isAutoPhotoPlaceDescription(custom, photos)) return derived;
  return derived ? `${derived}\n${custom}` : custom;
}

export function withResolvedPlaceDescriptions(days: Chapter3AlbumDay[]): Chapter3AlbumDay[] {
  let changed = false;
  const next = days.map((day) => ({
    ...day,
    places: day.places.map((place) => {
      const photos = photosForPlaceDescription(place, day);
      const derived = formatPhotoPlacesAsDescription(photos);
      const custom = place.description?.trim() || "";
      if (custom && !isAutoPhotoPlaceDescription(custom, photos)) return place;
      if ((place.description || "") === derived) return place;
      changed = true;
      return { ...place, description: derived };
    }),
  }));
  return changed ? next : days;
}

export function createEmptyAlbumDay(
  day: number,
  options?: { dateIso?: string; manualMode?: boolean },
): Chapter3AlbumDay {
  const dateIso = options?.dateIso?.trim();
  const dateLabel = dateIso ? formatDateSlash(dateIso) : `${day}일차`;
  if (options?.manualMode) {
    return buildAlbumDaysFromManualPlans([createManualDayPlan(day)])[0];
  }
  return {
    day,
    dateLabel,
    dateIso: dateIso || undefined,
    places: [
      {
        id: `d${day}-album-general`,
        name: "사진 앨범",
        address: "",
        description: "",
        kind: "destination",
        photos: [],
      },
    ],
  };
}

export function addAlbumDayToList(
  days: Chapter3AlbumDay[],
  manualMode: boolean,
): Chapter3AlbumDay[] {
  const sorted = [...days].sort((a, b) => a.day - b.day);
  const nextDay = sorted.length > 0 ? Math.max(...sorted.map((d) => d.day)) + 1 : 1;
  const last = sorted[sorted.length - 1];
  let nextDateIso = "";
  if (last?.dateIso) {
    const parsed = Date.parse(`${last.dateIso}T00:00:00`);
    if (!Number.isNaN(parsed)) {
      const date = new Date(parsed);
      date.setDate(date.getDate() + 1);
      nextDateIso = date.toISOString().slice(0, 10);
    }
  }
  return [...sorted, createEmptyAlbumDay(nextDay, { dateIso: nextDateIso || undefined, manualMode })];
}

export function removeAlbumDayFromList(days: Chapter3AlbumDay[], day: number): Chapter3AlbumDay[] {
  if (days.length <= 1) return days;
  return days.filter((d) => d.day !== day);
}

export function updateAlbumDayDateInList(
  days: Chapter3AlbumDay[],
  day: number,
  dateIso: string,
): Chapter3AlbumDay[] {
  const trimmed = dateIso.trim();
  return days.map((d) =>
    d.day !== day
      ? d
      : {
          ...d,
          dateIso: trimmed || undefined,
          dateLabel: trimmed ? formatDateSlash(trimmed) : d.dateLabel || `${day}일차`,
        },
  );
}

const SCHEDULE_BLOCKS: {
  key: keyof DayPlan;
  label: string;
  icon: string;
}[] = [
  { key: "morningSchedule", label: "오전", icon: "🌅" },
  { key: "afternoonSchedule", label: "오후", icon: "🌇" },
  { key: "eveningSchedule", label: "저녁", icon: "🌙" },
];

function segmentKind(seg: PlanScheduleSegment): Chapter3PlaceKind {
  const text = `${seg.label || ""} ${seg.dining || ""} ${seg.activity || ""}`.toLowerCase();
  if (/숙소|숙박|호텔|펜션|게스트|stay|hotel/i.test(text)) return "accommodation";
  if (/식당|맛집|점심|저녁|카페|restaurant|dining|lunch|dinner/i.test(text)) return "restaurant";
  return "destination";
}

/** 여행 계획서 기준 일자별 앨범 골격 */
export function buildAlbumDaysFromPlans(dayPlans: DayPlan[]): Chapter3AlbumDay[] {
  return [...dayPlans]
    .sort((a, b) => a.day - b.day)
    .map((dp) => {
      const mapPlaces = buildChapter3MapPlacesForDay(dp).filter((p) => p.kind !== "attraction");

      const descriptionByName = new Map<string, string>();
      for (const block of SCHEDULE_BLOCKS) {
        const segments = dp[block.key] as PlanScheduleSegment[] | undefined;
        segments?.forEach((seg) => {
          const label = getSegmentMapLabel(seg);
          const parsed = parsePlaceWithAddress(label);
          const name = parsed.name || label;
          const desc = [seg.notes, seg.activity, seg.dining].filter(Boolean).join(" · ");
          if (name && desc) descriptionByName.set(name, desc);
        });
      }

      return {
        day: dp.day,
        dateIso: dp.dateIso,
        dateLabel: dp.dateIso
          ? formatDateSlash(dp.dateIso)
          : dp.dateLabel || `${dp.day}일차`,
        places: mapPlaces.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          description: descriptionByName.get(p.name) || "",
          kind: p.kind,
          photos: [],
        })),
      };
    });
}

function makePlaceId(day: number, name: string, kind: Chapter3PlaceKind): string {
  return `d${day}-${kind}-${name.replace(/\s+/g, "_").slice(0, 40)}`;
}

function pushUniquePlace(
  list: Chapter3MapPlaceItem[],
  seen: Set<string>,
  item: Omit<Chapter3MapPlaceItem, "id"> & { id?: string },
) {
  const key = `${item.day}|${item.name}|${item.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    ...item,
    id: item.id || makePlaceId(item.day, item.name, item.kind),
  });
}

/** 일자별 지도·앨범용 장소 목록 (목적지/숙소/식당) */
export function buildChapter3MapPlacesForDay(dp: DayPlan): Chapter3MapPlaceItem[] {
  const items: Chapter3MapPlaceItem[] = [];
  const seen = new Set<string>();

  for (const block of SCHEDULE_BLOCKS) {
    const segments = dp[block.key] as PlanScheduleSegment[] | undefined;
    segments?.forEach((seg) => {
      const mapLabel = getSegmentMapLabel(seg);
      if (!mapLabel.trim() || isMovementPlaceText(mapLabel)) return;
      const parsed = parsePlaceWithAddress(mapLabel);
      const kind = segmentKind(seg);
      pushUniquePlace(items, seen, {
        name: parsed.name || mapLabel,
        address: parsed.address || seg.address || "",
        kind,
        icon: kind === "accommodation" ? "🏨" : kind === "restaurant" ? "🍽️" : "📍",
        label: block.label,
        day: dp.day,
      });
    });
  }

  const stayCandidates = [
    ...(dp.accommodationRecommendations || []),
    dp.accommodationRecommendation,
    dp.staySuggestion,
  ].filter((x): x is string => Boolean(x?.trim()));

  stayCandidates.forEach((name) => {
    const parsed = parsePlaceWithAddress(name);
    pushUniquePlace(items, seen, {
      name: parsed.name || name,
      address: parsed.address || "",
      kind: "accommodation",
      icon: "🏨",
      label: "숙소",
      day: dp.day,
    });
  });

  dp.lunchRecommendations?.forEach((name) => {
    if (!name?.trim()) return;
    const parsed = parsePlaceWithAddress(name);
    pushUniquePlace(items, seen, {
      name: parsed.name || name,
      address: parsed.address || "",
      kind: "restaurant",
      icon: "🍴",
      label: "점심 추천",
      day: dp.day,
    });
  });

  dp.dinnerRecommendations?.forEach((name) => {
    if (!name?.trim()) return;
    const parsed = parsePlaceWithAddress(name);
    pushUniquePlace(items, seen, {
      name: parsed.name || name,
      address: parsed.address || "",
      kind: "restaurant",
      icon: "🍷",
      label: "저녁 추천",
      day: dp.day,
    });
  });

  return items;
}

/** 주변 관광지 추천 (계획서 추가 정보 + 일정 메모) */
export function buildNearbyAttractions(
  dp: DayPlan,
  additionalTravelInfo?: AdditionalTravelInfo | null,
): Chapter3MapPlaceItem[] {
  const items: Chapter3MapPlaceItem[] = [];
  const seen = new Set<string>();
  const dayPlaceNames = buildChapter3MapPlacesForDay(dp).map((p) => p.name.toLowerCase());

  additionalTravelInfo?.placeDetails?.forEach((detail) => {
    if (!detail.name?.trim()) return;
    const nameLower = detail.name.toLowerCase();
    const related = dayPlaceNames.some(
      (n) => n.includes(nameLower) || nameLower.includes(n) || dp.mainPlaces?.some((m) => m.toLowerCase().includes(nameLower)),
    );
    if (!related && dayPlaceNames.length > 0) {
      const destMatch = additionalTravelInfo.destinations?.some((d) =>
        nameLower.includes(d.toLowerCase().slice(0, 2)),
      );
      if (!destMatch) return;
    }
    pushUniquePlace(items, seen, {
      name: detail.name,
      address: detail.address || "",
      kind: "attraction",
      icon: "🎯",
      label: "주변 관광지",
      day: dp.day,
    });
  });

  dp.mainPlaces?.forEach((place) => {
    if (!place?.trim() || isMovementPlaceText(place)) return;
    pushUniquePlace(items, seen, {
      name: parsePlaceWithAddress(place).name || place,
      address: parsePlaceWithAddress(place).address || "",
      kind: "attraction",
      icon: "🗺️",
      label: "관광",
      day: dp.day,
    });
  });

  return items;
}

/** 이동 구간 (수단·거리 표시용) */
export function buildChapter3RouteLegs(dp: DayPlan): Chapter3RouteLeg[] {
  const legs: Chapter3RouteLeg[] = [];
  const allSegments: PlanScheduleSegment[] = [];

  for (const block of SCHEDULE_BLOCKS) {
    const segments = dp[block.key] as PlanScheduleSegment[] | undefined;
    if (segments?.length) allSegments.push(...segments);
  }

  let prevPlace: string | null = null;
  for (const seg of allSegments) {
    const label = getSegmentMapLabel(seg);
    if (!label.trim() || isMovementPlaceText(label)) continue;
    if (prevPlace) {
      legs.push({
        from: prevPlace,
        to: label,
        transport: seg.transport || "이동",
        day: dp.day,
      });
    }
    prevPlace = label;
  }
  return legs;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

/** Directions API durationMs → "약 25분" / "약 1시간 10분" */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalMin = Math.max(1, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin}분`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "—";
  return formatDistanceKm(meters / 1000);
}

/** 비어 있지 않은 장소 설명을 우선. 앞쪽 값이 사용자가 입력한 설명 */
export function preferPlaceDescription(
  ...values: Array<string | undefined | null>
): string {
  for (const value of values) {
    if (value?.trim()) return value;
  }
  return "";
}

/**
 * 불러온 앨범에 장소 설명이 없으면, 같은 일차·장소의 기존 설명을 유지한다.
 * 자동 저장이 설명만 누락한 채 사진을 덮어쓰는 경우를 막는다.
 */
export function preservePlaceDescriptions(
  incoming: Chapter3AlbumDay[],
  ...fallbacks: Array<Chapter3AlbumDay[] | null | undefined>
): Chapter3AlbumDay[] {
  const byKey = new Map<string, string>();
  for (const days of fallbacks) {
    if (!days) continue;
    for (const day of days) {
      for (const place of day.places || []) {
        if (!place.description?.trim()) continue;
        const key = `${day.day}:${place.id}`;
        if (!byKey.has(key)) byKey.set(key, place.description);
      }
    }
  }
  if (byKey.size === 0) return incoming;
  return incoming.map((day) => ({
    ...day,
    places: (day.places || []).map((place) => {
      if (place.description?.trim()) return place;
      const kept = byKey.get(`${day.day}:${place.id}`);
      return kept ? { ...place, description: kept } : place;
    }),
  }));
}

function placesKeptBesideSkeleton(
  savedPlaces: Chapter3AlbumPlace[],
  skeletonPlaces: Chapter3AlbumPlace[],
): Chapter3AlbumPlace[] {
  const ids = new Set(skeletonPlaces.map((place) => place.id));
  return savedPlaces.filter(
    (place) => !ids.has(place.id) && (place.photos.length > 0 || Boolean(place.description?.trim())),
  );
}

function appendSavedDaysMissingFromSkeleton(
  merged: Chapter3AlbumDay[],
  saved: Chapter3AlbumDay[],
): Chapter3AlbumDay[] {
  const days = new Set(merged.map((day) => day.day));
  const extra = saved.filter((day) => !days.has(day.day));
  if (extra.length === 0) return merged;
  return [...merged, ...extra].sort((a, b) => a.day - b.day);
}

/** 저장된 앨범과 계획서 골격 병합. 사용자가 입력한 장소 설명을 유지한다. */
export function mergeAlbumDays(
  skeleton: Chapter3AlbumDay[],
  saved: Chapter3AlbumDay[],
): Chapter3AlbumDay[] {
  if (skeleton.length === 0) return saved;
  const savedByDay = new Map(saved.map((d) => [d.day, d]));

  const merged = skeleton.map((skel) => {
    const prev = savedByDay.get(skel.day);
    if (!prev) return skel;

    const prevPlaces = new Map(prev.places.map((p) => [p.id, p]));
    return {
      ...skel,
      dateIso: prev.dateIso || skel.dateIso,
      dateLabel: prev.dateLabel || skel.dateLabel,
      places: [
        ...skel.places.map((place) => {
          const existing = prevPlaces.get(place.id);
          if (!existing) return place;
          return {
            ...place,
            description: preferPlaceDescription(existing.description, place.description),
            photos: existing.photos || [],
          };
        }),
        ...placesKeptBesideSkeleton(prev.places, skel.places),
      ],
    };
  });
  return appendSavedDaysMissingFromSkeleton(merged, saved);
}

/** 수동 입력 앨범 병합 — 사용자가 입력한 장소 설명과 사진을 유지 */
export function mergeManualAlbumDays(
  skeleton: Chapter3AlbumDay[],
  saved: Chapter3AlbumDay[],
): Chapter3AlbumDay[] {
  if (skeleton.length === 0) {
    return saved.map((d) => ({
      ...d,
      places: consolidateManualAlbumDayPlaces(d.day, d.places),
    }));
  }
  const savedByDay = new Map(saved.map((d) => [d.day, d]));

  const merged = skeleton.map((skel) => {
    const prev = savedByDay.get(skel.day);
    if (!prev) return skel;

    const prevPlaces = consolidateManualAlbumDayPlaces(skel.day, prev.places);
    const prevPlacesById = new Map(prevPlaces.map((p) => [p.id, p]));
    return {
      ...skel,
      dateIso: prev.dateIso || skel.dateIso,
      dateLabel: prev.dateLabel || skel.dateLabel,
      places: consolidateManualAlbumDayPlaces(skel.day, [
        ...skel.places.map((place) => {
          const existing = prevPlacesById.get(place.id);
          if (!existing) return place;
          return {
            ...place,
            description: preferPlaceDescription(existing.description, place.description),
            photos: existing.photos || [],
          };
        }),
        ...placesKeptBesideSkeleton(prevPlaces, skel.places),
      ]),
    };
  });
  return appendSavedDaysMissingFromSkeleton(
    merged,
    saved.map((day) => ({
      ...day,
      places: consolidateManualAlbumDayPlaces(day.day, day.places),
    })),
  );
}

// --- 수동 여행 계획 (기존 여행 앨범용) ---

export type Chapter3AlbumSource = "chapter2" | "manual";

export interface Chapter3ManualTrip {
  id: string;
  title: string;
  planRequest: PlanRequest;
  dayPlans: DayPlan[];
  createdAt: string;
  updatedAt: string;
}

export function manualTripAlbumPlanId(tripId: string): string {
  return `manual-${tripId}`;
}

export function parseManualTripIdFromPlanId(sourcePlanId: string): string | null {
  const prefix = "manual-";
  if (!sourcePlanId.startsWith(prefix)) return null;
  const tripId = sourcePlanId.slice(prefix.length).trim();
  return tripId || null;
}

export type ManualScheduleKey = "morningSchedule" | "afternoonSchedule";

/** @deprecated 예전 오전/오후 블록 앨범 ID — 마이그레이션용 */
export function blockAlbumPlaceId(day: number, scheduleKey: ManualScheduleKey): string {
  return `d${day}-${scheduleKey}-album`;
}

export function manualDayAlbumPlaceId(day: number): string {
  return `d${day}-manual-album`;
}

const LEGACY_MANUAL_ALBUM_BLOCK_IDS: ManualScheduleKey[] = ["morningSchedule", "afternoonSchedule"];

function isLegacyManualAlbumBlockPlace(day: number, place: Chapter3AlbumPlace): boolean {
  return LEGACY_MANUAL_ALBUM_BLOCK_IDS.some((key) => place.id === blockAlbumPlaceId(day, key));
}

/** 예전 오전/오후 블록 사진을 일차 단일 앨범으로 합침 */
export function consolidateManualAlbumDayPlaces(
  day: number,
  places: Chapter3AlbumPlace[],
): Chapter3AlbumPlace[] {
  const targetId = manualDayAlbumPlaceId(day);
  const legacyBlocks = places.filter((p) => isLegacyManualAlbumBlockPlace(day, p));
  if (legacyBlocks.length === 0) return places;

  const target = places.find((p) => p.id === targetId);
  const others = places.filter(
    (p) => p.id !== targetId && !isLegacyManualAlbumBlockPlace(day, p),
  );
  const seenPhotoIds = new Set<string>();
  const mergedPhotos: Chapter3AlbumPhoto[] = [];
  for (const photo of [
    ...(target?.photos ?? []),
    ...legacyBlocks.flatMap((p) => p.photos),
  ]) {
    if (seenPhotoIds.has(photo.id)) continue;
    seenPhotoIds.add(photo.id);
    mergedPhotos.push(photo);
  }

  return [
    {
      id: targetId,
      name: "사진 앨범",
      address: target?.address ?? "",
      description: preferPlaceDescription(
        target?.description,
        ...legacyBlocks.map((place) => place.description),
      ),
      kind: "destination",
      photos: mergedPhotos,
    },
    ...others,
  ];
}

/** 수동 입력 앨범 — 일차별 단일 사진 앨범 */
export function buildAlbumDaysFromManualPlans(dayPlans: DayPlan[]): Chapter3AlbumDay[] {
  return [...dayPlans]
    .sort((a, b) => a.day - b.day)
    .map((dp) => ({
      day: dp.day,
      dateIso: dp.dateIso,
      dateLabel: dp.dateIso
        ? formatDateSlash(dp.dateIso)
        : dp.dateLabel || `${dp.day}일차`,
      places: [
        {
          id: manualDayAlbumPlaceId(dp.day),
          name: "사진 앨범",
          address: "",
          description: "",
          kind: "destination" as const,
          photos: [],
        },
      ],
    }));
}

export function ensureManualTripSegmentIds(trip: Chapter3ManualTrip): Chapter3ManualTrip {
  const assignIds = (segments?: PlanScheduleSegment[]) =>
    (segments || []).map((seg) =>
      seg.segmentId
        ? seg
        : { ...seg, segmentId: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
    );

  return {
    ...trip,
    dayPlans: trip.dayPlans.map((dp) => ({
      ...dp,
      morningSchedule: assignIds(dp.morningSchedule),
      afternoonSchedule: assignIds(dp.afternoonSchedule),
    })),
  };
}

export function newScheduleSegment(label = "관광"): PlanScheduleSegment {
  return {
    segmentId: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    place: "",
    notes: "",
  };
}

export function createManualDayPlan(day: number): DayPlan {
  return {
    day,
    title: `${day}일차`,
    dateLabel: `${day}일차`,
    mainPlaces: [],
    transport: "",
    estimatedCost: "",
    staySuggestion: "",
    note: "",
    morningSchedule: [],
    afternoonSchedule: [],
    eveningSchedule: [],
    lunchRecommendations: [],
    dinnerRecommendations: [],
    accommodationRecommendations: [],
  };
}

export function createManualTrip(title = "기존 여행"): Chapter3ManualTrip {
  const now = new Date().toISOString();
  const id = `trip-${Date.now()}`;
  return {
    id,
    title,
    planRequest: { ...initialPlanRequest },
    dayPlans: [createManualDayPlan(1)],
    createdAt: now,
    updatedAt: now,
  };
}

export function syncManualTripDayCount(trip: Chapter3ManualTrip): Chapter3ManualTrip {
  const { startDate, endDate } = trip.planRequest;
  if (!startDate || !endDate) return trip;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return trip;

  const dayCount =
    Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (dayCount < 1 || dayCount > 30) return trip;

  const byDay = new Map(trip.dayPlans.map((d) => [d.day, d]));
  const dayPlans: DayPlan[] = [];
  for (let i = 0; i < dayCount; i++) {
    const day = i + 1;
    const existing = byDay.get(day);
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dateIso = date.toISOString().slice(0, 10);
    const dateLabel = formatDateSlash(dateIso);
    dayPlans.push(
      existing
        ? { ...existing, day, dateLabel, dateIso }
        : {
            ...createManualDayPlan(day),
            dateLabel,
            dateIso,
          },
    );
  }
  return { ...trip, dayPlans, updatedAt: new Date().toISOString() };
}

// --- 시뮬레이션 지도 (2번 챕터와 별개) ---

export interface Chapter3SimPlace {
  id: string;
  name: string;
  address: string;
  kind: Chapter3PlaceKind;
  /** 이전 장소에서 이동 시 수단 */
  transport?: string;
}

export interface Chapter3SimDay {
  day: number;
  dateLabel: string;
  places: Chapter3SimPlace[];
}

export interface Chapter3SimMapConfig {
  regionHint: string;
  departure: string;
  days: Chapter3SimDay[];
  /** 일정(일차)과 무관하게 등록·관리하는 여행지 목록 */
  travelPlaces: Chapter3TravelPlaceEntry[];
  /** 국내=네이버 / 해외=구글. 미설정 시 국내 */
  mapRegion?: "domestic" | "overseas";
}

/** 시뮬레이션 지도 — 일정과 분리된 여행지명·주소 */
export interface Chapter3TravelPlaceEntry {
  id: string;
  name: string;
  address: string;
  updatedAt: string;
}

export function createDefaultSimMap(): Chapter3SimMapConfig {
  return {
    regionHint: "대한민국",
    departure: "",
    days: [{ day: 1, dateLabel: "1일차", places: [] }],
    travelPlaces: [],
    mapRegion: "domestic",
  };
}

export function newTravelPlaceEntry(): Chapter3TravelPlaceEntry {
  return {
    id: `travel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    address: "",
    updatedAt: new Date().toISOString(),
  };
}

export function travelPlaceMapLabel(place: Chapter3TravelPlaceEntry): string {
  return formatPlaceWithAddress(place.name, place.address);
}

export function travelPlaceToMapItem(place: Chapter3TravelPlaceEntry): Chapter3MapPlaceItem {
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    kind: "destination",
    icon: "📍",
    label: "여행지",
    day: 0,
  };
}

export function buildTravelPlacesRoute(places: Chapter3TravelPlaceEntry[]): string[] {
  return places
    .filter((p) => p.name?.trim() || p.address?.trim())
    .map((p) => travelPlaceMapLabel(p));
}

export function normalizeSimMapConfig(
  raw: Partial<Chapter3SimMapConfig> | null | undefined,
): Chapter3SimMapConfig {
  const base = createDefaultSimMap();
  if (!raw || !Array.isArray(raw.days)) return base;
  const mapRegion =
    raw.mapRegion === "overseas" || raw.mapRegion === "domestic"
      ? raw.mapRegion
      : base.mapRegion;
  return {
    regionHint: raw.regionHint ?? base.regionHint,
    departure: raw.departure ?? base.departure,
    days: raw.days,
    travelPlaces: Array.isArray(raw.travelPlaces) ? raw.travelPlaces : [],
    mapRegion,
  };
}

function simPlaceKindMeta(kind: Chapter3PlaceKind): { icon: string; label: string } {
  if (kind === "accommodation") return { icon: "🏨", label: "숙소" };
  if (kind === "restaurant") return { icon: "🍽️", label: "식당" };
  if (kind === "attraction") return { icon: "🎯", label: "관광지" };
  return { icon: "📍", label: "목적지" };
}

export function simPlaceToMapItem(place: Chapter3SimPlace, day: number): Chapter3MapPlaceItem {
  const meta = simPlaceKindMeta(place.kind);
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    kind: place.kind,
    icon: meta.icon,
    label: meta.label,
    day,
  };
}

export function simPlaceMapLabel(place: Chapter3SimPlace): string {
  return formatPlaceWithAddress(place.name, place.address);
}

export function buildSimAddressLookup(config: Chapter3SimMapConfig): Map<string, string> {
  const lookup = new Map<string, string>();
  const addEntry = (name: string, address: string) => {
    if (!name?.trim() || !address?.trim()) return;
    const key = name.trim().toLowerCase().replace(/\s+/g, "");
    lookup.set(key, address.trim());
  };
  (config.travelPlaces ?? []).forEach((place) => addEntry(place.name, place.address));
  config.days.forEach((day) => {
    day.places.forEach((place) => addEntry(place.name, place.address));
  });
  return lookup;
}

export function buildSimDayRoutePlaces(
  day: Chapter3SimDay,
  config: Chapter3SimMapConfig,
  totalDays: number,
): string[] {
  const route: string[] = [];
  if (day.day === 1 && config.departure?.trim()) {
    route.push(config.departure.trim());
  }
  day.places
    .filter((p) => p.kind !== "attraction" && (p.name?.trim() || p.address?.trim()))
    .forEach((p) => route.push(simPlaceMapLabel(p)));
  if (day.day === totalDays && config.departure?.trim()) {
    route.push(config.departure.trim());
  }
  return route;
}

export function buildSimRouteDaySegments(
  day: Chapter3SimDay,
  config: Chapter3SimMapConfig,
): MapRouteDaySegment[] {
  const places = buildSimDayRoutePlaces(day, config, config.days.length);
  if (places.length === 0) return [];
  return [{ day: day.day, color: getPlanDayColor(day.day), places }];
}

export function buildSimRouteLegs(day: Chapter3SimDay): Chapter3RouteLeg[] {
  const travel = day.places.filter((p) => p.kind !== "attraction" && p.name?.trim());
  const legs: Chapter3RouteLeg[] = [];
  for (let i = 1; i < travel.length; i++) {
    legs.push({
      from: simPlaceMapLabel(travel[i - 1]),
      to: simPlaceMapLabel(travel[i]),
      transport: travel[i].transport || "이동",
      day: day.day,
    });
  }
  return legs;
}

export function isSimMapDomestic(config: Chapter3SimMapConfig): boolean {
  return (config.mapRegion ?? "domestic") !== "overseas";
}

/** 2번 챕터 계획서 → 시뮬레이션 초기값 (단방향 복사) */
export function importDayPlansToSimMap(
  dayPlans: DayPlan[],
  regionHint: string,
  departure: string,
  additionalTravelInfo?: AdditionalTravelInfo | null,
): Chapter3SimMapConfig {
  const days: Chapter3SimDay[] = [...dayPlans]
    .sort((a, b) => a.day - b.day)
    .map((dp) => {
      const mapPlaces = buildChapter3MapPlacesForDay(dp);
      const attractions = buildNearbyAttractions(dp, additionalTravelInfo);
      const places: Chapter3SimPlace[] = [
        ...mapPlaces.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          kind: p.kind,
          transport: "",
        })),
        ...attractions
          .filter((a) => !mapPlaces.some((m) => m.name === a.name))
          .map((a) => ({
            id: a.id,
            name: a.name,
            address: a.address,
            kind: "attraction" as const,
            transport: "",
          })),
      ];
      return {
        day: dp.day,
        dateLabel: dp.dateLabel || `${dp.day}일차`,
        places,
      };
    });

  return {
    regionHint: regionHint || "대한민국",
    departure: departure || "",
    days: days.length > 0 ? days : createDefaultSimMap().days,
    travelPlaces: [],
    mapRegion: /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(`${regionHint} ${departure}`) ? "domestic" : "overseas",
  };
}

export function newSimPlace(kind: Chapter3PlaceKind = "destination"): Chapter3SimPlace {
  return {
    id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    address: "",
    kind,
    transport: "",
  };
}
