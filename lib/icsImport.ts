/**
 * 외부 ICS(iCalendar) 파일 → 앱 일정(한국시간 기준)
 *
 * - 줄 접기(folding) 해제, 텍스트 이스케이프 해제
 * - 시간: UTC(…Z), TZID(IANA·Windows 이름·mozilla 경로), 시간대 없는 값(X-WR-TIMEZONE 또는 한국시간)
 * - 종일 일정(VALUE=DATE)은 날짜 그대로
 * - 반복 일정(RRULE: DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY),
 *   EXDATE, RECURRENCE-ID(개별 수정본) 처리
 */

export interface ImportedEvent {
  /** 고유 키 (uid + 시작시각) */
  id: string;
  title: string;
  location?: string;
  description?: string;
  allDay: boolean;
  /** 시작·종료 시각 (UTC ms). 종일 일정은 한국 자정 기준 */
  start: number;
  end: number;
  /** 한국 날짜 YYYY-MM-DD (종일 일정은 파일의 날짜) */
  startDate: string;
  /** 종일 일정의 마지막 날짜(포함). 시간 일정은 startDate와 같음 */
  lastDate: string;
}

export interface ParsedIcs {
  calendarName?: string;
  events: ImportedEvent[];
  /** 반복 일정을 펼칠 때 범위 밖이라 잘린 횟수 등 참고용 경고 */
  warnings: string[];
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OCCURRENCES = 1000;

/** 반복 일정을 펼치는 범위 (앱이 보여 주는 기간) */
const EXPAND_FROM = Date.UTC(2025, 11, 1);
const EXPAND_TO = Date.UTC(2029, 3, 1);

/** Windows 시간대 이름 → IANA (Outlook 내보내기 대비, 자주 쓰는 것만) */
const WINDOWS_TZ: Record<string, string> = {
  "Korea Standard Time": "Asia/Seoul",
  "Tokyo Standard Time": "Asia/Tokyo",
  "China Standard Time": "Asia/Shanghai",
  "Taipei Standard Time": "Asia/Taipei",
  "Singapore Standard Time": "Asia/Singapore",
  "SE Asia Standard Time": "Asia/Bangkok",
  "India Standard Time": "Asia/Kolkata",
  "Arabian Standard Time": "Asia/Dubai",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "E. South America Standard Time": "America/Sao_Paulo",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
};

// ---------- 기본 파싱 ----------

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  type: string;
  props: Prop[];
  children: Component[];
}

function unfold(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":VALUE — 따옴표 안의 : ; 는 구분자가 아님
  let i = 0;
  let inQuote = false;
  let colon = -1;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) { colon = i; break; }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = "";
  inQuote = false;
  for (const ch of head) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ";" && !inQuote) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name, params, value };
}

function parseComponents(text: string): Component {
  const root: Component = { type: "ROOT", props: [], children: [] };
  const stack: Component[] = [root];
  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const comp: Component = { type: prop.value.trim().toUpperCase(), props: [], children: [] };
      stack[stack.length - 1].children.push(comp);
      stack.push(comp);
    } else if (prop.name === "END") {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].props.push(prop);
    }
  }
  return root;
}

function findAll(comp: Component, type: string, out: Component[] = []): Component[] {
  for (const child of comp.children) {
    if (child.type === type) out.push(child);
    findAll(child, type, out);
  }
  return out;
}

function getProp(comp: Component, name: string): Prop | undefined {
  return comp.props.find((p) => p.name === name);
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

// ---------- 시간대 ----------

const tzValidCache = new Map<string, boolean>();
function isValidTimeZone(tz: string): boolean {
  if (!tzValidCache.has(tz)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      tzValidCache.set(tz, true);
    } catch {
      tzValidCache.set(tz, false);
    }
  }
  return tzValidCache.get(tz)!;
}

/** TZID → 시간대 해석 결과. IANA 이름 또는 고정 오프셋(분) */
type Zone = { iana: string } | { offsetMin: number };

function parseUtcOffset(value: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})/.exec(value.trim());
  if (!m) return null;
  const min = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -min : min;
}

