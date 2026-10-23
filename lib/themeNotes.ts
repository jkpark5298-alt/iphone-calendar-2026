import { isSupabaseConfigured, supabase } from "./supabaseClient";

export type ThemeNote = {
  id: string;
  title: string;
  html: string;
  updatedAt: string;
};

const STORAGE_KEY = "iphone-calendar-2026-themes-v1";

function isThemeNote(value: unknown): value is ThemeNote {
  if (!value || typeof value !== "object") return false;
  const note = value as ThemeNote;
  return typeof note.id === "string" && typeof note.title === "string" && typeof note.html === "string";
}

export function createThemeNote(title = "새 테마"): ThemeNote {
  return {
    id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim() || "새 테마",
    html: "",
    updatedAt: new Date().toISOString(),
  };
}

export function readLocalThemes(): ThemeNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isThemeNote).map((note) => ({
      ...note,
      updatedAt: note.updatedAt || new Date(0).toISOString(),
    }));
  } catch {
    return [];
  }
}

/** 기기 저장소가 가득 차거나 막혀 있어도 오류로 멈추지 않는다(서버 저장은 계속 진행). */
export function writeLocalThemes(notes: ThemeNote[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (error) {
    console.warn("테마를 기기에 저장하지 못했습니다:", error);
  }
}

function mergeThemes(base: ThemeNote[], incoming: ThemeNote[]) {
  const order = [...base];
  const index = new Map(order.map((note, position) => [note.id, position]));
  for (const note of incoming) {
    const position = index.get(note.id);
    if (position == null) {
      index.set(note.id, order.length);
      order.push(note);
      continue;
    }
    if (order[position].updatedAt < note.updatedAt) order[position] = note;
  }
  return order;
}

const REMOTE_LOAD_TIMEOUT_MS = 12000;

/**
 * 테마를 불러온다. 서버에서 못 받아오면(오류·시간 초과) 기기에 있는 것만 돌려주고 remoteOk=false로 알린다.
 * 절대 예외를 던지지 않는다.
 */
export async function loadThemeNotesWithStatus(): Promise<{ notes: ThemeNote[]; remoteOk: boolean }> {
  const local = readLocalThemes();
  if (!isSupabaseConfigured || !supabase) return { notes: local, remoteOk: true };
  try {
    const notes = await Promise.race([
      loadThemeNotesFromServer(local),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), REMOTE_LOAD_TIMEOUT_MS)),
    ]);
    return notes ? { notes, remoteOk: true } : { notes: local, remoteOk: false };
  } catch (error) {
    console.warn("테마 불러오기 실패:", error);
    return { notes: local, remoteOk: false };
  }
}

export async function loadThemeNotes(): Promise<ThemeNote[]> {
  return (await loadThemeNotesWithStatus()).notes;
}

/** 서버에서 받아 기기 것과 합친다. 서버 오류면 null. */
async function loadThemeNotesFromServer(local: ThemeNote[]): Promise<ThemeNote[] | null> {
  if (!supabase) return local;
  const { data, error } = await supabase
    .from("theme_notes")
    .select("id,title,body_html,updated_at");

  if (error || !data) return null;

  const remote: ThemeNote[] = data.map((row) => ({
    id: String(row.id),
    title: String(row.title || "새 테마"),
    html: String(row.body_html || ""),
    updatedAt: String(row.updated_at || new Date(0).toISOString()),
  }));

  const merged = mergeThemes(local, remote);
  writeLocalThemes(merged);

  const remoteIds = new Set(remote.map((note) => note.id));
  const pending = merged.filter((note) => {
    const match = remote.find((item) => item.id === note.id);
    return !remoteIds.has(note.id) || (match && match.updatedAt < note.updatedAt);
  });
  if (pending.length) {
    // 화면을 막지 않도록 기다리지 않고 올린다(실패해도 기기에 남아 다음에 다시 시도).
    void supabase
      .from("theme_notes")
      .upsert(
        pending.map((note) => ({
          id: note.id,
          title: note.title,
          body_html: note.html,
          updated_at: note.updatedAt,
        })),
        { onConflict: "id" },
      )
      .then(({ error: uploadError }) => {
        if (uploadError) console.warn("기기에만 있던 테마 올리기 실패:", uploadError.message);
      });
  }

  return merged;
}

/** 서버 저장에 성공하면 true. 서버를 쓰지 않는 환경(기기 저장만)에서도 true. */
export async function persistThemes(notes: ThemeNote[], changedId?: string): Promise<boolean> {
  writeLocalThemes(notes);
  if (!isSupabaseConfigured || !supabase) return true;
  const targets = changedId ? notes.filter((note) => note.id === changedId) : notes;
  if (!targets.length) return true;
  let error: { message: string } | null = null;
  try {
    ({ error } = await supabase.from("theme_notes").upsert(
    targets.map((note) => ({
      id: note.id,
      title: note.title,
      body_html: note.html,
      updated_at: note.updatedAt,
    })),
    { onConflict: "id" },
  ));
  } catch (caught) {
    error = { message: caught instanceof Error ? caught.message : String(caught) };
  }
  if (error) console.warn("theme note save error:", error.message);
  return !error;
}

export async function deleteThemeNote(id: string) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("theme_notes").delete().eq("id", id);
  if (error) console.warn("theme note delete error:", error.message);
}
