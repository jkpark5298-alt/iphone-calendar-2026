import { NextRequest, NextResponse } from "next/server";
import { assertRateLimit, clientIpFromRequest, getAllowedCorsOrigins } from "../../../../lib/apiSecurity";
import { DriveAuthRevokedError, downloadDriveFile } from "../../../../lib/googleDrive";

/**
 * 사진 파일 하나는 만든 뒤 바뀌지 않는다(새 사진은 새 파일 ID).
 * 그래서 브라우저와 Vercel 서버가 1년 동안 보관해 두고 Drive에서 다시 받지 않게 한다.
 */
const IMMUTABLE_CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";

export async function GET(request: NextRequest) {
  // 다른 사이트에서 이 사진을 끌어다 쓰는 것을 막는다. (허용 목록에 있는 내 다른 앱은 통과)
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    const from = request.headers.get("origin") || request.headers.get("referer") || "";
    let fromOrigin = "";
    try {
      fromOrigin = new URL(from).origin;
    } catch {
      /* 출처 정보 없음 */
    }
    if (!fromOrigin || !getAllowedCorsOrigins().includes(fromOrigin)) {
      return NextResponse.json({ error: "허용되지 않는 요청입니다." }, { status: 403 });
    }
  }
  const limited = assertRateLimit(`drive-file:${clientIpFromRequest(request)}`, 600, 60_000);
  if (limited) return limited;

  const fileId = request.nextUrl.searchParams.get("id") || "";
  try {
    const file = await downloadDriveFile(fileId);
    return new NextResponse(file.bytes, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": IMMUTABLE_CACHE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "사진을 받지 못했습니다.";
    const status =
      error instanceof DriveAuthRevokedError || /연결되지 않/.test(message) ? 401 : 404;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
