import {
  emptyPersonAlbumState,
  mergePersonAlbumKeeps,
  personAlbumKeepsFromItems,
  prunePersonAlbumHidden,
  type PersonAlbumKeep,
  type PersonAlbumState,
  type PhotobookPersonSource,
} from "./photobook-person-album";

const STORAGE_KEY = "iphone-calendar-photobook-person-album-v1";

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
      keeps.push({
        id: String((entry as PersonAlbumKeep).id || `pk_${keeps.length}`),
        sourceItemId: String((entry as PersonAlbumKeep).sourceItemId || ""),
        imagePath,
        memo: String((entry as PersonAlbumKeep).memo || "(제목 없음)"),
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

export function readPersonAlbumState(): PersonAlbumState {
  if (typeof window === "undefined") return emptyPersonAlbumState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPersonAlbumState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyPersonAlbumState();
  }
}

export function writePersonAlbumState(state: PersonAlbumState): PersonAlbumState {
  const normalized = normalizeState(state);
  if (typeof window === "undefined") return normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.error("Person album write failed:", error);
  }
  return normalized;
}

/** Keep person photos in 人앨범 before photobook cards are deleted. */
export function keepPersonPhotosFromDeletedItems(
  items: PhotobookPersonSource[],
): PersonAlbumState {
  const current = readPersonAlbumState();
  const incoming = personAlbumKeepsFromItems(items, {
    hidden: current.hidden,
  });
  if (incoming.length === 0) {
    if (items.length === 0) return current;
    const pruned = prunePersonAlbumHidden(
      current.hidden,
      items.map((item) => item.id),
    );
    if (pruned.length === current.hidden.length) return current;
    return writePersonAlbumState({ ...current, hidden: pruned });
  }
  const deletedIds = items.map((item) => item.id);
  return writePersonAlbumState({
    keeps: mergePersonAlbumKeeps(current.keeps, incoming),
    hidden: prunePersonAlbumHidden(current.hidden, deletedIds),
  });
}
