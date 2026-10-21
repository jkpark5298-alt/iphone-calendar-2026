import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { assertSafePublicHttpUrl } from "./apiSecurity";

/**
 * 다른 사이트(인스타그램 등)의 이미지를 우리 Supabase에 복사해 둔다.
 * 인스타그램 이미지 주소는 며칠 뒤 만료되어 사진이 사라지기 때문에, 수집하는 순간 파일로 저장한다.
 * 가져온 이미지는 가로·세로 1600px 이하 JPEG로 줄여서 저장한다 (보통 50~200KB).
 */
export const GENERAL_INFO_BUCKET = "info-photos";
const MAX_SOURCE_BYTES = 12_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function serviceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 사진 한 장을 저장용 JPEG로 줄인다 (회전 정보 반영, 확대하지 않음). */
export async function compressForStorage(input: Buffer, maxEdge = 1600, quality = 80): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

const isOwnStorageUrl = (url: string) => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "") || "";
  return Boolean(base) && url.startsWith(`${base}/storage/`);
};

/** 리다이렉트를 직접 따라가며 매 단계마다 내부 주소인지 확인한다 (SSRF 방지). */
async function fetchImageBytes(rawUrl: string): Promise<Buffer> {
  let current = await assertSafePublicHttpUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      headers: { "User-Agent": BROWSER_UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("이미지 주소가 올바르지 않습니다.");
      current = await assertSafePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`이미지를 받지 못했습니다 (${response.status})`);
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) throw new Error("이미지 파일이 아닙니다.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_SOURCE_BYTES) throw new Error("이미지가 너무 큽니다.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) throw new Error("이미지 크기가 허용 범위를 넘습니다.");
    return bytes;
  }
  throw new Error("이미지 주소가 너무 여러 번 이동합니다.");
}

/** 같은 사진을 다시 가져와도 같은 파일 이름을 쓰도록, 주소에서 서명(?뒤)을 뺀 부분으로 이름을 만든다. */
function mirrorStoragePath(rawUrl: string): string {
  let key = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    key = `${parsed.host}${parsed.pathname}`;
  } catch {
    // 주소 전체를 그대로 사용
  }
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 20);
  return `general-info/mirror-${hash}.jpg`;
}

export type MirroredImage = { url: string; storagePath: string; bytes: number };

/**
 * 이미지 주소를 내려받아 줄인 뒤 Supabase에 저장하고 새 주소를 돌려준다.
 * 이미 우리 저장소 주소이거나 data:, blob: 이면 null (그대로 쓰면 된다).
 * 실패하면 null → 호출한 쪽은 원래 주소를 그대로 쓴다.
 */
export async function mirrorRemoteImage(rawUrl: string): Promise<MirroredImage | null> {
  const source = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(source) || isOwnStorageUrl(source)) return null;
  const supabase = serviceSupabase();
  const original = await fetchImageBytes(source);
  const compressed = await compressForStorage(original);
  const storagePath = mirrorStoragePath(source);
  const { error } = await supabase.storage.from(GENERAL_INFO_BUCKET).upload(storagePath, compressed, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(GENERAL_INFO_BUCKET).getPublicUrl(storagePath);
  return { url: data.publicUrl, storagePath, bytes: compressed.length };
}
