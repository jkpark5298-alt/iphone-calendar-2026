import { NextRequest, NextResponse } from "next/server";
import { downloadDriveFile } from "../../../../lib/googleDrive";

export async function GET(request: NextRequest) {
  const fileId = request.nextUrl.searchParams.get("id") || "";
  try {
    const file = await downloadDriveFile(fileId);
    return new NextResponse(file.bytes, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "사진을 받지 못했습니다.";
    const status = /연결되지 않/.test(message) ? 401 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
