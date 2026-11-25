/**
 * 외부 캘린더 가져오기 (브라우저는 다른 사이트 파일을 직접 못 읽어서 서버가 대신 받는다)
 *
 * POST { type: "url", url }                              → { calendars: [{ name, href, ics }] }
 * POST { type: "caldav", username, password, server? }   → { calendars: [{ name, href, ics }] }
 *   - 네이버 캘린더: server 기본값 https://caldav.calendar.naver.com, 네이버 ID + 애플리케이션 비밀번호
 *
 * 받은 내용·비밀번호는 서버에 저장하지 않는다 (요청 처리 후 버림).
 */
import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { assertAppApiAccess, assertRateLimit, clientIpFromRequest } from "../../../lib/apiSecurity";

export const runtime = "nodejs";
export const maxDuration = 30;

const NAVER_CALDAV = "https://caldav.calendar.naver.com";
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const UA = "iphone-calendar-2026/1.0 (calendar import)";

type RemoteCalendar = { name: string; href: string; ics: string };

class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ---------- 주소 안전 확인 (내부망 접근 차단) ----------

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

function normalizeUrl(raw: string): URL {
  let text = raw.trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UserError("주소 형식이 올바르지 않습니다. https:// 또는 webcal:// 로 시작하는 주소를 넣어 주세요.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError("https:// 또는 webcal:// 주소만 쓸 수 있습니다.");
  }
  if (url.username || url.password) throw new UserError("주소에 아이디·비밀번호를 넣지 마세요.");
  return url;
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$/i.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UserError("이 주소에는 접근할 수 없습니다.");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => {
    throw new UserError(`'${host}' 서버를 찾을 수 없습니다. 주소를 확인해 주세요.`);
  })).map((a) => a.address);
  if (addresses.some(isPrivateAddress)) throw new UserError("이 주소에는 접근할 수 없습니다.");
}

/** 리다이렉트도 매번 주소를 확인하며 따라간다 */
async function safeFetch(url: URL, init: RequestInit = {}, redirects = 4): Promise<Response> {
  await assertPublicHost(url);
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": UA, ...(init.headers ?? {}) },
  }).catch((e: unknown) => {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new UserError("캘린더 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.", 504);
    }
    throw new UserError("캘린더 서버에 연결하지 못했습니다.", 502);
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    if (redirects <= 0) throw new UserError("주소가 너무 여러 번 다른 곳으로 넘어갑니다.", 502);
    const next = new URL(res.headers.get("location")!, url);
    // 리다이렉트로 메서드가 바뀌면(303) GET, 그 외는 그대로
    const keep = res.status === 307 || res.status === 308;
    return safeFetch(next, keep ? init : { headers: init.headers }, redirects - 1);
  }
  return res;
}

async function readLimited(res: Response): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new UserError("캘린더 파일이 너무 큽니다 (5MB 초과).", 413);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new UserError("캘린더 파일이 너무 큽니다 (5MB 초과).", 413);
  return new TextDecoder("utf-8").decode(buf);
}

// ---------- 구독 주소 ----------

async function fetchUrl(raw: string): Promise<RemoteCalendar[]> {
  const url = normalizeUrl(raw);
  const res = await safeFetch(url, { headers: { Accept: "text/calendar, */*" } });
  if (res.status === 401 || res.status === 403) {
    throw new UserError("이 주소는 로그인이 필요하거나 공개되지 않았습니다. '공개 주소(iCal 형식)'인지 확인해 주세요.", 400);
  }
  if (res.status === 404) throw new UserError("주소에 캘린더가 없습니다(404). 주소를 다시 확인해 주세요.", 400);
  if (!res.ok) throw new UserError(`캘린더 서버 오류 (${res.status})`, 502);
  const text = await readLimited(res);
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new UserError("이 주소는 캘린더(ICS) 파일이 아닙니다. 웹페이지 주소가 아니라 iCal(.ics) 주소를 넣어 주세요.", 400);
  }
  return [{ name: "", href: url.toString(), ics: text }];
}

// ---------- CalDAV (네이버 캘린더 등) ----------