function resolveZone(tzid: string | undefined, root: Component, fallback: Zone): Zone {
  if (!tzid) return fallback;
  const raw = tzid.replace(/^"|"$/g, "").trim();
  if (isValidTimeZone(raw)) return { iana: raw };
  if (WINDOWS_TZ[raw]) return { iana: WINDOWS_TZ[raw] };
  // "/mozilla.org/20050126_1/Europe/London" 같은 경로형
  const tail = /([A-Za-z_]+\/[A-Za-z_+\-]+(?:\/[A-Za-z_+\-]+)?)$/.exec(raw)?.[1];
  if (tail && isValidTimeZone(tail)) return { iana: tail };
  // 파일 안의 VTIMEZONE 정의에서 표준시 오프셋 사용 (서머타임 무시)
  const vtz = findAll(root, "VTIMEZONE").find((c) => getProp(c, "TZID")?.value.trim() === raw);
  if (vtz) {
    const std = vtz.children.find((c) => c.type === "STANDARD") ?? vtz.children[0];
    const off = std ? parseUtcOffset(getProp(std, "TZOFFSETTO")?.value ?? "") : null;
    if (off !== null) return { offsetMin: off };
  }
  return fallback;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function zoneOffsetMs(utcMs: number, tz: string): number {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dtfCache.set(tz, dtf);
  }
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** 어떤 시간대의 벽시계 시각 → UTC ms */
function wallTimeToUtc(wall: WallTime, zone: Zone): number {
  const guess = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);
  if ("offsetMin" in zone) return guess - zone.offsetMin * 60_000;
  const off1 = zoneOffsetMs(guess, zone.iana);
  const utc = guess - off1;
  const off2 = zoneOffsetMs(utc, zone.iana);
  return off2 === off1 ? utc : guess - off2;
}

interface WallTime { y: number; mo: number; d: number; h: number; mi: number; s: number }

interface DateValue {
  allDay: boolean;
  /** 종일: 날짜만 의미 있음. 시간: 해당 시간대 벽시계 */
  wall: WallTime;
  /** 'utc' = Z 표기 */
  zone: Zone | "utc";
}

function parseDateValue(prop: Prop, root: Component, fallback: Zone): DateValue | null {
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const wall: WallTime = {
    y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]),
    h: Number(m[4] ?? 0), mi: Number(m[5] ?? 0), s: Number(m[6] ?? 0),
  };
  const allDay = prop.params.VALUE === "DATE" || m[4] === undefined;
  if (allDay) return { allDay: true, wall, zone: { offsetMin: 9 * 60 } };
  if (m[7]) return { allDay: false, wall, zone: "utc" };
  return { allDay: false, wall, zone: resolveZone(prop.params.TZID, root, fallback) };
}

function toUtc(dv: DateValue): number {
  if (dv.zone === "utc") {
    const w = dv.wall;
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  }
  return wallTimeToUtc(dv.wall, dv.zone);
}

