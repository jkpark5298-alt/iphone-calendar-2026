import { NextRequest, NextResponse } from "next/server";
import { assertRateLimit, clientIpFromRequest, isSameOriginRequest } from "../../../../lib/apiSecurity";
import { DriveAuthRevokedError, uploadDriveJpeg } from "../../../../lib/googleDrive";

/** 앨범 압축본 한 장의 상한. 앱의 압축 단계가 이 크기 아래로 맞춘다. */
const MAX_UPLOAD_BYTES = 9_500_000;

export async function POST(request: NextRequest) {
  // 이 앱 화면에서 보낸 요청만 받는다 (다른 사이트에서 몰래 올리는 것을 막음).
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "요청 권한이 없습니다." }, { status: 401 });
  }
  const limited = assertRateLimit(`drive-upload:${clientIpFromRequest(request)}`, 120, 60_000);
  if (limited) return limited;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "압축 파일이 없습니다." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "압축 사진 크기가 허용 범위를 넘습니다." }, { status: 413 });
    }
    const albumId = String(form.get("albumId") || "album");
    const photoId = String(form.get("photoId") || "photo");
    const result = await uploadDriveJpeg(albumId, photoId, await file.arrayBuffer());
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive 업로드에 실패했습니다.";
    const status = error instanceof DriveAuthRevokedError || /연결되지 않/.test(message) ? 401 : 500;
    console.error("google drive upload failed", error);
    return NextResponse.json({ error: message }, { status });
  }
}
