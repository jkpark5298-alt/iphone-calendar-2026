export const INFO_INDEX_CATEGORIES = [
  "애플",
  "과학",
  "경제",
  "사회",
  "기술",
  "국제",
  "건강",
  "외교",
  "기타",
] as const;

export type InfoIndexCategory = (typeof INFO_INDEX_CATEGORIES)[number];

export type InfoIndexSource = "insta-fact-library" | "builder-zeta-eight" | "local";

export type InfoIndexView = "category" | "date" | "tag";

export type InfoIndexItem = {
  id: string;
  title: string;
  createdAt: string;
  createdAtLabel: string;
  dateKey: string;
  category: InfoIndexCategory;
  tags: string[];
  source: InfoIndexSource;
  sourceLabel: string;
  detailUrl: string;
  localNumericId?: number;
  pinned?: boolean;
  thumbUrl?: string;
  /** saved: 앱에 남아 있는 앱파일 저장 항목(노란 ★). removed: 앱에서 지웠지만 인덱스에 남긴 항목(빨간 ★). */
  appFileMark?: "saved" | "removed";
  /** 일반정보수집 항목의 저장 상태 */
  saveStatus?: "저장" | "임시 저장" | "삭제됨";
};

export const APP_FILE_INDEX_ARCHIVE_KEY = "travel-diary-info-index-appfile-archive-v1";
export const APP_FILE_INDEX_ARCHIVE_EVENT = "travel-diary-appfile-index-archive";

export type AppFileIndexArchiveEntry = {
  id: number;
  title: string;
  createdAt: string;
  primaryCategory: string;
  secondaryCategory: string;
  keywords: string[];
  thumbUrl?: string;
  removedFromApp: boolean;
};

export const INFO_INDEX_SOURCE_LABEL: Record<InfoIndexSource, string> = {
  "insta-fact-library": "insta-fact-library",
  "builder-zeta-eight": "builder-zeta-eight",
  local: "일반정보수집",
};

export const INFO_INDEX_SOURCE_SHORT: Record<InfoIndexSource, string> = {
  "insta-fact-library": "insta",
  "builder-zeta-eight": "builder",
  local: "일반정보수집",
};

export const INFO_INDEX_SOURCE_OPTIONS: { value: InfoIndexSource; label: string }[] = [
  { value: "builder-zeta-eight", label: "builder-zeta-eight" },
  { value: "insta-fact-library", label: "insta-fact-library" },
  { value: "local", label: "일반정보수집" },
];

export const BUILDER_APP_URL =
  process.env.NEXT_PUBLIC_BUILDER_APP_URL || "https://builder-zeta-eight.vercel.app";

export const IFL_APP_URL =
  process.env.NEXT_PUBLIC_IFL_APP_URL || "https://insta-fact-library.vercel.app";

