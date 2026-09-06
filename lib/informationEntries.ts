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
