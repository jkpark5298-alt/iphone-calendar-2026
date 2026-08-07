import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type GeneralInfoPayload = {
  id: number;
  title: string;
  text: string;
  sourceUrl?: string;
  fileName?: string;
  filePreview?: string;
  fileType: "none" | "image" | "video";
  storagePath?: string;
  mediaItems?: Array<{
    id: number;
    name: string;
    type: "none" | "image" | "video";
    preview: string;
    storagePath?: string;
    fileUrl?: string;
    memo?: string;
  }>;
  primaryCategory: string;
  secondaryCategory: string;
  thirdCategory: string;
  keywords: string[];
  inputTypes: string[];
  summary: string;
  factCheckStatus: string;
  factCheckSummary: string;
  extraNote?: string;
  formattedTextHtml?: string;
  confirmed: boolean;
  createdAt: string;
};

const MAX_TEXT_LENGTH = 50000;
const MAX_FACT_CHECK_SUMMARY_LENGTH = 1_000_000;
const MAX_KEYWORDS = 30;
const MAX_INPUT_TYPES = 8;
const MAX_MEDIA_ITEMS = 20;

const normalizeString = (value: unknown, maxLength = 1000) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const normalizeNumberId = (value: unknown) => {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : 0;
};

const normalizeStringArray = (value: unknown, maxItems: number) =>
  Array.isArray(value)
    ? value
        .map((item) => normalizeString(item, 120))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

const normalizeMediaItems = (value: unknown): GeneralInfoPayload["mediaItems"] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const source =
        item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const mediaType = normalizeString(source.type, 20);
      const safeType: "none" | "image" | "video" =
        mediaType === "image" || mediaType === "video" ? mediaType : "none";

      const preview = normalizeString(source.preview, 4000);
      const storagePath = normalizeString(source.storagePath, 1000) || undefined;
      const fileUrl = normalizeString((source as Record<string, unknown>).fileUrl, 4000) || undefined;

      const memo = normalizeString(source.memo, 2000) || undefined;

      return {
        id: normalizeNumberId(source.id) || Date.now(),
        name: normalizeString(source.name, 240),
        type: safeType,
        preview: preview || fileUrl || "",
        storagePath,
        fileUrl,
        ...(memo ? { memo } : {}),
      };
    })
    // storagePath나 fileUrl이 있으면 preview가 없어도 저장 (Storage 이미지 보존)
    .filter((item) => item.preview || item.storagePath || item.fileUrl)
    .slice(0, MAX_MEDIA_ITEMS);
};

const normalizePayload = (value: unknown): GeneralInfoPayload | null => {
  if (!value || typeof value !== "object") return null;

  const source = value as Record<string, unknown>;
  const fileType = normalizeString(source.fileType, 20);

  return {
    id: normalizeNumberId(source.id),
    title: normalizeString(source.title, 300),
    text: normalizeString(source.text, MAX_TEXT_LENGTH),
    sourceUrl: normalizeString(source.sourceUrl, 2000) || undefined,
    fileName: normalizeString(source.fileName, 300) || undefined,
    filePreview: normalizeString(source.filePreview, 4000) || undefined,
    fileType: fileType === "image" || fileType === "video" ? fileType : "none",
    storagePath: normalizeString(source.storagePath, 1000) || undefined,
    mediaItems: normalizeMediaItems(source.mediaItems),
    primaryCategory: normalizeString(source.primaryCategory, 80) || "사회",
    secondaryCategory: normalizeString(source.secondaryCategory, 80) || "일반",
    thirdCategory: normalizeString(source.thirdCategory, 80) || "기타",
    keywords: normalizeStringArray(source.keywords, MAX_KEYWORDS),
    inputTypes: normalizeStringArray(source.inputTypes, MAX_INPUT_TYPES),
    summary: normalizeString(source.summary, 4000),
    factCheckStatus: normalizeString(source.factCheckStatus, 80) || "확인 전",
    factCheckSummary: normalizeString(source.factCheckSummary, MAX_FACT_CHECK_SUMMARY_LENGTH),
    extraNote: normalizeString(source.extraNote, 4000) || undefined,
    formattedTextHtml: normalizeString(source.formattedTextHtml, MAX_TEXT_LENGTH) || undefined,
    confirmed: source.confirmed !== false,
    createdAt: normalizeString(source.createdAt, 80),
  };
};

const getWriteAuthError = (request: NextRequest) => {
  const token = process.env.GENERAL_INFO_API_TOKEN || process.env.APP_API_TOKEN;
  const authorization = request.headers.get("authorization") || "";
  if (token && authorization === `Bearer ${token}`) return null;

  // 토큰이 없어도 same-origin은 필수 (기존: 토큰 없으면 무조건 통과 → 위험)
  const host = request.headers.get("host") || request.nextUrl.host;
  const forwardedHost = request.headers.get("x-forwarded-host");

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (
        originUrl.host === host ||
        originUrl.host === request.nextUrl.host ||
        (forwardedHost && originUrl.host === forwardedHost)
      ) {
        return null;
      }
    } catch {
      /* ignore */
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (
        refererUrl.host === host ||
        refererUrl.host === request.nextUrl.host ||
        (forwardedHost && refererUrl.host === forwardedHost)
      ) {
        return null;
      }
    } catch {
      /* ignore */
    }
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      error: "일반 정보 변경 권한이 없습니다.",
    },
    { status: 401 },
  );
};

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // 개인 앱 호환: service role 우선. 장기적으로 RLS+anon으로 전환 권장.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !key) {
    throw new Error("Supabase URL 또는 Key 환경변수가 없습니다.");
  }

  return createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
    },
  });
};

