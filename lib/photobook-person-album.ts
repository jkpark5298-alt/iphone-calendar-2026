/** Auto-advance interval for the 人앨범 slideshow. */
export const PERSON_ALBUM_SLIDE_MS = 3000;

/** Pause autoplay this long after the user swipes or taps the strip. */
export const PERSON_ALBUM_USER_PAUSE_MS = 8000;

/**
 * Photobook image albums keyed by 2차 분류.
 * 人: 인물/She. 旅 (U+F981): 여행·풍경.
 */
export const SCENE_ALBUMS = {
  person: {
    id: "person",
    tab: "person-album",
    title: "人 앨범",
    categories: ["인물", "She"],
    storageKey: "iphone-calendar-photobook-person-album-v1",
    countLabel: "인물 사진",
    emptyMessage: "인물/She로 분류된 사진이 없습니다.",
  },
  trip: {
    id: "trip",
    tab: "trip-album",
    title: "\uF981 앨범",
    categories: ["여행", "풍경"],
    storageKey: "iphone-calendar-photobook-trip-album-v1",
    countLabel: "여행·풍경 사진",
    emptyMessage: "여행/풍경으로 분류된 사진이 없습니다.",
  },
} as const;

export type SceneAlbumId = keyof typeof SCENE_ALBUMS;
export type SceneAlbumTab = (typeof SCENE_ALBUMS)[SceneAlbumId]["tab"];

/** Categories that feed the photobook 人앨범 (matches insta-fact-library "인물"). */
export const PERSON_ALBUM_CATEGORIES = SCENE_ALBUMS.person.categories;

export function sceneAlbumById(id: SceneAlbumId) {
  return SCENE_ALBUMS[id];
}

export function sceneAlbumByTab(tab: string) {
  const id = (Object.keys(SCENE_ALBUMS) as SceneAlbumId[]).find(
    (key) => SCENE_ALBUMS[key].tab === tab,
  );
  return id ? SCENE_ALBUMS[id] : null;
}

/** Album that keeps photos for this 2차 분류, if any. */
export function sceneAlbumForCategory(category2: string) {
  const c = (category2 || "").trim();
  const id = (Object.keys(SCENE_ALBUMS) as SceneAlbumId[]).find((key) =>
    (SCENE_ALBUMS[key].categories as readonly string[]).includes(c),
  );
  return id ? SCENE_ALBUMS[id] : null;
}

export type PhotobookPersonSource = {
  id: string;
  keyword: string;
  category2: string;
  memo: string;
  /** Entry date YYYY-MM-DD */
  tag: string;
  imageUrls: string[];
};

/** Photos kept in 人앨범 after the photobook card was deleted. */
export type PersonAlbumKeep = {
  id: string;
  sourceItemId: string;
  imagePath: string;
  memo: string;
  /** Index keyword, shown as #keyword on the photo. */
  keyword: string;
  createdAt: string;
  keptAt: string;
};

export type PersonAlbumCard = {
  key: string;
  itemId: string;
  imagePath: string;
  memo: string;
  /** Same label as the photobook index `#keyword`. */
  keyword: string;
  dateLabel: string;
  sortAt: number;
  /** Set when the card comes from the keep store (item may be gone). */
  keepId?: string;
};

export type PersonAlbumState = {
  keeps: PersonAlbumKeep[];
  /** `${itemId}::${imagePath}` — live photos removed from 人앨범 only. */
  hidden: string[];
};

export function emptyPersonAlbumState(): PersonAlbumState {
  return { keeps: [], hidden: [] };
}

export function personAlbumHideKey(itemId: string, imagePath: string) {
  return `${itemId}::${imagePath}`;
}

export function isAlbumCategory(category2: string, categories: readonly string[]) {
  const c = (category2 || "").trim();
  return categories.includes(c);
}

export function isPersonAlbumCategory(category2: string) {
  return isAlbumCategory(category2, PERSON_ALBUM_CATEGORIES);
}

/**
 * Pick a different index than `current` (uniform among the rest).
 * `random` is injectable so the choice can be tested.
 */
export function nextRandomAlbumIndex(
  length: number,
  current: number,
  random: () => number = Math.random,
) {
  if (length <= 0) return 0;
  if (length === 1) return 0;
  const safeCurrent = Math.min(Math.max(0, current), length - 1);
  const pick = Math.floor(random() * (length - 1));
  return pick >= safeCurrent ? pick + 1 : pick;
}

/** Same `#keyword` label the photobook index shows. */
export function albumKeywordLabel(keyword: string) {
  const title = (keyword || "").trim();
  if (!title) return "";
  return title.startsWith("#") ? title : `#${title}`;
}

