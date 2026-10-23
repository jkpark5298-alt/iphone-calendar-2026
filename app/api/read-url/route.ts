import { NextRequest, NextResponse } from "next/server";
import { assertAppApiAccess, assertRateLimit, clientIpFromRequest } from "../../../lib/apiSecurity";
import { ReadUrlError, readUrlAsArticle } from "../../../lib/readUrl";

// 페이지 받기 + 사진 복사까지 하므로 여유를 둔다.
export const maxDuration = 60;

/** 웹페이지(신문, 블로그 등)를 읽기 도구 형식으로 가져온다. */
export async function POST(request: NextRequest) {
  try {
    const authError = assertAppApiAccess(request);
    if (authError) return authError;

    const rateError = assertRateLimit(`read-url:${clientIpFromRequest(request)}`, 20, 60_000);
    if (rateError) return rateError;

    const body = (await request.json().catch(() => ({}))) as { url?: string };
    const result = await readUrlAsArticle(String(body.url || ""));
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReadUrlError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    // assertSafePublicHttpUrl 등이 던지는 한국어 안내 문구는 그대로 보여 준다.
    const message = error instanceof Error ? error.message : "";
    const known = /URL|주소|내부|http|호스트/.test(message);
    return NextResponse.json(
      { ok: false, error: known ? message : "웹페이지를 읽는 중 오류가 발생했습니다." },
      { status: known ? 400 : 500 },
    );
  }
}