const toDbRow = (item: GeneralInfoPayload, includeFormattedHtml = true) => ({
  id: item.id,
  title: item.title || "",
  text: item.text || "",
  source_url: item.sourceUrl || null,
  file_name: item.fileName || null,
  file_preview: item.filePreview || null,
  file_type: item.fileType || "none",
  media_items: Array.isArray(item.mediaItems) ? item.mediaItems : [],

  primary_category: item.primaryCategory || "사회",
  secondary_category: item.secondaryCategory || "일반",
  third_category: item.thirdCategory || "기타",

  keywords: Array.isArray(item.keywords) ? item.keywords : [],
  input_types: Array.isArray(item.inputTypes) ? item.inputTypes : [],

  summary: item.summary || "",
  fact_check_status: item.factCheckStatus || "확인 전",
  fact_check_summary: item.factCheckSummary || "",

  extra_note: item.extraNote || "",
  ...(includeFormattedHtml ? { formatted_text_html: item.formattedTextHtml || "" } : {}),
  confirmed: item.confirmed !== false,
  created_at_text: item.createdAt || "",
});

const upsertGeneralInfoRow = async (
  supabase: ReturnType<typeof getSupabaseAdmin>,
  item: GeneralInfoPayload,
) => {
  const first = await supabase
    .from("general_info_items")
    .upsert(toDbRow(item, true))
    .select("*")
    .single();

  if (!first.error) return first;

  const message = String(first.error.message || "");
  if (/formatted_text_html/i.test(message)) {
    return supabase
      .from("general_info_items")
      .upsert(toDbRow(item, false))
      .select("*")
      .single();
  }

  return first;
};

const fromDbRow = (row: Record<string, unknown>): GeneralInfoPayload => {
  // media_items에서 storagePath로 공개 URL 복원
  const rawMediaItems = Array.isArray(row.media_items) ? row.media_items : [];
  const restoredMediaItems = rawMediaItems.map((item: Record<string, unknown>) => {
    const storagePath = normalizeString(item.storagePath, 1000) || undefined;
    let preview = normalizeString(item.preview, 4000);
    const fileUrl = normalizeString(item.fileUrl, 4000) || undefined;

    // preview가 blob: 또는 없으면 storagePath/fileUrl로 대체
    if ((!preview || preview.startsWith("blob:")) && (storagePath || fileUrl)) {
      preview = fileUrl || "";
    }

    return { ...item, preview, storagePath, fileUrl };
  });

  return {
    id: Number(row.id),
    title: normalizeString(row.title, 300),
    text: normalizeString(row.text, MAX_TEXT_LENGTH),
    sourceUrl: normalizeString(row.source_url, 2000) || undefined,
    fileName: normalizeString(row.file_name, 300) || undefined,
    filePreview: normalizeString(row.file_preview, 4000) || undefined,
    fileType: row.file_type === "image" || row.file_type === "video" ? row.file_type : "none",
    mediaItems: normalizeMediaItems(restoredMediaItems),

    primaryCategory: normalizeString(row.primary_category, 80) || "사회",
    secondaryCategory: normalizeString(row.secondary_category, 80) || "일반",
    thirdCategory: normalizeString(row.third_category, 80) || "기타",

    keywords: normalizeStringArray(row.keywords, MAX_KEYWORDS),
    inputTypes: normalizeStringArray(row.input_types, MAX_INPUT_TYPES),

    summary: normalizeString(row.summary, 4000),
    factCheckStatus: normalizeString(row.fact_check_status, 80) || "확인 전",
    factCheckSummary: normalizeString(row.fact_check_summary, MAX_TEXT_LENGTH),

    extraNote: normalizeString(row.extra_note, 4000),
    formattedTextHtml: normalizeString(row.formatted_text_html, MAX_TEXT_LENGTH) || undefined,
    confirmed: row.confirmed !== false,
    createdAt:
      normalizeString(row.created_at_text, 80) ||
      (row.created_at ? new Date(String(row.created_at)).toLocaleString("ko-KR") : ""),
  };
};

export async function GET(request: NextRequest) {
  try {
    const { assertAppApiAccess } = await import("../../../lib/apiSecurity");
    const authError = assertAppApiAccess(request);
    if (authError) return authError;

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("general_info_items")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "일반 정보 불러오기 실패",
          detail: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      items: (data || []).map(fromDbRow),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "일반 정보 API GET 처리 중 오류",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authError = getWriteAuthError(request);
    if (authError) return authError;

    const item = normalizePayload(await request.json());
    if (!item || !item.id || !item.title) {
      return NextResponse.json(
        {
          ok: false,
          error: "저장할 일반 정보 id와 제목이 필요합니다.",
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await upsertGeneralInfoRow(supabase, item);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "일반 정보 저장 실패",
          detail: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      item: fromDbRow(data),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "일반 정보 API POST 처리 중 오류",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authError = getWriteAuthError(request);
    if (authError) return authError;

    const item = normalizePayload(await request.json());
    const supabase = getSupabaseAdmin();

    if (!item?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "수정할 일반 정보 id가 없습니다.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await upsertGeneralInfoRow(supabase, item);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "일반 정보 수정 실패",
          detail: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      item: fromDbRow(data),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "일반 정보 API PUT 처리 중 오류",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authError = getWriteAuthError(request);
    if (authError) return authError;

    const { id: rawId } = (await request.json()) as { id?: number };
    const id = normalizeNumberId(rawId);
    const supabase = getSupabaseAdmin();

    if (!id) {
      return NextResponse.json(
        {
          ok: false,
          error: "삭제할 일반 정보 id가 없습니다.",
        },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("general_info_items")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "일반 정보 삭제 실패",
          detail: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "일반 정보 API DELETE 처리 중 오류",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
