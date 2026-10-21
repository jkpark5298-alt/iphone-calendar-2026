import { NextRequest, NextResponse } from "next/server";
import { googleDriveStatus } from "../../../../lib/googleDrive";

export const dynamic = "force-dynamic";

/** 연결 상태를 실제로 확인해서 알려준다. ?force=1 이면 캐시 없이 다시 확인한다. */
export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    return NextResponse.json(await googleDriveStatus(force), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("google drive status failed", error);
    return NextResponse.json({
      configured: true,
      connected: false,
      healthy: false,
      reason: "error",
      message: "연결 상태를 확인하지 못했습니다.",
    });
  }
}
