/**
 * 외부 캘린더(ICS 파일·구독 주소·네이버 캘린더) → 이 앱의 일정(calendar_schedules)
 *
 * - 시간은 모두 한국시간으로 바꿔 넣는다 (lib/icsImport).
 * - 일정 id = "ext-<출처id>-<해시>" → 다시 가져오면 같은 일정은 바뀌고 중복되지 않는다.
 * - 제목 앞에 출처 아이콘(⚽ 등)을 붙인다.
 * - 알림은 앱의 기존 서버 푸시(remind)를 그대로 쓴다 → 앱을 닫아도 알림이 온다.
 * - 출처 목록(구독 주소, 네이버 아이디·애플리케이션 비밀번호)은 이 기기 브라우저에만 저장한다.
 */
import { kstDateKey, kstTimeLabel, parseIcs, type ImportedEvent } from "./icsImport";

export const EXTERNAL_ID_PREFIX = "ext-";
const STORAGE_KEY = "iphone-calendar-external-sources";
/** 앱을 열 때 이보다 오래된 구독만 다시 받는다 */
export const AUTO_SYNC_AGE_MS = 3 * 60 * 60 * 1000;

export type ExternalScheduleItem = {
  id: string;
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: string;
  color: string;
  remind: string;
};

export type ExternalSource = {
  id: string;
  kind: "file" | "url" | "caldav";
  name: string;
  icon: string;
  color: string;
  /** "" 없음 / at / 10m / 1h / 3h / 1d, 여러 개는 쉼표 ("3h,1h") (lib/pushSchedule) */
  remind: string;
  url?: string;
  /** 네이버(CalDAV) */
  username?: string;
  password?: string;
  href?: string;
  lastSyncedAt?: number;
  lastSyncError?: string;
  eventCount?: number;
};

export const ICON_OPTIONS = ["⚽", "⚾", "🏀", "🏐", "⛳", "🎾", "🏃", "🎵", "✈️", "📅", ""];
export const COLOR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "blue", label: "파랑" },
  { value: "navy", label: "남색" },
  { value: "green", label: "초록" },
  { value: "orange", label: "주황" },
  { value: "purple", label: "보라" },
  { value: "red", label: "빨강" },
  { value: "gray", label: "회색" },
];

const ICON_RULES: Array<[RegExp, string]> = [
  [/축구|풋살|K\s?리그|K-?League|EPL|프리미어리그|라리가|분데스리가|세리에|챔피언스리그|월드컵|soccer|football|\bFC\b|FC(?=[가-힣])|유나이티드|\bUnited\b/i, "⚽"],
  [/야구|KBO|MLB|baseball|타이거즈|라이온즈|트윈스|베어스|랜더스|자이언츠|이글스|다이노스|히어로즈|위즈/i, "⚾"],
  [/농구|KBL|NBA|basketball/i, "🏀"],
  [/배구|V-?리그|volleyball/i, "🏐"],
  [/골프|golf/i, "⛳"],
  [/테니스|tennis/i, "🎾"],
  [/마라톤|러닝|marathon/i, "🏃"],
  [/콘서트|공연|concert/i, "🎵"],
];

/** 캘린더 이름 → 일정 제목 순서로 보고 아이콘을 고른다 (모르면 📅) */
export function guessIcon(name: string, events: ImportedEvent[] = []): string {
  for (const [re, icon] of ICON_RULES) if (re.test(name)) return icon;
  const titles = events.slice(0, 30).map((e) => e.title);
  for (const [re, icon] of ICON_RULES) {
    const hits = titles.filter((t) => re.test(t)).length;
    if (hits > 0 && hits >= Math.min(3, titles.length) / 2) return icon;
  }
  // 종목 단서가 없어도 "A vs B" 경기 일정이 대부분이면 축구로 본다 (바꿀 수 있음)
  const matchLike = titles.filter((t) => /\svs?\.?\s|경기/i.test(t)).length;
  if (titles.length && matchLike >= titles.length / 2) return "⚽";
  return "📅";
}

/** 제목이 이미 그림문자(⚽️ 등)로 시작하면 아이콘을 또 붙이지 않는다 (⚽ ⚽️ 중복 방지) */
const LEADING_EMOJI = new RegExp("^\\p{Extended_Pictographic}", "u");