/** UTC ms → 한국 날짜 YYYY-MM-DD */
export function kstDateKey(utcMs: number): string {
  return new Date(utcMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC ms → 한국 시각 HH:MM */
export function kstTimeLabel(utcMs: number): string {
  return new Date(utcMs + KST_OFFSET_MS).toISOString().slice(11, 16);
}

function wallDateKey(w: WallTime): string {
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const ms = ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 86400
    + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// ---------- 반복 ----------

const BYDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: number;
  byDay?: Array<{ n: number; dow: number }>;
  byMonthDay?: number[];
}

function parseRRule(value: string, root: Component, fallback: Zone): RRule | null {
  const map: Record<string, string> = {};
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) map[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = map.FREQ as RRule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const rule: RRule = { freq, interval: Math.max(1, Number(map.INTERVAL ?? 1) || 1) };
  if (map.COUNT) rule.count = Number(map.COUNT);
  if (map.UNTIL) {
    const dv = parseDateValue({ name: "UNTIL", params: {}, value: map.UNTIL }, root, fallback);
    if (dv) rule.until = dv.allDay ? Date.UTC(dv.wall.y, dv.wall.mo - 1, dv.wall.d + 1) - KST_OFFSET_MS : toUtc(dv);
  }
  if (map.BYDAY) {
    rule.byDay = map.BYDAY.split(",").map((t) => {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(t.trim().toUpperCase());
      return m ? { n: Number(m[1] ?? 0), dow: BYDAY_INDEX[m[2]] ?? -1 } : { n: 0, dow: -1 };
    }).filter((b) => b.dow >= 0);
  }
  if (map.BYMONTHDAY) rule.byMonthDay = map.BYMONTHDAY.split(",").map(Number).filter(Boolean);
  return rule;
}

/** 시작 벽시계에서 규칙대로 날짜(벽시계 날짜)를 만든다. 시각은 시작과 같음 */
function expandDates(start: WallTime, rule: RRule): WallTime[] {
  const out: WallTime[] = [];
  const startUtcDay = Date.UTC(start.y, start.mo - 1, start.d);
  const toWall = (dayMs: number): WallTime => {
    const d = new Date(dayMs);
    return { ...start, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  const limitDay = EXPAND_TO + DAY_MS;
  const push = (dayMs: number): boolean => {
    if (dayMs < startUtcDay) return true;
    if (rule.count !== undefined && out.length >= rule.count) return false;
    if (out.length >= MAX_OCCURRENCES || dayMs > limitDay) return false;
    out.push(toWall(dayMs));
    return true;
  };

  if (rule.freq === "DAILY") {
    for (let i = 0; ; i++) if (!push(startUtcDay + i * rule.interval * DAY_MS)) break;
  } else if (rule.freq === "WEEKLY") {
    const dows = rule.byDay?.length ? rule.byDay.map((b) => b.dow).sort() : [new Date(startUtcDay).getUTCDay()];
    // 주 시작(일요일) 기준
    const weekStart = startUtcDay - new Date(startUtcDay).getUTCDay() * DAY_MS;
    outer: for (let w = 0; ; w++) {
      for (const dow of dows) {
        if (!push(weekStart + (w * rule.interval * 7 + dow) * DAY_MS)) break outer;
      }
    }
  } else {
    const monthly = rule.freq === "MONTHLY";
    for (let i = 0; ; i++) {
      const y = monthly ? start.y + Math.floor((start.mo - 1 + i * rule.interval) / 12) : start.y + i * rule.interval;
      const mo = monthly ? ((start.mo - 1 + i * rule.interval) % 12) + 1 : start.mo;
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      let days: number[] = [];
      if (rule.byMonthDay?.length) {
        days = rule.byMonthDay.map((d) => (d < 0 ? dim + d + 1 : d)).filter((d) => d >= 1 && d <= dim);
      } else if (rule.byDay?.length) {
        for (const b of rule.byDay) {
          const matches: number[] = [];
          for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === b.dow) matches.push(d);
          if (b.n > 0 && matches[b.n - 1]) days.push(matches[b.n - 1]);
          else if (b.n < 0 && matches[matches.length + b.n]) days.push(matches[matches.length + b.n]);
          else if (b.n === 0) days.push(...matches);
        }
      } else if (start.d <= dim) {
        days = [start.d];
      }
      let stop = false;
      for (const d of [...new Set(days)].sort((a, b) => a - b)) {
        if (!push(Date.UTC(y, mo - 1, d))) { stop = true; break; }
      }
      if (stop || Date.UTC(y, mo - 1, 1) > limitDay || i > 2000) break;
    }
  }
  return out;
}

// ---------- 본체 ----------

export function parseIcs(text: string): ParsedIcs {
  const root = parseComponents(text);
  const cal = findAll(root, "VCALENDAR")[0] ?? root;
  if (!findAll(root, "VCALENDAR").length && !findAll(root, "VEVENT").length) {
    throw new Error("ICS(iCalendar) 형식의 파일이 아닙니다.");
  }
  const calendarName = getProp(cal, "X-WR-CALNAME")?.value
    ? unescapeText(getProp(cal, "X-WR-CALNAME")!.value)
    : undefined;
  const calTz = getProp(cal, "X-WR-TIMEZONE")?.value.trim();
  const fallback: Zone = calTz && isValidTimeZone(calTz) ? { iana: calTz } : { iana: "Asia/Seoul" };

  const vevents = findAll(root, "VEVENT");
  const warnings: string[] = [];
  const events: ImportedEvent[] = [];

  // 개별 수정본(RECURRENCE-ID): 원래 반복 회차는 빼고 수정본을 넣는다
  const overridden = new Map<string, Set<number>>();
  for (const ev of vevents) {
    const rid = getProp(ev, "RECURRENCE-ID");
    const uid = getProp(ev, "UID")?.value ?? "";
    if (!rid) continue;
    const dv = parseDateValue(rid, root, fallback);
    if (!dv) continue;
    if (!overridden.has(uid)) overridden.set(uid, new Set());
    overridden.get(uid)!.add(toUtc(dv));
  }

  for (const ev of vevents) {
    const status = getProp(ev, "STATUS")?.value.trim().toUpperCase();
    if (status === "CANCELLED") continue;
    const dtStartProp = getProp(ev, "DTSTART");
    if (!dtStartProp) continue;
    const start = parseDateValue(dtStartProp, root, fallback);
    if (!start) continue;

    const uid = getProp(ev, "UID")?.value.trim() || `noid-${events.length}`;
    const title = unescapeText(getProp(ev, "SUMMARY")?.value ?? "") || "(제목 없음)";
    const location = getProp(ev, "LOCATION")?.value ? unescapeText(getProp(ev, "LOCATION")!.value) : undefined;
    const descriptionRaw = getProp(ev, "DESCRIPTION")?.value;
    const description = descriptionRaw ? unescapeText(descriptionRaw).slice(0, 500) : undefined;

    // 길이(ms) — 종일은 일수로
    const endProp = getProp(ev, "DTEND");
    const end = endProp ? parseDateValue(endProp, root, fallback) : null;
    const durationProp = getProp(ev, "DURATION");
    let durationMs: number;
    if (end) durationMs = toUtc(end) - toUtc(start);
    else if (durationProp) durationMs = parseDuration(durationProp.value) ?? 0;
    else durationMs = start.allDay ? DAY_MS : 0;
    if (start.allDay && durationMs < DAY_MS) durationMs = DAY_MS;
    if (durationMs < 0) durationMs = 0;

    // 회차 목록
    let walls: WallTime[] = [start.wall];
    const rruleProp = getProp(ev, "RRULE");
    if (rruleProp && !getProp(ev, "RECURRENCE-ID")) {
      const rule = parseRRule(rruleProp.value, root, fallback);
      if (rule) walls = expandDates(start.wall, rule).filter((w) => {
        if (rule.until === undefined) return true;
        return toUtc({ ...start, wall: w }) <= rule.until;
      });
      else warnings.push(`"${title}"의 반복 규칙을 이해하지 못해 첫 일정만 넣었습니다.`);
    }

    const exdates = new Set<string>();
    for (const p of ev.props.filter((x) => x.name === "EXDATE")) {
      for (const v of p.value.split(",")) {
        const dv = parseDateValue({ ...p, value: v }, root, fallback);
        if (dv) exdates.add(dv.allDay ? wallDateKey(dv.wall) : String(toUtc(dv)));
      }
    }
    const skip = overridden.get(uid);

    for (const wall of walls) {
      const occ: DateValue = { ...start, wall };
      const startUtc = toUtc(occ);
      const isOriginalOfOverride = !getProp(ev, "RECURRENCE-ID") && skip?.has(startUtc);
      if (isOriginalOfOverride) continue;
      if (start.allDay ? exdates.has(wallDateKey(wall)) : exdates.has(String(startUtc))) continue;
      if (startUtc + durationMs < EXPAND_FROM || startUtc > EXPAND_TO) continue;

      const startDate = start.allDay ? wallDateKey(wall) : kstDateKey(startUtc);
      const lastDate = start.allDay
        ? addDaysKey(startDate, Math.max(1, Math.round(durationMs / DAY_MS)) - 1)
        : startDate;
      events.push({
        id: `${uid}#${startUtc}`,
        title, location, description,
        allDay: start.allDay,
        start: startUtc,
        end: startUtc + durationMs,
        startDate,
        lastDate,
      });
    }
  }

  // 같은 id가 두 번 들어오면 뒤의 것을 쓴다
  const byId = new Map<string, ImportedEvent>();
  for (const e of events) byId.set(e.id, e);
  const unique = [...byId.values()].sort((a, b) => a.start - b.start);
  return { calendarName, events: unique, warnings };
}
