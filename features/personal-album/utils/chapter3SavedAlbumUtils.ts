import type { Chapter3AlbumDay } from "./chapter3Utils";
import { parseManualTripIdFromPlanId } from "./chapter3Utils";
import { formatDateSlash, resolveAlbumDayDateIso } from "./albumDateUtils";

export type SavedTravelAlbumStatus = "draft" | "saved";

/** 여행 앨범 vs 개인 앨범 */
export type AlbumKind = "travel" | "personal";

/** 개인 앨범 사진 구분 기준 */
export type AlbumGroupBy = "day" | "year" | "place";

/** 용량이 찰 때 원본 대신 가리키는 압축 사진 묶음 */
export type AlbumPhotoArchive = {
  version: 1;
  updatedAt: string;
  photoCount: number;
  compressedBytes: number;
};

export interface SavedTravelAlbum {
  id: string;
  title: string;
  status: SavedTravelAlbumStatus;
  /** 기본 travel — 기존 저장분과 호환 */
  kind?: AlbumKind;
  sourcePlanId: string;
  sourceLabel?: string;
  days: Chapter3AlbumDay[];
  createdAt: string;
  updatedAt: string;
  /** 최초 「확정」 완료 시각 — 수정 중 여부 판별용 */
  savedAt?: string;
  /** 확정 앨범을 수정할 때 만든 임시 저장의 원본 id */
  originAlbumId?: string;
  deletedAt?: string;
  /** PC·아이폰이 함께 보는 압축 사진 위치 */
  photoArchive?: AlbumPhotoArchive;
}

export function albumKindOf(album: Pick<SavedTravelAlbum, "kind"> | null | undefined): AlbumKind {
  return album?.kind === "personal" ? "personal" : "travel";
}

export function filterAlbumsByKind(
  albums: SavedTravelAlbum[],
  kind: AlbumKind,
): SavedTravelAlbum[] {
  return albums.filter((album) => albumKindOf(album) === kind);
}

const STORAGE_KEY = "iphone-calendar-personal-album-saved-albums-v1";
const MAX_DELETED_ALBUMS = 30;

export type SavedAlbumsRoot = {
  version: 1;
  albums: SavedTravelAlbum[];
  deletedAlbums?: SavedTravelAlbum[];
  updatedAt: string;
};

function emptyRoot(): SavedAlbumsRoot {
  return { version: 1, albums: [], deletedAlbums: [], updatedAt: new Date().toISOString() };
}

function normalizeDeletedAlbum(raw: Partial<SavedTravelAlbum>): SavedTravelAlbum | null {
  const album = normalizeSavedAlbum(raw);
  if (!album) return null;
  return {
    ...album,
    deletedAt: raw.deletedAt || album.updatedAt,
  };
}

export function readSavedAlbumsRoot(): SavedAlbumsRoot {
  if (typeof window === "undefined") return emptyRoot();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyRoot();
    const parsed = JSON.parse(raw) as SavedAlbumsRoot;
    if (parsed.version === 1 && Array.isArray(parsed.albums)) {
      return {
        version: 1,
        albums: parsed.albums.map(normalizeSavedAlbum).filter(Boolean) as SavedTravelAlbum[],
        deletedAlbums: Array.isArray(parsed.deletedAlbums)
          ? parsed.deletedAlbums.map(normalizeDeletedAlbum).filter(Boolean) as SavedTravelAlbum[]
          : [],
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
    return emptyRoot();
  } catch {
    return emptyRoot();
  }
}

export function writeSavedAlbumsRoot(root: SavedAlbumsRoot): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        albums: root.albums,
        deletedAlbums: (root.deletedAlbums || []).slice(0, MAX_DELETED_ALBUMS),
        updatedAt: root.updatedAt || new Date().toISOString(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function normalizePhotoArchive(raw: unknown): AlbumPhotoArchive | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<AlbumPhotoArchive>;
  if (value.version !== 1) return undefined;
  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    photoCount: Number(value.photoCount) || 0,
    compressedBytes: Number(value.compressedBytes) || 0,
  };
}

