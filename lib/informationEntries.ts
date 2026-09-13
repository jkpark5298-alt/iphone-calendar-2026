import { supabase, isSupabaseConfigured } from "./supabaseClient";

export type InformationCalendarItem = {
  id: string;
  title: string;
  category: string;
  primaryDate: string;
  eventDates: string[];
  checked: boolean;
  important: boolean;
  summary: string;
};

/** 정보함(iphone-information)과 공유하는 information_entries 테이블에 쓸 입력 형태 */
export type InformationEntryInput = {
  id: string;
  title?: string;
  category?: string;
  source?: string;
  primaryDate?: string;
  eventDates?: string[];
  checked?: boolean;
  completedAt?: string | null;
  important?: boolean;
  summary?: string;
  payload?: Record<string, unknown>;
};

type InformationEntresRow = {
  id: string;
  title: string;
  category: string;
  source: string;
  primary_date: string;
  event_dates: string[];
  checked: boolean;
  completed_at: string | null;
  important: boolean;
  summary: string;
  payload: Record<string, unknown>;
  updated_at: string;
};

const INFORMATION_APP_ORIGIN =
  process.env.NEXT_PUBLIC_INFORMATION_APP_URL || "https://iphone-information.vercel.app";

export function getInformationAppDayUrl(isoDate: string) {
  return `${INFORMATION_APP_ORIGIN.replace(/\/$/, "")}/day/${isoDate}`;
}

export function getInformationAppItemUrl(id: string) {
  return `${INFORMATION_APP_ORIGIN.replace(/\/$/, "")}/items/${id}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function datesInMonth(year: number, month: number): string[] {
  const last = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    out.push(`${year}-${pad(month)}-${pad(d)}`);
  }
  return out;
}

function normalizeRow(row: Record<string, unknown>): InformationCalendarItem | null {
  const id = String(row.id || "").trim();
  if (!id) return null;
  const primaryDate = String(row.primary_date || "").slice(0, 10);
  const eventDates = Array.isArray(row.event_dates)
    ? row.event_dates.map((d) => String(d).slice(0, 10)).filter(Boolean)
    : [];
  return {
    id,
    title: String(row.title || "정보").trim() || "정보",
    category: String(row.category || "general"),
    primaryDate,
    eventDates: eventDates.length ? eventDates : primaryDate ? [primaryDate] : [],
    checked: Boolean(row.checked),
    important: Boolean(row.important),
    summary: String(row.summary || "").trim(),
  };
}

/** 해당 월에 걸리는 정보함 항목 로드 (primary_date 또는 event_dates) */
export async function loadInformationEntriesForMonth(
  year: number,
  month: number,
): Promise<InformationCalendarItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const monthDates = datesInMonth(year, month);
  const start = monthDates[0];
  const end = monthDates[monthDates.length - 1];

  const { data, error } = await supabase
    .from("information_entries")
    .select("id, title, category, primary_date, event_dates, checked, important, summary")
    .or(
      `and(primary_date.gte.${start},primary_date.lte.${end}),event_dates.ov.{${monthDates.join(",")}}`,
    );

  if (error) {
    console.warn("information_entries load error:", error.message);
    return [];
  }

  const monthSet = new Set(monthDates);
  const map = new Map<string, InformationCalendarItem>();
  for (const raw of data || []) {
    const item = normalizeRow(raw as Record<string, unknown>);
    if (!item) continue;
    const hits = item.eventDates.some((d) => monthSet.has(d)) || monthSet.has(item.primaryDate);
    if (!hits) continue;
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

export function groupInformationEntriesByDay(
  items: InformationCalendarItem[],
  year: number,
  month: number,
): Record<string, InformationCalendarItem[]> {
  const monthSet = new Set(datesInMonth(year, month));
  const grouped: Record<string, InformationCalendarItem[]> = {};
  for (const item of items) {
    const dates = new Set(
      [...item.eventDates, item.primaryDate].filter((d) => monthSet.has(d)),
    );
    for (const date of dates) {
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(item);
    }
  }
  return grouped;
}

/* ---------------------------------------------------------------------------
 * 정보함(iphone-information)과 공유하는 information_entries 테이블 동기화(쓰기)
 * a033221 "Supabase 공통 DB 동기화" 대응: 캘린더 ↔ 정보함 양방향 저장
 * ------------------------------------------------------------------------- */

function toInformationEntryRow(input: InformationEntryInput): InformationEntresRow | null {
  const primaryDate = String(input.primaryDate || "").slice(0, 10);
  const eventDates = (input.eventDates?.length ? input.eventDates : primaryDate ? [primaryDate] : [])
    .map((d) => String(d).slice(0, 10))
    .filter(Boolean);
  if (!input?.id || !primaryDate) return null;
  return {
    id: input.id,
    title: input.title || "정보",
    category: input.category || "general",
    source: input.source || "other",
    primary_date: primaryDate,
    event_dates: eventDates.length ? eventDates : [primaryDate],
    checked: Boolean(input.checked),
    completed_at: input.completedAt || null,
    important: Boolean(input.important),
    summary: (input.summary || "").slice(0, 500),
    payload: input.payload || {},
    updated_at: new Date().toISOString(),
  };
}

export type InformationEntrySyncResult = { ok: boolean; message?: string };

/** 단건 upsert (저장/수정/완료 상태 반영) */
export async function upsertInformationEntryToSupabase(
  input: InformationEntryInput,
): Promise<InformationEntrySyncResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, message: "Supabase 미설정" };
  const row = toInformationEntryRow(input);
  if (!row) return { ok: false, message: "날짜가 없는 항목은 동기화하지 않습니다." };
  const { error } = await supabase.from("information_entries").upsert(row, { onConflict: "id" });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** 여러 건 upsert */
export async function upsertInformationEntriesToSupabase(
  inputs: InformationEntryInput[],
): Promise<InformationEntrySyncResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, message: "Supabase 미설정" };
  const rows = inputs
    .map(toInformationEntryRow)
    .filter((row): row is InformationEntresRow => row !== null);
  if (!rows.length) return { ok: true };
  const { error } = await supabase.from("information_entries").upsert(rows, { onConflict: "id" });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** 단건 삭제 */
export async function deleteInformationEntryFromSupabase(
  id: string,
): Promise<InformationEntrySyncResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false, message: "Supabase 미설정" };
  const { error } = await supabase.from("information_entries").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** 원격 → 로컬 병합용 (id 기준, 상세 정보는 payload에 보존) */
export async function fetchInformationEntriesFromSupabase(): Promise<Record<string, unknown>[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("information_entries")
    .select("id, title, category, source, primary_date, event_dates, checked, completed_at, important, summary, payload, updated_at")
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error || !data) {
    if (error) console.warn("information_entries fetch:", error.message);
    return [];
  }
  return data as Record<string, unknown>[];
}
