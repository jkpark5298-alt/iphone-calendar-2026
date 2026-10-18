import {
  emptyPersonAlbumState,
  mergePersonAlbumKeeps,
  PERSON_ALBUM_CATEGORIES,
  personAlbumKeepsFromItems,
  prunePersonAlbumHidden,
  SCENE_ALBUMS,
  type PersonAlbumKeep,
  type PersonAlbumState,
  type PhotobookPersonSource,
} from "./photobook-person-album";

const STORAGE_KEY = SCENE_ALBUMS.person.storageKey;

function normalizeState(raw: unknown): PersonAlbumState {
  if (!raw || typeof raw !== "object") return emptyPersonAlbumState();
  const keepsRaw = (raw as PersonAlbumState).keeps;
  const hiddenRaw = (raw as PersonAlbumState).hidden;
  const keeps: PersonAlbumKeep[] = [];
  const seen = new Set<string>();
  if (Array.isArray(keepsRaw)) {
    for (const entry of keepsRaw) {
      if (!entry || typeof entry !== "object") continue;
      const imagePath = String((entry as PersonAlbumKeep).imagePath || "").trim();
      if (!imagePath || seen.has(imagePath)) continue;
      seen.add(imagePath);
      const memo = String((entry as PersonAlbumKeep).memo || "(제목 없음)");
      const storedKeyword = String((entry as PersonAlbumKeep).keyword || "").trim();
      keeps.push({
        id: String((entry as PersonAlbumKeep).id || `pk_${keeps.length}`),
        sourceItemId: String((entry as PersonAlbumKeep).sourceItemId || ""),
        imagePath,
        memo,
        keyword: storedKeyword || (memo.trim().startsWith("#") ? memo.trim() : ""),
        createdAt: String(
          (entry as PersonAlbumKeep).createdAt ||
            (entry as PersonAlbumKeep).keptAt ||
            new Date().toISOString(),
        ),
        keptAt: String(
          (entry as PersonAlbumKeep).keptAt || new Date().toISOString(),
        ),
      });
    }
  }
  const hidden = Array.isArray(hiddenRaw)
    ? [
        ...new Set(
          hiddenRaw
            .map((key) => String(key || "").trim())
            .filter(Boolean),
        ),
      ]
    : [];
  return { keeps, hidden };
}

export function readPersonAlbumState(storageKey: string = STORAGE_KEY): PersonAlbumState {
  if (typeof window === "undefined") return emptyPersonAlbumState();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return emptyPersonAlbumState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyPersonAlbumState();
  }
}

export function writePersonAlbumState(
  state: PersonAlbumState,
  storageKey: string = STORAGE_KEY,
): PersonAlbumState {
  const normalized = normalizeState(state);
  if (typeof window === "undefined") return normalized;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  } catch (error) {
    console.error("Scene album write failed:", error);
  }
  return normalized;
}

/** Keep matching photos in the scene album before photobook cards are deleted. */
export function keepPersonPhotosFromDeletedItems(
  items: PhotobookPersonSource[],
  options?: { storageKey?: string; categories?: readonly string[] },
): PersonAlbumState {
  const storageKey = options?.storageKey || STORAGE_KEY;
  const categories = options?.categories || PERSON_ALBUM_CATEGORIES;
  const current = readPersonAlbumState(storageKey);
  const incoming = personAlbumKeepsFromItems(items, {
    hidden: current.hidden,
    categories,
  });
  if (incoming.length === 0) {
    if (items.length === 0) return current;
    const pruned = prunePersonAlbumHidden(
      current.hidden,
      items.map((item) => item.id),
    );
    if (pruned.length === current.hidden.length) return current;
    return writePersonAlbumState({ ...current, hidden: pruned }, storageKey);
  }
  const deletedIds = items.map((item) => item.id);
  return writePersonAlbumState({
    keeps: mergePersonAlbumKeeps(current.keeps, incoming),
    hidden: prunePersonAlbumHidden(current.hidden, deletedIds),
  }, storageKey);
}