export function withSourceIcon(icon: string, title: string): string {
  if (!icon) return title;
  if (LEADING_EMOJI.test(title.trimStart())) return title;
  return `${icon} ${title}`;
}

/** 기본 알림: 시간이 정해진 일정(경기 등)이 대부분이면 3시간 전 + 1시간 전, 종일 일정(공휴일 등) 위주면 없음 */
export function defaultRemind(events: ImportedEvent[]): string {
  if (!events.length) return "";
  const timed = events.filter((e) => !e.allDay).length;
  return timed >= events.length / 2 ? "3h,1h" : "";
}

// ---------- 출처 목록 저장 (이 기기) ----------

export function loadSources(): ExternalSource[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSources(sources: ExternalSource[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
  } catch {
    /* 저장 공간 부족 — 다음 가져오기 때 다시 저장 */
  }
}

export function newSourceId() {
  return Math.random().toString(36).slice(2, 8);
}

// ---------- 변환 ----------

function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function sourceIdPrefix(sourceId: string) {
  return `${EXTERNAL_ID_PREFIX}${sourceId}-`;
}

/** 한 달 전 이후 일정만 넣는다 (지난 일정이 쌓이지 않게) */
export function eventsToScheduleItems(source: ExternalSource, events: ImportedEvent[], now = Date.now()): ExternalScheduleItem[] {
  const from = kstDateKey(now - 31 * 24 * 60 * 60 * 1000);
  return events
    .filter((e) => e.lastDate >= from)
    .map((e) => {
      const title = withSourceIcon(source.icon, `${e.title}${e.location ? ` @${e.location}` : ""}`).slice(0, 200);
      if (e.allDay) {
        return {
          id: `${sourceIdPrefix(source.id)}${hash(e.id)}`,
          title,
          startDate: e.startDate,
          startTime: "",
          endDate: e.lastDate,
          endTime: "",
          repeat: "없음",
          color: source.color,
          remind: source.remind,
        };
      }
      const endUtc = Math.max(e.end, e.start);
      return {
        id: `${sourceIdPrefix(source.id)}${hash(e.id)}`,
        title,
        startDate: e.startDate,
        startTime: kstTimeLabel(e.start),
        endDate: kstDateKey(endUtc),
        endTime: e.end > e.start ? kstTimeLabel(endUtc) : "",
        repeat: "없음",
        color: source.color,
        remind: source.remind,
      };
    });
}

// ---------- 서버에서 받기 ----------

type RemoteCalendar = { name: string; href: string; ics: string };

async function fetchRemote(body: Record<string, string | undefined>): Promise<RemoteCalendar[]> {
  const res = await fetch("/api/fetch-calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: { calendars?: RemoteCalendar[]; error?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`서버 응답 오류 (${res.status})`);
  }
  if (!res.ok || !data.calendars) throw new Error(data.error || `가져오기 실패 (${res.status})`);
  return data.calendars;
}

function emptyIfBlank(ics: string) {
  return ics.trim() ? ics : "BEGIN:VCALENDAR\r\nEND:VCALENDAR";
}

export type FetchedSource = { source: ExternalSource; events: ImportedEvent[] };

/** ICS 파일 → 새 출처 (같은 이름의 파일 출처가 있으면 그것을 갱신) */
export async function readIcsFile(file: File, existing: ExternalSource[]): Promise<FetchedSource> {
  const parsed = parseIcs(await file.text());
  const name = parsed.calendarName || file.name.replace(/\.(ics|ical|icalendar)$/i, "");
  const old = existing.find((s) => s.kind === "file" && s.name === name);
  const source: ExternalSource = old
    ? { ...old, lastSyncedAt: Date.now(), lastSyncError: undefined, eventCount: parsed.events.length }
    : {
        id: newSourceId(), kind: "file", name, icon: guessIcon(name, parsed.events), color: "blue", remind: defaultRemind(parsed.events),
        lastSyncedAt: Date.now(), eventCount: parsed.events.length,
      };
  return { source, events: parsed.events };
}

export async function fetchUrlSource(url: string, existing: ExternalSource[]): Promise<FetchedSource> {
  const [remote] = await fetchRemote({ type: "url", url });
  const parsed = parseIcs(remote.ics);
  const old = existing.find((s) => s.kind === "url" && s.url === url.trim());
  let name = parsed.calendarName || "";
  if (!name) {
    try {
      name = new URL(url.trim().replace(/^webcals?:/i, "https:")).hostname;
    } catch {
      name = "구독 캘린더";
    }
  }
  const source: ExternalSource = old
    ? { ...old, lastSyncedAt: Date.now(), lastSyncError: undefined, eventCount: parsed.events.length }
    : {
        id: newSourceId(), kind: "url", name, url: url.trim(), icon: guessIcon(name, parsed.events), color: "blue", remind: defaultRemind(parsed.events),
        lastSyncedAt: Date.now(), eventCount: parsed.events.length,
      };
  return { source, events: parsed.events };
}

/** 네이버 캘린더 연결 — 계정 안의 캘린더마다 출처 하나 */
export async function fetchNaverSources(username: string, password: string, existing: ExternalSource[]): Promise<FetchedSource[]> {
  const user = username.trim().replace(/@naver\.com$/i, "");
  const remote = await fetchRemote({ type: "caldav", username: user, password });
  return remote.map((cal) => {
    const parsed = parseIcs(emptyIfBlank(cal.ics));
    const old = existing.find((s) => s.kind === "caldav" && s.username === user && s.href === cal.href);
    const name = `네이버 · ${cal.name}`;
    const source: ExternalSource = old
      ? { ...old, password, name, lastSyncedAt: Date.now(), lastSyncError: undefined, eventCount: parsed.events.length }
      : {
          id: newSourceId(), kind: "caldav", name, username: user, password, href: cal.href,
          icon: guessIcon(cal.name, parsed.events), color: "green", remind: defaultRemind(parsed.events),
          lastSyncedAt: Date.now(), eventCount: parsed.events.length,
        };
    return { source, events: parsed.events };
  });
}

/**
 * 구독(주소·네이버) 다시 받기. maxAgeMs보다 오래된 것만 (0이면 전부).
 * 실패한 출처는 events 없이 lastSyncError만 채워 돌려준다.
 */
export async function refreshSources(
  sources: ExternalSource[],
  maxAgeMs = 0,
): Promise<Array<{ source: ExternalSource; events?: ImportedEvent[] }>> {
  const now = Date.now();
  const due = sources.filter(
    (s) => s.kind !== "file" && (maxAgeMs === 0 || !s.lastSyncedAt || now - s.lastSyncedAt > maxAgeMs),
  );
  const out: Array<{ source: ExternalSource; events?: ImportedEvent[] }> = [];
  const failed = (s: ExternalSource, e: unknown) =>
    out.push({ source: { ...s, lastSyncError: e instanceof Error ? e.message : String(e) } });

  for (const s of due.filter((x) => x.kind === "url")) {
    try {
      const [remote] = await fetchRemote({ type: "url", url: s.url });
      const parsed = parseIcs(remote.ics);
      out.push({ source: { ...s, lastSyncedAt: Date.now(), lastSyncError: undefined, eventCount: parsed.events.length }, events: parsed.events });
    } catch (e) {
      failed(s, e);
    }
  }

  // 네이버는 계정별로 한 번만 요청
  const accounts = new Map<string, ExternalSource[]>();
  for (const s of due.filter((x) => x.kind === "caldav")) {
    accounts.set(s.username || "", [...(accounts.get(s.username || "") || []), s]);
  }
  for (const group of accounts.values()) {
    try {
      const remote = await fetchRemote({ type: "caldav", username: group[0].username, password: group[0].password });
      for (const s of group) {
        const match = remote.find((r) => r.href === s.href);
        if (!match) {
          failed(s, new Error("네이버에서 이 캘린더를 찾지 못했습니다 (삭제되었을 수 있음)"));
          continue;
        }
        const parsed = parseIcs(emptyIfBlank(match.ics));
        out.push({ source: { ...s, lastSyncedAt: Date.now(), lastSyncError: undefined, eventCount: parsed.events.length }, events: parsed.events });
      }
    } catch (e) {
      for (const s of group) failed(s, e);
    }
  }
  return out;
}

export function agoLabel(ms?: number): string {
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.round(min / 60)}시간 전`;
  return `${Math.round(min / 1440)}일 전`;
}