/** Keyword, or first line of memo. */
export function albumMemo(item: PhotobookPersonSource) {
  const title = item.keyword?.trim();
  if (title && title !== "일반") return title.startsWith("#") ? title : `#${title}`;

  const metaRaw = item.memo?.trim() || "";
  if (!metaRaw) return "(제목 없음)";

  const firstLine =
    metaRaw
      .split(/\n/)
      .map((part) => part.trim())
      .find(Boolean) || "";
  if (!firstLine) return "(제목 없음)";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

export function formatAlbumDate(isoOrTag: string) {
  if (!isoOrTag) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrTag)) {
    const [y, m, d] = isoOrTag.split("-").map(Number);
    return `${y}. ${m}. ${d}.`;
  }
  const d = new Date(isoOrTag);
  if (Number.isNaN(d.getTime())) return isoOrTag;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${d.getHours()}시 ${d.getMinutes()}분 ${d.getSeconds()}초`;
}

function keepIdFor(itemId: string, imagePath: string, index: number) {
  return `pk_${itemId}_${index}_${imagePath.length}`;
}

function tagSortAt(tag: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(tag)) {
    return new Date(`${tag}T12:00:00`).getTime() || 0;
  }
  return new Date(tag).getTime() || 0;
}

/** Snapshot category-matched photos to keep when deleting photobook cards. */
export function personAlbumKeepsFromItems(
  items: PhotobookPersonSource[],
  options?: { hidden?: Iterable<string>; now?: string; categories?: readonly string[] },
): PersonAlbumKeep[] {
  const hidden = new Set(options?.hidden || []);
  const now = options?.now || new Date().toISOString();
  const categories = options?.categories || PERSON_ALBUM_CATEGORIES;
  const next: PersonAlbumKeep[] = [];
  for (const item of items) {
    if (!isAlbumCategory(item.category2, categories)) continue;
    const paths = (item.imageUrls || []).filter(Boolean);
    if (paths.length === 0) continue;
    const memo = albumMemo(item);
    const keyword = albumKeywordLabel(item.keyword);
    const createdAt = item.tag || now;
    paths.forEach((imagePath, index) => {
      if (hidden.has(personAlbumHideKey(item.id, imagePath))) return;
      next.push({
        id: keepIdFor(item.id, imagePath, index),
        sourceItemId: item.id,
        imagePath,
        memo,
        keyword,
        createdAt,
        keptAt: now,
      });
    });
  }
  return next;
}

export function mergePersonAlbumKeeps(
  existing: PersonAlbumKeep[],
  incoming: PersonAlbumKeep[],
): PersonAlbumKeep[] {
  const byPath = new Set(existing.map((entry) => entry.imagePath));
  const next = [...existing];
  for (const entry of incoming) {
    if (!entry.imagePath || byPath.has(entry.imagePath)) continue;
    byPath.add(entry.imagePath);
    next.push(entry);
  }
  return next;
}

export function prunePersonAlbumHidden(
  hidden: string[],
  deletedItemIds: Iterable<string>,
): string[] {
  const deleted = new Set(deletedItemIds);
  return hidden.filter((key) => {
    const sep = key.indexOf("::");
    if (sep <= 0) return false;
    return !deleted.has(key.slice(0, sep));
  });
}

/**
 * Live person photos + kept photos (after item delete), minus album hides.
 * Live wins when the same imagePath appears in both.
 */
export function buildPersonAlbumCards(
  items: PhotobookPersonSource[],
  keeps: PersonAlbumKeep[] = [],
  hidden: Iterable<string> = [],
  categories: readonly string[] = PERSON_ALBUM_CATEGORIES,
): PersonAlbumCard[] {
  const hiddenSet = new Set(hidden);
  const next: PersonAlbumCard[] = [];
  const livePaths = new Set<string>();

  for (const item of items) {
    if (!isAlbumCategory(item.category2, categories)) continue;
    const paths = (item.imageUrls || []).filter(Boolean);
    if (paths.length === 0) continue;
    const memo = albumMemo(item);
    const keyword = albumKeywordLabel(item.keyword);
    const dateLabel = formatAlbumDate(item.tag);
    const sortAt = tagSortAt(item.tag);
    paths.forEach((imagePath, index) => {
      if (hiddenSet.has(personAlbumHideKey(item.id, imagePath))) return;
      livePaths.add(imagePath);
      next.push({
        key: `${item.id}:${imagePath}:${index}`,
        itemId: item.id,
        imagePath,
        memo,
        keyword,
        dateLabel,
        sortAt,
      });
    });
  }

  for (const keep of keeps) {
    if (!keep.imagePath || livePaths.has(keep.imagePath)) continue;
    next.push({
      key: `keep:${keep.id}`,
      itemId: keep.sourceItemId,
      imagePath: keep.imagePath,
      memo: keep.memo || "(제목 없음)",
      keyword: keep.keyword || (keep.memo?.trim().startsWith("#") ? keep.memo.trim() : ""),
      dateLabel: formatAlbumDate(keep.createdAt),
      sortAt: tagSortAt(keep.createdAt),
      keepId: keep.id,
    });
  }

  next.sort((a, b) => b.sortAt - a.sortAt);
  return next;
}

/** Flat cards from any photobook sources (selected album preview — no category filter). */
export function buildAlbumCardsFromSources(
  items: PhotobookPersonSource[],
): PersonAlbumCard[] {
  const next: PersonAlbumCard[] = [];
  for (const item of items) {
    const paths = (item.imageUrls || []).filter(Boolean);
    if (paths.length === 0) continue;
    const memo = albumMemo(item);
    const keyword = albumKeywordLabel(item.keyword);
    const dateLabel = formatAlbumDate(item.tag);
    const sortAt = tagSortAt(item.tag);
    paths.forEach((imagePath, index) => {
      next.push({
        key: `${item.id}:${imagePath}:${index}`,
        itemId: item.id,
        imagePath,
        memo,
        keyword,
        dateLabel,
        sortAt,
      });
    });
  }
  next.sort((a, b) => b.sortAt - a.sortAt);
  return next;
}

export function removePersonAlbumCards(
  state: PersonAlbumState,
  cards: PersonAlbumCard[],
): PersonAlbumState {
  if (cards.length === 0) return state;
  const removeKeepIds = new Set(
    cards.map((card) => card.keepId).filter(Boolean) as string[],
  );
  const hideKeys = new Set(state.hidden);
  for (const card of cards) {
    if (card.keepId) continue;
    hideKeys.add(personAlbumHideKey(card.itemId, card.imagePath));
  }
  return {
    keeps: state.keeps.filter((keep) => !removeKeepIds.has(keep.id)),
    hidden: [...hideKeys],
  };
}