export function normalizeSavedAlbum(raw: Partial<SavedTravelAlbum>): SavedTravelAlbum | null {
  if (!raw?.id || typeof raw.id !== "string") return null;
  const now = new Date().toISOString();
  const kind: AlbumKind = raw.kind === "personal" ? "personal" : "travel";
  const defaultTitle = kind === "personal" ? "개인앨범" : "여행 앨범";
  return {
    id: raw.id,
    title: String(raw.title || defaultTitle).trim() || defaultTitle,
    status: raw.status === "draft" ? "draft" : "saved",
    kind,
    sourcePlanId: String(raw.sourcePlanId || ""),
    sourceLabel: raw.sourceLabel?.trim() || undefined,
    days: Array.isArray(raw.days) ? raw.days : [],
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    savedAt:
      raw.savedAt ||
      (raw.status === "saved" ? raw.updatedAt || raw.createdAt || now : undefined),
    originAlbumId: raw.originAlbumId?.trim() || undefined,
    deletedAt: raw.deletedAt,
    photoArchive: normalizePhotoArchive(raw.photoArchive),
  };
}

export function countAlbumPhotos(days: Chapter3AlbumDay[]): number {
  return days.reduce(
    (sum, day) => sum + day.places.reduce((s, place) => s + place.photos.length, 0),
    0,
  );
}

export function getAlbumPlaceSearchText(album: SavedTravelAlbum): string {
  const placeNames = album.days
    .flatMap((day) => day.places)
    .map((place) => [place.name, place.address].filter(Boolean).join(" "))
    .join(" ");

  const photoPlaces = album.days
    .flatMap((day) => day.places.flatMap((place) => place.photos))
    .map((photo) => photo.exifPlaceName?.trim() || "")
    .filter(Boolean)
    .join(" ");

  return [placeNames, photoPlaces, album.sourceLabel || ""].filter(Boolean).join(" ");
}

export function getAlbumDateRangeText(days: Chapter3AlbumDay[]): string {
  const isos = days
    .map((day) => resolveAlbumDayDateIso(day))
    .filter(Boolean)
    .sort();
  if (isos.length === 0) return "날짜 미정";
  const start = formatDateSlash(isos[0]);
  const end = formatDateSlash(isos[isos.length - 1]);
  if (start === end) return start;
  return `${start} ~ ${end}`;
}

export function formatAlbumCreatedDate(createdAt: string): string {
  try {
    const iso = new Date(createdAt).toISOString().slice(0, 10);
    return formatDateSlash(iso);
  } catch {
    return createdAt;
  }
}

export function searchSavedAlbums(
  albums: SavedTravelAlbum[],
  query: string,
): SavedTravelAlbum[] {
  const q = query.trim().toLowerCase();
  if (!q) return albums;
  return albums.filter((album) => {
    const dateText = getAlbumDateRangeText(album.days).toLowerCase();
    const created = formatAlbumCreatedDate(album.createdAt).toLowerCase();
    const placeText = getAlbumPlaceSearchText(album).toLowerCase();
    return (
      album.title.toLowerCase().includes(q) ||
      dateText.includes(q) ||
      created.includes(q) ||
      placeText.includes(q) ||
      (album.sourceLabel || "").toLowerCase().includes(q)
    );
  });
}

