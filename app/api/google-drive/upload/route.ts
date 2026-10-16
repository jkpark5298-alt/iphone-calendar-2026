import { NextRequest, NextResponse } from "next/server";
import { uploadDriveJpeg } from "../../../../lib/googleDrive";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "압축 파일이 없습니다." }, { status: 400 });
    }
    const albumId = String(form.get("albumId") || "album");
    const photoId = String(form.get("photoId") || "photo");
    const result = await uploadDriveJpeg(albumId, photoId, await file.arrayBuffer());
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive 업로드에 실패했습니다.";
    const status = /연결되지 않/.test(message) ? 401 : 500;
    console.error("google drive upload failed", error);
    return NextResponse.json({ error: message }, { status });
  }
}
