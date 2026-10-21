/** Shrink iPhone photos so multi-uploads stay under storage limits (from insta-fact-library). */
export const UPLOAD_MAX_EDGE = 2560;
export const UPLOAD_JPEG_QUALITY = 0.9;

export type CompressImageOptions = {
  /** 긴 변의 최대 길이(px) */
  maxEdge?: number;
  /** JPEG 품질 0~1 */
  quality?: number;
  /** 이 크기 이하의 사진은 그대로 둔다 */
  skipUnderBytes?: number;
};

/** 일반정보수집 사진: 글 읽기용이라 일기장 사진보다 더 작게 줄인다. */
export const GENERAL_INFO_COMPRESS: CompressImageOptions = {
  maxEdge: 1920,
  quality: 0.82,
  skipUnderBytes: 600_000,
};

export async function compressImageFile(file: File, options: CompressImageOptions = {}): Promise<File> {
  const maxEdge = options.maxEdge ?? UPLOAD_MAX_EDGE;
  const quality = options.quality ?? UPLOAD_JPEG_QUALITY;
  const skipUnderBytes = options.skipUnderBytes ?? 1_800_000;
  const isHeic =
    /heic|heif/i.test(file.type || "") ||
    /\.(heic|heif)$/i.test(file.name || "");
  // HEIC often fails later — always try JPEG convert. Keep small JPEG/PNG as-is.
  if (!isHeic && file.size > 0 && file.size <= skipUnderBytes) return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const max = maxEdge;
    let width = bitmap.width;
    let height = bitmap.height;
    if (width > max || height > max) {
      const scale = max / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    // 줄였는데 오히려 커지면 원본을 쓴다 (이미 잘 압축된 사진)
    if (!blob || blob.size === 0 || (blob.size >= file.size && !isHeic)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}

export function filterUploadImageFiles(files: File[]): File[] {
  return files.filter((file) => {
    if (!file || file.size === 0) return false;
    if (!file.type || file.type.startsWith("image/")) return true;
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name);
  });
}

/** Clipboard helper matching insta-fact-library imageFilesFromClipboard. */
export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || file.size === 0) return;
    const ok =
      !file.type ||
      file.type.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
    if (!ok) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (const file of Array.from(data.files || [])) push(file);
  if (out.length > 0) return out;
  for (const item of Array.from(data.items || [])) {
    if (!item.type.startsWith("image/")) continue;
    push(item.getAsFile());
  }
  return out;
}
