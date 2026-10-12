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

export function writeLocalThemes(notes: ThemeNote[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
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

export async function loadThemeNotes(): Promise<ThemeNote[]> {
  const local = readLocalThemes();
  if (!isSupabaseConfigured || !supabase) return local;

  const { data, error } = await supabase
    .from("theme_notes")
    .select("id,title,body_html,updated_at");

  if (error || !data) return local;

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
    await supabase.from("theme_notes").upsert(
      pending.map((note) => ({
        id: note.id,
        title: note.title,
        body_html: note.html,
        updated_at: note.updatedAt,
      })),
      { onConflict: "id" },
    );
  }

  return merged;
}

export async function persistThemes(notes: ThemeNote[], changedId?: string) {
  writeLocalThemes(notes);
  if (!isSupabaseConfigured || !supabase) return;
  const targets = changedId ? notes.filter((note) => note.id === changedId) : notes;
  if (!targets.length) return;
  const { error } = await supabase.from("theme_notes").upsert(
    targets.map((note) => ({
      id: note.id,
      title: note.title,
      body_html: note.html,
      updated_at: note.updatedAt,
    })),
    { onConflict: "id" },
  );
  if (error) console.warn("theme note save error:", error.message);
}

export async function deleteThemeNote(id: string) {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("theme_notes").delete().eq("id", id);
  if (error) console.warn("theme note delete error:", error.message);
}
