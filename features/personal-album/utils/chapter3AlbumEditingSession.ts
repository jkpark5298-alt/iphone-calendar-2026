export type AlbumTabView = "library" | "create";
export type AlbumLibraryFilter = "saved" | "draft";

export type AlbumEditOrigin = "confirmed" | "draft";

export type Chapter3AlbumTab = "album" | "personal" | "map";

export type AlbumEditingSession = {
  editingSavedAlbumId: string | null;
  editingSourcePlanId: string | null;
  albumView: AlbumTabView;
  libraryFilter?: AlbumLibraryFilter;
  activeTab?: Chapter3AlbumTab;
  /** 편집 배너: 확정 수정 vs 작업 중 */
  albumEditOrigin?: AlbumEditOrigin | null;
};

const SESSION_KEY = "iphone-calendar-personal-album-chapter3-editing-album-v1";

function normalizeAlbumView(raw: unknown): AlbumTabView {
  if (raw === "create" || raw === "editor") return "create";
  // legacy: savedList / draftList / list → 내 앨범
  if (
    raw === "library" ||
    raw === "savedList" ||
    raw === "draftList" ||
    raw === "list"
  ) {
    return "library";
  }
  return "library";
}

function normalizeLibraryFilter(
  raw: unknown,
  legacyView?: unknown,
): AlbumLibraryFilter {
  if (raw === "draft" || raw === "saved") return raw;
  if (legacyView === "draftList") return "draft";
  return "saved";
}

export function readAlbumEditingSession(): AlbumEditingSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AlbumEditingSession> & {
      albumView?: unknown;
    };
    return {
      editingSavedAlbumId:
        typeof parsed.editingSavedAlbumId === "string" ? parsed.editingSavedAlbumId : null,
      editingSourcePlanId:
        typeof parsed.editingSourcePlanId === "string" ? parsed.editingSourcePlanId : null,
      albumView: normalizeAlbumView(parsed.albumView),
      libraryFilter: normalizeLibraryFilter(parsed.libraryFilter, parsed.albumView),
      activeTab:
        parsed.activeTab === "album" ||
        parsed.activeTab === "personal" ||
        parsed.activeTab === "map"
          ? parsed.activeTab
          : undefined,
      albumEditOrigin:
        parsed.albumEditOrigin === "confirmed" || parsed.albumEditOrigin === "draft"
          ? parsed.albumEditOrigin
          : null,
    };
  } catch {
    return null;
  }
}

export function writeAlbumEditingSession(session: AlbumEditingSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore quota errors
  }
}

export function clearAlbumEditingSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}