function albumRecordTime(album: SavedTravelAlbum): number {
  const parsed = Date.parse(album.updatedAt || album.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 여행이 끝난 날. 날짜가 없으면 저장 시각으로 대신한다. */
export function albumLatestTripTime(album: SavedTravelAlbum): number {
  const latestIso = album.days
    .map((day) => resolveAlbumDayDateIso(day))
    .filter(Boolean)
    .sort()
    .at(-1);
  if (latestIso) {
    const parsed = Date.parse(`${latestIso}T00:00:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return albumRecordTime(album);
}

/** 확정·작업 중 목록 — 여행일이 최근인 앨범이 위 */
export function sortAlbumsByRecent(albums: SavedTravelAlbum[]): SavedTravelAlbum[] {
  return [...albums].sort((a, b) => {
    const tripDiff = albumLatestTripTime(b) - albumLatestTripTime(a);
    if (tripDiff !== 0) return tripDiff;
    return albumRecordTime(b) - albumRecordTime(a);
  });
}

export function createSavedAlbumId(): string {
  return `album-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 「새 앨범」으로 확정본과 따로 저장하는 계획 id */
export const FRESH_ALBUM_PLAN_PREFIX = "fresh-";

export function isFreshAlbumPlanId(sourcePlanId?: string | null): boolean {
  return Boolean(sourcePlanId?.startsWith(FRESH_ALBUM_PLAN_PREFIX));
}

export function createFreshAlbumPlanId(): string {
  return `${FRESH_ALBUM_PLAN_PREFIX}${createSavedAlbumId()}`;
}

export function clearSavedAlbumsStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function normalizeAlbumTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, "").toLowerCase();
}

function isGenericAlbumTitle(title: string): boolean {
  const key = normalizeAlbumTitleKey(title);
  return !key || key === "여행앨범" || key === "사진앨범";
}

function albumTripId(album: SavedTravelAlbum): string {
  return parseManualTripIdFromPlanId(album.sourcePlanId || "") || "";
}

/** 삭제한 그 앨범만 숨긴다. 복원 시각이 삭제 시각보다 늦으면 삭제 기록으로 다시 숨기지 않는다. */
export function albumIsHiddenByTombstone(
  album: SavedTravelAlbum,
  deleted: SavedTravelAlbum[],
): boolean {
  return deleted.some((tomb) => {
    const sameAlbum = tomb.id === album.id;
    const sameOrigin = Boolean(album.originAlbumId) && album.originAlbumId === tomb.id;
    if (!sameAlbum && !sameOrigin) return false;
    const deletedAt = Date.parse(tomb.deletedAt || "");
    const activeAt = Date.parse(album.updatedAt || album.savedAt || album.createdAt || "");
    if (Number.isFinite(deletedAt) && Number.isFinite(activeAt) && activeAt > deletedAt) return false;
    return true;
  });
}

export function albumsAreSameFamily(a: SavedTravelAlbum, b: SavedTravelAlbum): boolean {
  if (a.id === b.id) return true;
  if (a.originAlbumId && (a.originAlbumId === b.id || a.originAlbumId === b.originAlbumId)) return true;
  if (b.originAlbumId && b.originAlbumId === a.id) return true;
  const planA = a.sourcePlanId?.trim() || "";
  const planB = b.sourcePlanId?.trim() || "";
  // 확정 뒤에 만든 새 앨범은 제목·여행이 같아도 기존 앨범과 합치지 않는다
  if (isFreshAlbumPlanId(planA) || isFreshAlbumPlanId(planB)) {
    return Boolean(planA && planB && planA === planB);
  }
  if (planA && planB && planA === planB) return true;
  const tripA = albumTripId(a);
  const tripB = albumTripId(b);
  if (tripA && tripB && tripA === tripB) return true;
  if (!isGenericAlbumTitle(a.title) && normalizeAlbumTitleKey(a.title) === normalizeAlbumTitleKey(b.title)) {
    return true;
  }
  return false;
}

function preferAlbumRecord(a: SavedTravelAlbum, b: SavedTravelAlbum): SavedTravelAlbum {
  const countA = countAlbumPhotos(a.days);
  const countB = countAlbumPhotos(b.days);
  if (Math.abs(countA - countB) >= 5) return countA >= countB ? a : b;
  const timeA = Date.parse(a.updatedAt || a.createdAt || "");
  const timeB = Date.parse(b.updatedAt || b.createdAt || "");
  if (timeA !== timeB) return timeA >= timeB ? a : b;
  if (a.status === "saved" && b.status !== "saved") return a;
  if (b.status === "saved" && a.status !== "saved") return b;
  return countA >= countB ? a : b;
}

function groupAlbumFamilies(albums: SavedTravelAlbum[]): SavedTravelAlbum[][] {
  const groups: SavedTravelAlbum[][] = [];
  for (const album of albums) {
    const index = groups.findIndex((group) => group.some((item) => albumsAreSameFamily(item, album)));
    if (index >= 0) groups[index].push(album);
    else groups.push([album]);
  }
  return groups;
}

function restoreDraftAsSaved(album: SavedTravelAlbum): SavedTravelAlbum {
  return {
    ...album,
    status: "saved",
    originAlbumId: undefined,
    savedAt: album.savedAt || album.updatedAt || album.createdAt,
  };
}

function collapseAlbumFamily(group: SavedTravelAlbum[]): SavedTravelAlbum[] {
  if (group.length <= 1) {
    const only = group[0];
    // 확정 이력이 있는 draft만 홀로 남은 경우 → 확정으로 복원
    // (동기화 시 확정본이 지워지고 임시만 남는 케이스 포함)
    if (only?.status === "draft" && only.savedAt) {
      return [restoreDraftAsSaved(only)];
    }
    return group;
  }

  const saved = group.filter((album) => album.status === "saved");
  const drafts = group.filter((album) => album.status === "draft");

  let keptSaved: SavedTravelAlbum | null =
    saved.length > 0 ? saved.reduce(preferAlbumRecord) : null;

  // 확정본이 병합에서 사라지고 임시만 남은 경우: savedAt 있으면 확정 복원
  if (!keptSaved) {
    const recoverable = drafts.filter((album) => Boolean(album.savedAt));
    if (recoverable.length > 0) {
      keptSaved = restoreDraftAsSaved(recoverable.reduce(preferAlbumRecord));
    }
  }

  // 확정이 있으면: 확정 이후에 수정된 임시본만 유지 (확정 직후 남은 구형 임시는 제거)
  let keptDraft: SavedTravelAlbum | null = null;
  if (keptSaved) {
    const newerDrafts = drafts.filter((album) => {
      if (album.id === keptSaved!.id) return false;
      const draftTime = Date.parse(album.updatedAt || album.createdAt || "");
      const savedTime = Date.parse(keptSaved!.updatedAt || keptSaved!.createdAt || "");
      return draftTime > savedTime;
    });
    if (newerDrafts.length > 0) {
      const newestDraft = newerDrafts.reduce(preferAlbumRecord);
      keptDraft = {
        ...newestDraft,
        status: "draft",
        originAlbumId: keptSaved.id,
      };
    }
  } else if (drafts.length > 0) {
    keptDraft = drafts.reduce(preferAlbumRecord);
  }

  const next: SavedTravelAlbum[] = [];
  if (keptSaved) next.push(keptSaved);
  if (keptDraft && keptDraft.id !== keptSaved?.id) next.push(keptDraft);
  return next;
}

/** 확정 1개 + 임시저장 1개만 남기고, 수정으로 draft가 된 확정 앨범은 복원 */
export function repairAndDedupeAlbums(albums: SavedTravelAlbum[]): SavedTravelAlbum[] {
  const collapsed = groupAlbumFamilies(albums).flatMap(collapseAlbumFamily);
  const seen = new Set<string>();
  const unique: SavedTravelAlbum[] = [];
  for (const album of collapsed) {
    if (seen.has(album.id)) continue;
    seen.add(album.id);
    unique.push(album);
  }
  return unique.sort(
    (a, b) =>
      Date.parse(b.updatedAt || b.createdAt || "") -
      Date.parse(a.updatedAt || a.createdAt || ""),
  );
}

export function findDraftForOrigin(
  albums: SavedTravelAlbum[],
  originAlbumId: string,
): SavedTravelAlbum | undefined {
  const origin = albums.find((album) => album.id === originAlbumId);
  return albums.find((album) => {
    if (album.status !== "draft") return false;
    if (album.originAlbumId === originAlbumId) return true;
    if (origin && album.sourcePlanId && album.sourcePlanId === origin.sourcePlanId) return true;
    if (origin && albumsAreSameFamily(album, origin)) return true;
    return false;
  });
}

export function capDeletedAlbums(deleted: SavedTravelAlbum[]): SavedTravelAlbum[] {
  return [...deleted]
    .sort(
      (a, b) =>
        Date.parse(b.deletedAt || b.updatedAt || "") -
        Date.parse(a.deletedAt || a.updatedAt || ""),
    )
    .slice(0, MAX_DELETED_ALBUMS);
}
