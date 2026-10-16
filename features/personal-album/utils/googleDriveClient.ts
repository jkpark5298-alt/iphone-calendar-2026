export async function uploadCompressedJpegToDrive(
  file: Blob,
  albumId: string,
  photoId: string,
): Promise<{ fileId: string; fileUrl: string; bytes: number }> {
  const body = new FormData();
  body.set("file", file, `${photoId}.jpg`);
  body.set("albumId", albumId);
  body.set("photoId", photoId);
  const response = await fetch("/api/google-drive/upload", { method: "POST", body });
  const payload = (await response.json().catch(() => ({}))) as {
    fileId?: string;
    fileUrl?: string;
    bytes?: number;
    error?: string;
  };
  if (!response.ok || !payload.fileId || !payload.fileUrl) {
    throw new Error(payload.error || "Google Drive 업로드에 실패했습니다.");
  }
  return { fileId: payload.fileId, fileUrl: payload.fileUrl, bytes: payload.bytes || file.size };
}