export function cleanIndexTitle(raw: string, maxLen = 40) {
  let text = String(raw || "").trim();
  if (!text) return "제목 없음";
  const jsonCut = text.search(/"\s*,\s*"report"|,"report"|\\"report\\"|\{"meta"|needsFactCheck|transcriptSource/);
  if (jsonCut > 8) text = text.slice(0, jsonCut);
  text = text
    .replace(/\\"/g, '"')
    .replace(/^"+|"+$/g, "")
    .replace(/[{}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (isGarbageTitle(text)) {
    const first = text.split(/["{,]/)[0].trim();
    text = first.length > 2 ? first : "제목 없음";
  }
  text = text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  if (text.length > maxLen) return `${text.slice(0, maxLen).trim()}…`;
  return text || "제목 없음";
}

export function isGarbageTitle(value: string) {
  const text = String(value || "");
  if (text.length > 160) return true;
  return /"report"\s*:|"meta"\s*:|factCheck|transcriptSource|needsFactCheck|reportType|infographic/.test(
    text,
  );
}

export function unescapeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

export function infoIndexSourceClass(source: InfoIndexSource) {
  if (source === "builder-zeta-eight") return "source-builder";
  if (source === "insta-fact-library") return "source-ifl";
  return "source-local";
}

export function infoIndexSourceHomeUrl(source: InfoIndexSource) {
  if (source === "builder-zeta-eight") return BUILDER_APP_URL;
  if (source === "insta-fact-library") return IFL_APP_URL;
  return "";
}

export function infoIndexDetailLabel(source: InfoIndexSource) {
  if (source === "builder-zeta-eight") return "builder";
  if (source === "insta-fact-library") return "insta";
  return "상세보기";
}

export function formatIndexDateLabel(raw: string) {
  const date = parseIndexDate(raw);
  if (!date) return String(raw || "").trim() || "날짜 없음";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

export function indexDateKey(raw: string) {
  const date = parseIndexDate(raw);
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIndexDate(raw: string): Date | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const iso = Date.parse(text);
  if (Number.isFinite(iso)) return new Date(iso);
  const ko = text.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (ko) return new Date(Number(ko[1]), Number(ko[2]) - 1, Number(ko[3]));
  const dash = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dash) return new Date(Number(dash[1]), Number(dash[2]) - 1, Number(dash[3]));
  return null;
}

export function mapToIndexCategory(raw: string, extra: string[] = []): InfoIndexCategory {
  const blob = [raw, ...extra].join(" ").toLowerCase();
  if (/애플|iphone|ios|ipad|macbook|apple|아이폰|아이패드/.test(blob)) return "애플";
  if (/건강|의료|병원|영양|수면|치매|알츠하이머|피부|혈관|wine|와인/.test(blob)) return "건강";
  if (/과학|우주|연구|유전|물리|화학|nasa|성경|고대/.test(blob)) return "과학";
  if (/경제|증시|금리|환율|부동산|투자|경매/.test(blob)) return "경제";
  if (/기술|ai|인공지능|소프트웨어|로봇|반도체|리모델/.test(blob)) return "기술";
  if (/외교|정상회담|대사|동맹/.test(blob)) return "외교";
  if (/국제|해외|미국|중국|일본|bbc/.test(blob)) return "국제";
  if (/사회|교육|학교|패션|역사/.test(blob)) return "사회";
  if (INFO_INDEX_CATEGORIES.includes(raw as InfoIndexCategory)) return raw as InfoIndexCategory;
  return "기타";
}

export function normalizeIndexTags(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [values];
  const tags = list
    .flatMap((value) => String(value || "").split(/[#,\s]+/))
    .map((item) => item.replace(/^#+/, "").trim())
    .filter((item) => item.length > 1 && item.length < 24)
    .filter((item) => !/^(youtube|report|has-script|url-article|fc-pass|type-[a-z]|heuristic-factcheck|manual-review|report-assembled|shared-goodnotes|no-script|manual-overview)$/i.test(item));
  return Array.from(new Set(tags)).slice(0, 8);
}

export function buildIndexItem(input: {
  id: string;
  title: string;
  createdAt: string;
  categoryRaw?: string;
  tags?: string[];
  source: InfoIndexSource;
  detailUrl: string;
  localNumericId?: number;
  thumbUrl?: string;
  appFileMark?: "saved" | "removed";
  saveStatus?: "저장" | "임시 저장" | "삭제됨";
}): InfoIndexItem {
  const title = cleanIndexTitle(input.title);
  const tags = normalizeIndexTags(input.tags);
  const category = mapToIndexCategory(
    input.categoryRaw || tags[0] || title,
    [...tags, title],
  );
  return {
    id: String(input.id),
    title,
    createdAt: input.createdAt,
    createdAtLabel: formatIndexDateLabel(input.createdAt),
    dateKey: indexDateKey(input.createdAt),
    category,
    tags: tags.length ? tags : [category],
    source: input.source,
    sourceLabel: INFO_INDEX_SOURCE_LABEL[input.source],
    detailUrl: input.detailUrl,
    localNumericId: input.localNumericId,
    thumbUrl: String(input.thumbUrl || "").trim() || undefined,
    appFileMark: input.appFileMark,
    saveStatus: input.saveStatus,
  };
}

function readArchiveRaw(): AppFileIndexArchiveEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(APP_FILE_INDEX_ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => row && typeof row.id === "number" && row.removedFromApp)
      .map((row) => ({
        id: Number(row.id),
        title: String(row.title || "제목 없음"),
        createdAt: String(row.createdAt || ""),
        primaryCategory: String(row.primaryCategory || ""),
        secondaryCategory: String(row.secondaryCategory || ""),
        keywords: Array.isArray(row.keywords) ? row.keywords.map((tag: unknown) => String(tag)) : [],
        thumbUrl: /^https?:\/\//i.test(String(row.thumbUrl || "")) ? String(row.thumbUrl) : undefined,
        removedFromApp: true as const,
      }));
  } catch {
    return [];
  }
}

function writeArchive(entries: AppFileIndexArchiveEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APP_FILE_INDEX_ARCHIVE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new Event(APP_FILE_INDEX_ARCHIVE_EVENT));
}

export function readAppFileIndexArchive(): AppFileIndexArchiveEntry[] {
  return readArchiveRaw();
}

export function archiveRemovedAppFileIndex(entry: Omit<AppFileIndexArchiveEntry, "removedFromApp">) {
  const thumb = /^https?:\/\//i.test(String(entry.thumbUrl || "")) ? String(entry.thumbUrl) : undefined;
  const next = readArchiveRaw().filter((row) => row.id !== entry.id);
  next.unshift({
    id: entry.id,
    title: String(entry.title || "제목 없음"),
    createdAt: String(entry.createdAt || ""),
    primaryCategory: String(entry.primaryCategory || ""),
    secondaryCategory: String(entry.secondaryCategory || ""),
    keywords: Array.isArray(entry.keywords) ? entry.keywords.map((tag) => String(tag)) : [],
    thumbUrl: thumb,
    removedFromApp: true,
  });
  writeArchive(next.slice(0, 400));
}

export function forgetAppFileIndexArchive(id: number) {
  const current = readArchiveRaw();
  const next = current.filter((row) => row.id !== id);
  if (next.length !== current.length) writeArchive(next);
}

export function forgetAppFileIndexArchiveMatch(title: string, createdAt: string) {
  const titleKey = cleanIndexTitle(title);
  const dateKey = indexDateKey(createdAt);
  const current = readArchiveRaw();
  const next = current.filter(
    (row) => !(cleanIndexTitle(row.title) === titleKey && indexDateKey(row.createdAt) === dateKey),
  );
  if (next.length !== current.length) writeArchive(next);
}

export function groupIndexItems(
  items: InfoIndexItem[],
  view: InfoIndexView,
): { key: string; items: InfoIndexItem[] }[] {
  const buckets = new Map<string, InfoIndexItem[]>();
  const push = (key: string, item: InfoIndexItem) => {
    const list = buckets.get(key) || [];
    list.push(item);
    buckets.set(key, list);
  };

  for (const item of items) {
    if (view === "category") {
      push(item.category, item);
    } else if (view === "date") {
      push(item.dateKey || item.createdAtLabel, item);
    } else {
      const tags = item.tags.length ? item.tags : ["기타"];
      for (const tag of tags) push(`#${tag.replace(/^#+/, "")}`, item);
    }
  }

  const keys = Array.from(buckets.keys());
  if (view === "category") {
    keys.sort(
      (a, b) =>
        INFO_INDEX_CATEGORIES.indexOf(a as InfoIndexCategory) -
        INFO_INDEX_CATEGORIES.indexOf(b as InfoIndexCategory),
    );
  } else if (view === "date") {
    keys.sort((a, b) => b.localeCompare(a));
  } else {
    keys.sort((a, b) => a.localeCompare(b, "ko"));
  }

  return keys.map((key) => ({
    key,
    items: dedupeIndexItems(
      [...(buckets.get(key) || [])].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.dateKey || "").localeCompare(a.dateKey || "");
      }),
    ),
  }));
}

export function dedupeIndexItems(items: InfoIndexItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}|${item.appFileMark || ""}|${item.title.replace(/…$/, "").slice(0, 24)}|${item.dateKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function iflRecordToIndexItem(row: Record<string, unknown>): InfoIndexItem | null {
  const id = String(row.id || "").trim();
  const title =
    String(row.title || row.appFileName || "").trim() ||
    String(row.caption || row.originalCaption || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ||
    "";
  if (!id || !title) return null;
  const createdAt = String(row.createdAt || row.updatedAt || "").trim();
  const topic = String(row.topic || "").trim();
  const rawTags = Array.isArray(row.tags) ? row.tags : [];
  return buildIndexItem({
    id: `ifl:${id}`,
    title,
    createdAt,
    categoryRaw: topic,
    tags: [topic, ...rawTags, title],
    source: "insta-fact-library",
    detailUrl: `${IFL_APP_URL.replace(/\/$/, "")}/?item=${encodeURIComponent(id)}`,
  });
}

export function parseIflLibraryPayload(data: unknown): InfoIndexItem[] {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(root.items)
    ? root.items
    : Array.isArray(data)
      ? data
      : [];
  const items: InfoIndexItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const item = iflRecordToIndexItem(row as Record<string, unknown>);
    if (item) items.push(item);
  }
  return dedupeIndexItems(items);
}

export function extractLibraryItemsFromHtml(html: string) {
  const found = new Map<string, { title: string; createdAt: string; tags: string[] }>();

  const remember = (rawId: string, titleRaw: string) => {
    const id = String(rawId || "").replace(/#.*$/, "").trim();
    const title = unescapeHtmlText(titleRaw).trim();
    if (!id || title.length < 2 || isGarbageTitle(title)) return;
    const hashTags = title.match(/#[^\s#]+/g) || [];
    const existing = found.get(id);
    const createdAt = existing?.createdAt || createdAtForId(html, id);
    const nextTitle =
      existing?.title && !isGarbageTitle(existing.title) && existing.title.length <= title.length
        ? existing.title
        : title;
    found.set(id, {
      title: nextTitle,
      createdAt,
      tags: normalizeIndexTags([...(existing?.tags || []), ...hashTags, nextTitle]),
    });
  };

  const linkRe = /href="\/videos\/([^"]+)"[^>]*title="([^"]*)"/gi;
  const altLinkRe = /title="([^"]*)"[^>]*href="\/videos\/([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) remember(match[1], match[2]);
  while ((match = altLinkRe.exec(html))) remember(match[2], match[1]);

  const escapedIdRe =
    /id\\":\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\"/gi;
  while ((match = escapedIdRe.exec(html))) {
    const id = match[1];
    const window = html.slice(match.index, Math.min(html.length, match.index + 1400));
    if (/type\\":\\"(claim|opinion)\\"/.test(window.slice(0, 500))) continue;
    if (!/inputMode\\":\\"/.test(window) && !found.has(id)) continue;
    const titleMatch =
      window.match(/title\\":\\"([^\\"]+)\\"/) ||
      window.match(/"title":"([^"]+)"/);
    const createdMatch =
      window.match(/createdAt\\":\\"([^\\"]+)/) ||
      window.match(/"createdAt":"([^"]+)"/);
    if (!titleMatch) continue;
    const title = unescapeJsonString(titleMatch[1]).trim();
    if (title.length < 2 || isGarbageTitle(title)) continue;
    remember(id, title);
    if (createdMatch) {
      const current = found.get(id);
      if (current && !current.createdAt) {
        found.set(id, { ...current, createdAt: createdMatch[1] });
      }
    }
  }

  return Array.from(found.entries()).map(([id, value]) => ({ id, ...value }));
}

function unescapeHtmlText(value: string) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function createdAtForId(html: string, id: string) {
  const idx = html.lastIndexOf(id);
  if (idx < 0) return "";
  const window = html.slice(idx, idx + 2800);
  return (
    window.match(/createdAt\\":\\"([^\\"]+)/)?.[1] ||
    window.match(/"createdAt":"([^"]+)"/)?.[1] ||
    ""
  );
}