function tagContents(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${local}>`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function hasTag(xml: string, local: string): boolean {
  return new RegExp(`<(?:[\\w-]+:)?${local}[\\s/>]`, "i").test(xml);
}

function xmlUnescape(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#13;|&#x0?d;/gi, "\r").replace(/&#10;|&#x0?a;/gi, "\n")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

async function dav(url: URL, method: string, auth: string, body: string, depth: string): Promise<{ status: number; xml: string; url: URL }> {
  const res = await safeFetch(url, {
    method,
    headers: { Authorization: auth, Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
    body,
  });
  if (res.status === 401) {
    throw new UserError("네이버 로그인 실패: 아이디 또는 애플리케이션 비밀번호를 확인해 주세요. (일반 로그인 비밀번호는 안 됩니다)", 401);
  }
  const xml = await readLimited(res);
  return { status: res.status, xml, url: new URL(res.url || url.toString()) };
}

function firstHref(xml: string, prop: string): string | null {
  const block = tagContents(xml, prop)[0];
  if (!block) return null;
  const href = tagContents(block, "href")[0];
  return href ? xmlUnescape(href.trim()) : null;
}

async function fetchCaldav(usernameRaw: string, password: string, serverRaw?: string): Promise<RemoteCalendar[]> {
  const username = usernameRaw.trim().replace(/@naver\.com$/i, "");
  if (!username || !password) throw new UserError("아이디와 애플리케이션 비밀번호를 모두 넣어 주세요.");
  const base = normalizeUrl(serverRaw?.trim() || NAVER_CALDAV);
  const auth = `Basic ${Buffer.from(`${username}:${password}`, "utf-8").toString("base64")}`;

  // 1) 사용자 주소(principal) 찾기
  const principalBody = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
  let principalHref: string | null = null;
  for (const path of ["/", "/.well-known/caldav"]) {
    const r = await dav(new URL(path, base), "PROPFIND", auth, principalBody, "0");
    principalHref = firstHref(r.xml, "current-user-principal");
    if (principalHref) break;
  }
  if (!principalHref) throw new UserError("캘린더 서버에서 사용자 정보를 찾지 못했습니다.", 502);

  // 2) 캘린더 보관 위치(calendar-home-set)
  const homeBody = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
  const principal = await dav(new URL(principalHref, base), "PROPFIND", auth, homeBody, "0");
  const homeHref = firstHref(principal.xml, "calendar-home-set") ?? principalHref;

  // 3) 캘린더 목록
  const listBody = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>`;
  const list = await dav(new URL(homeHref, base), "PROPFIND", auth, listBody, "1");
  const calendars = tagContents(list.xml, "response")
    .filter((r) => {
      const rt = tagContents(r, "resourcetype")[0] ?? "";
      if (!hasTag(rt, "calendar")) return false;
      const comps = tagContents(r, "supported-calendar-component-set")[0];
      return !comps || /VEVENT/i.test(comps);
    })
    .map((r) => ({
      href: xmlUnescape((tagContents(r, "href")[0] ?? "").trim()),
      name: xmlUnescape((tagContents(r, "displayname")[0] ?? "").trim()),
    }))
    .filter((c) => c.href);
  if (calendars.length === 0) throw new UserError("가져올 캘린더가 없습니다.", 404);

  // 4) 캘린더마다 일정 받기 (한 달 전 ~ 앱 표시 기간 끝)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const start = fmt(new Date(Date.now() - 31 * 86400_000));
  const end = fmt(new Date(Date.UTC(2029, 3, 1)));
  const reportBody = (withRange: boolean) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${withRange ? `<c:time-range start="${start}" end="${end}"/>` : ""}</c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;

  const out: RemoteCalendar[] = [];
  for (const cal of calendars) {
    const url = new URL(cal.href, base);
    let r = await dav(url, "REPORT", auth, reportBody(true), "1");
    if (r.status >= 400) r = await dav(url, "REPORT", auth, reportBody(false), "1");
    if (r.status >= 400) continue;
    const parts = tagContents(r.xml, "calendar-data").map((s) => xmlUnescape(s).trim()).filter(Boolean);
    out.push({ name: cal.name || "캘린더", href: cal.href, ics: parts.join("\r\n") });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const denied = assertAppApiAccess(req) || assertRateLimit(`fetch-calendar:${clientIpFromRequest(req)}`, 30, 60_000);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      type?: string; url?: string; username?: string; password?: string; server?: string;
    };
    let calendars: RemoteCalendar[];
    if (body.type === "url" && body.url) calendars = await fetchUrl(body.url);
    else if (body.type === "caldav") calendars = await fetchCaldav(body.username ?? "", body.password ?? "", body.server);
    else throw new UserError("요청 형식이 올바르지 않습니다.");
    return NextResponse.json({ calendars }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("fetch-calendar failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "캘린더를 가져오지 못했습니다." }, { status: 500 });
  }
}
