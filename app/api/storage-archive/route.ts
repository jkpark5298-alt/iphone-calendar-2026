import { NextRequest, NextResponse } from "next/server";
import { assertRateLimit, clientIpFromRequest, isSameOriginRequest } from "../../../lib/apiSecurity";
import { archiveGeneralInfoImages } from "../../../lib/generalInfoArchive";

export const dynamic = "force-dynamic";
// 사진 여러 장을 내려받고 줄이고 올리므로 여유를 둔다.
export const maxDuration = 60;

/**
 * 저장 공간이 80%를 넘으면 일반정보수집 사진을 Google Drive로 옮긴다.
 * 80% 미만이면 아무 것도 하지 않고 바로 돌아온다.
 * 앱을 열었을 때 화면(StorageArchiveRunner)이 호출한다.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, error: "요청 권한이 없습니다." }, { status: 401 });
  }
  const limited = assertRateLimit(`storage-archive:${clientIpFromRequest(request)}`, 30, 60_000);
  if (limited) return limited;

  try {
    const params = request.nextUrl.searchParams;
    // force / only 는 개발 서버에서 시험할 때만 쓸 수 있다.
    const devOnly = process.env.NODE_ENV !== "production";
    const result = await archiveGeneralInfoImages({
      continuing: params.get("continue") === "1",
      force: devOnly && params.get("force") === "1",
      onlyPath: devOnly ? params.get("only") || undefined : undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("storage archive failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "사진을 옮기지 못했습니다." },
      { status: 500 },
    );
  }
}
