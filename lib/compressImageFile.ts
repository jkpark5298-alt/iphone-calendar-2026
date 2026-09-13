/** Shrink iPhone photos so multi-uploads stay under storage limits (from insta-fact-library). */
export const UPLOAD_MAX_EDGE = 2560;
export const UPLOAD_JPEG_QUALITY = 0.9;

export async function compressImageFile(file: File): Promise<File> {
  const isHeic =
    /heic|heif/i.test(file.type || "") ||
    /\.(heic|heif)$/i.test(file.name || "");
  // HEIC often fails later — always try JPEG convert. Keep small JPEG/PNG as-is.
  if (!isHeic && file.size > 0 && file.size <= 1_800_000) return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const max = UPLOAD_MAX_EDGE;
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
      canvas.toBlob(resolve, "image/jpeg", UPLOAD_JPEG_QUALITY);
    });
    if (!blob || blob.size === 0) return file;
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
    return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
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
