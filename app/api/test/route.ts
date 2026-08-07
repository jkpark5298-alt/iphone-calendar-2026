import { NextRequest, NextResponse } from "next/server";
import {
  assertAppApiAccess,
  assertRateLimit,
  clientIpFromRequest,
  getServerGeminiApiKey,
  isProductionRuntime,
} from "../../../lib/apiSecurity";

/**
 * Diagnostic endpoint — disabled in production unless ENABLE_DIAGNOSTIC_API=true
 * and a Bearer APP_API_TOKEN / GENERAL_INFO_API_TOKEN is provided.
 * Never uses service role or writes to DB.
 */
export async function GET(request: NextRequest) {
  if (
    isProductionRuntime() &&
    process.env.ENABLE_DIAGNOSTIC_API !== "true" &&
    process.env.ENABLE_DIAGNOSTIC_API !== "1"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authError = assertAppApiAccess(request);
  if (authError) return authError;

  const rateError = assertRateLimit(
    `diag:${clientIpFromRequest(request)}`,
    10,
    60_000,
  );
  if (rateError) return rateError;

  return NextResponse.json({
    ok: true,
    env: {
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasGemini: Boolean(
        process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      ),
    },
    message:
      "진단 전용입니다. DB/Gemini 실호출은 /api/gemini-key-check 를 사용하세요.",
  });
}
