import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export type UnifiedSearchResult = {
  type: "diary" | "info" | "information" | "general";
  entryDate: string;
  year: number;
  month: number;
  day: number;
  text: string;
  itemId?: string;
};

const MAX_Q = 80;
const LIMIT_PER_SOURCE = 30;
const MAX_RESULTS = 50;

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) {
    throw new Error("Supabase URL 또는 Key 환경변수가 없습니다.");
  }
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false },
  });
};

const stripHtml = (value: string) =>
  String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** PostgREST or/ilike 안전용: 쉼표·따옴표 제거, LIKE 와일드카드 이스케이프 */
const sanitizeQuery = (raw: string) =>
  String(raw || "")
    .trim()
    .slice(0, MAX_Q)
    .replace(/[%_,"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseEntryDate = (value: string) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

const likePattern = (q: string) => `%${q}%`;

export async function GET(request: NextRequest) {
  try {
    const q = sanitizeQuery(request.nextUrl.searchParams.get("q") || "");
    if (!q) {
      return NextResponse.json({ ok: true, results: [], status: "검색어를 입력하세요." });
    }

    const supabase = getSupabaseAdmin();
    const pattern = likePattern(q);
    const orIlike = (columns: string[]) =>
      columns.map((col) => `${col}.ilike."${pattern}"`).join(",");

    const [diaryRes, infoCardsRes, infoMemoRes, informationRes, generalRes] = await Promise.all([
      supabase
        .from("diary_entries")
        .select("entry_date, diary_text, voice_text")
        .or(orIlike(["diary_text", "voice_text"]))
        .order("entry_date", { ascending: false })
        .limit(LIMIT_PER_SOURCE),
      supabase
        .from("info_text_cards")
        .select("entry_date, content")
        .ilike("content", pattern)
        .order("entry_date", { ascending: false })
        .limit(LIMIT_PER_SOURCE),
      supabase
        .from("info_photos")
        .select("entry_date, caption")
        .ilike("caption", pattern)
        .order("entry_date", { ascending: false })
        .limit(LIMIT_PER_SOURCE),
      supabase
        .from("information_entries")
        .select("id, title, summary, category, primary_date, checked")
        .or(orIlike(["title", "summary"]))
        .order("primary_date", { ascending: false })
        .limit(LIMIT_PER_SOURCE),
      supabase
        .from("general_info_items")
        .select("id, title, summary, text, keywords, created_at")
        .or(orIlike(["title", "summary", "text"]))
        .order("created_at", { ascending: false })
        .limit(LIMIT_PER_SOURCE),
    ]);

    const warnings = [
      diaryRes.error?.message,
      infoCardsRes.error?.message,
      infoMemoRes.error?.message,
      informationRes.error?.message,
      generalRes.error?.message,
    ].filter(Boolean) as string[];

    const results: UnifiedSearchResult[] = [];
    const qLower = q.toLowerCase();

    for (const row of diaryRes.data || []) {
      const date = parseEntryDate(String(row.entry_date || ""));
      if (!date) continue;
      const text = stripHtml([row.diary_text, row.voice_text].filter(Boolean).join(" / "));
      results.push({
        type: "diary",
        entryDate: String(row.entry_date),
        ...date,
        text: text || "일기장 검색 결과",
      });
    }

    for (const row of infoCardsRes.data || []) {
      const date = parseEntryDate(String(row.entry_date || ""));
      if (!date) continue;
      let cardText = String(row.content || "");
      if (cardText.startsWith("{")) {
        try {
          const parsed = JSON.parse(cardText);
          cardText = `[인스타 정보 - ${parsed.category}] #${parsed.keyword} / ${parsed.originalText}`;
        } catch {
          /* keep */
        }
      }
      results.push({
        type: "info",
        entryDate: String(row.entry_date),
        ...date,
        text: stripHtml(cardText) || "인스타 주요 정보 검색 결과",
      });
    }

    for (const row of infoMemoRes.data || []) {
      const date = parseEntryDate(String(row.entry_date || ""));
      if (!date) continue;
      let captionText = String(row.caption || "");
      if (captionText.startsWith("{")) {
        try {
          const parsed = JSON.parse(captionText);
          captionText = `[포토북] #${parsed.keyword} / ${parsed.memo}`;
        } catch {
          /* keep */
        }
      }
      results.push({
        type: "info",
        entryDate: String(row.entry_date),
        ...date,
        text: stripHtml(captionText) || "포토북 사진 메모 검색 결과",
      });
    }

    for (const row of informationRes.data || []) {
      const iso = String(row.primary_date || "").slice(0, 10);
      const date = parseEntryDate(iso);
      if (!date) continue;
      const label = row.checked ? "정보함(완료)" : "정보함";
      results.push({
        type: "information",
        entryDate: iso,
        ...date,
        itemId: String(row.id || ""),
        text: `${label} · ${row.title || "제목 없음"}${row.summary ? ` / ${row.summary}` : ""}`,
      });
    }

    for (const row of generalRes.data || []) {
      const created = String(row.created_at || "").slice(0, 10);
      const date = parseEntryDate(created) || {
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        day: new Date().getDate(),
      };
      const keywords = Array.isArray(row.keywords)
        ? row.keywords.map(String).join(",")
        : String(row.keywords || "");
      const matched =
        [row.title, row.summary, row.text].some((v) =>
          String(v || "").toLowerCase().includes(qLower),
        ) || keywords.toLowerCase().includes(qLower);
      if (!matched) continue;
      results.push({
        type: "general",
        entryDate: created || `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
        year: date.year,
        month: date.month,
        day: date.day,
        itemId: String(row.id || ""),
        text: `일반정보 · ${row.title || "제목 없음"}${
          row.summary ? ` / ${stripHtml(String(row.summary))}` : keywords ? ` / #${keywords}` : ""
        }`,
      });
    }

    // keywords-only 보강: title/text에 없어도 keywords에 있으면 포함 (소량 limit)
    if (!generalRes.error) {
      const { data: keywordRows } = await supabase
        .from("general_info_items")
        .select("id, title, summary, keywords, created_at")
        .order("created_at", { ascending: false })
        .limit(150);
      for (const row of keywordRows || []) {
        const keywords = Array.isArray(row.keywords)
          ? row.keywords.map(String).join(",")
          : String(row.keywords || "");
        if (!keywords.toLowerCase().includes(qLower)) continue;
        if (results.some((r) => r.type === "general" && r.itemId === String(row.id))) continue;
        const created = String(row.created_at || "").slice(0, 10);
        const date = parseEntryDate(created) || {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          day: new Date().getDate(),
        };
        results.push({
          type: "general",
          entryDate: created || `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
          year: date.year,
          month: date.month,
          day: date.day,
          itemId: String(row.id || ""),
          text: `일반정보 · ${row.title || "제목 없음"} / #${keywords}`,
        });
      }
    }

    const unique = new Map<string, UnifiedSearchResult>();
    for (const result of results) {
      const key = `${result.type}-${result.itemId || result.entryDate}-${result.text.slice(0, 40)}`;
      if (!unique.has(key)) unique.set(key, result);
    }
    const finalResults = Array.from(unique.values()).slice(0, MAX_RESULTS);

    return NextResponse.json({
      ok: true,
      results: finalResults,
      status: finalResults.length ? `${finalResults.length}개 검색 결과` : "검색 결과가 없습니다.",
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (error) {
    console.error("search api error:", error);
    return NextResponse.json(
      {
        ok: false,
        results: [],
        status: "검색 중 오류가 발생했습니다.",
        error: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 },
    );
  }
}
