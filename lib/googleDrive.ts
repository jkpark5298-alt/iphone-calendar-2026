import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PRIVATE_BUCKET = "travel-diary-private";
const TOKEN_PATH = "google-drive-auth.json";
const FOLDER_NAME = "개인 앨범";

export type GoogleDriveAuth = {
  refreshToken: string;
  folderId: string;
  email?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

let accessCache: { token: string; expiresAt: number } | null = null;

export function googleDriveConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

/** OAuth redirect_uri — Vercel 배포 URL과 프로덕션 도메인이 섞이지 않게 고정 */
export function googleDriveRedirectUri(requestOrigin?: string): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "";
  const origin = (configured || requestOrigin || "https://iphone-calendar-2026.vercel.app").replace(
    /\/$/,
    "",
  );
  return `${origin}/api/google-drive/callback`;
}

export function clientId(): string {
  return process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || "";
}

function clientSecret(): string {
  return process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || "";
}

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createClient(url, key);
}

async function ensurePrivateBucket(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.storage.getBucket(PRIVATE_BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(PRIVATE_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function readGoogleDriveAuth(): Promise<GoogleDriveAuth | null> {
  const supabase = serviceClient();
  await ensurePrivateBucket(supabase);
  const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).download(TOKEN_PATH);
  if (error || !data) return null;
  const parsed = JSON.parse(await data.text()) as Partial<GoogleDriveAuth>;
  if (!parsed.refreshToken || !parsed.folderId) return null;
  return {
    refreshToken: parsed.refreshToken,
    folderId: parsed.folderId,
    email: parsed.email,
  };
}

export async function writeGoogleDriveAuth(auth: GoogleDriveAuth): Promise<void> {
  const supabase = serviceClient();
  await ensurePrivateBucket(supabase);
  const body = JSON.stringify(auth);
  const { error } = await supabase.storage.from(PRIVATE_BUCKET).upload(TOKEN_PATH, body, {
    upsert: true,
    contentType: "application/json",
  });
  if (error) throw error;
  accessCache = null;
}

export function googleDriveAuthUrl(redirectUri: string, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleDriveCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  return (await response.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  if (accessCache && accessCache.expiresAt > Date.now() + 30_000) return accessCache.token;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await response.json()) as TokenResponse;
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Drive 토큰을 갱신하지 못했습니다.");
  }
  accessCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return json.access_token;
}

async function driveFetch(accessToken: string, url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(url, { ...init, headers });
}

async function ensureAlbumFolder(accessToken: string, existingId?: string): Promise<string> {
  if (existingId) {
    const found = await driveFetch(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${existingId}?fields=id,trashed`,
    );
    if (found.ok) {
      const body = (await found.json()) as { id?: string; trashed?: boolean };
      if (body.id && !body.trashed) return body.id;
    }
  }
  const query = encodeURIComponent(
    `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const listed = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`,
  );
  if (listed.ok) {
    const body = (await listed.json()) as { files?: { id: string }[] };
    if (body.files?.[0]?.id) return body.files[0].id;
  }
  const created = await driveFetch(accessToken, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = (await created.json()) as { id?: string; error?: { message?: string } };
  if (!created.ok || !folder.id) throw new Error(folder.error?.message || "Drive 폴더를 만들지 못했습니다.");
  return folder.id;
}

export async function connectGoogleDrive(refreshToken: string, email?: string): Promise<GoogleDriveAuth> {
  const accessToken = await refreshAccessToken(refreshToken);
  const existing = await readGoogleDriveAuth().catch(() => null);
  const folderId = await ensureAlbumFolder(accessToken, existing?.folderId);
  const auth = { refreshToken, folderId, email };
  await writeGoogleDriveAuth(auth);
  return auth;
}

export async function googleDriveStatus(): Promise<{ configured: boolean; connected: boolean; email?: string }> {
  if (!googleDriveConfigured()) return { configured: false, connected: false };
  const auth = await readGoogleDriveAuth().catch(() => null);
  return { configured: true, connected: Boolean(auth), email: auth?.email };
}

export function drivePhotoUrl(fileId: string): string {
  return `/api/google-drive/file?id=${encodeURIComponent(fileId)}`;
}

export async function uploadDriveJpeg(
  albumId: string,
  photoId: string,
  bytes: ArrayBuffer,
): Promise<{ fileId: string; fileUrl: string; bytes: number }> {
  const view = new Uint8Array(bytes);
  if (view.length < 4 || view[0] !== 0xff || view[1] !== 0xd8 || view[2] !== 0xff) {
    throw new Error("압축 사진을 열 수 없습니다.");
  }
  const auth = await readGoogleDriveAuth();
  if (!auth) throw new Error("Google Drive가 연결되지 않았습니다.");
  const accessToken = await refreshAccessToken(auth.refreshToken);
  const folderId = await ensureAlbumFolder(accessToken, auth.folderId);
  if (folderId !== auth.folderId) await writeGoogleDriveAuth({ ...auth, folderId });

  const safeAlbum = albumId.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || "album";
  const safePhoto = photoId.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 120) || "photo";
  const metadata = {
    name: `${safeAlbum}-${safePhoto}.jpg`,
    parents: [folderId],
    mimeType: "image/jpeg",
  };
  const boundary = `traveldiary${Date.now()}`;
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const body = new Blob([prefix, view, suffix]);
  const uploaded = await driveFetch(
    accessToken,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size",
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
  );
  const created = (await uploaded.json()) as { id?: string; error?: { message?: string } };
  if (!uploaded.ok || !created.id) throw new Error(created.error?.message || "Drive 업로드에 실패했습니다.");

  const remote = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${created.id}?alt=media`,
  );
  if (!remote.ok) throw new Error("Drive에 올린 압축본을 다시 열지 못했습니다.");
  const remoteBytes = new Uint8Array(await remote.arrayBuffer());
  if (
    remoteBytes.length !== view.length ||
    remoteBytes[0] !== 0xff ||
    remoteBytes[1] !== 0xd8 ||
    remoteBytes[2] !== 0xff
  ) {
    throw new Error("Drive에 올린 압축본이 열리지 않습니다.");
  }
  return { fileId: created.id, fileUrl: drivePhotoUrl(created.id), bytes: remoteBytes.length };
}

export async function downloadDriveFile(fileId: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) throw new Error("잘못된 파일입니다.");
  const auth = await readGoogleDriveAuth();
  if (!auth) throw new Error("Google Drive가 연결되지 않았습니다.");
  const accessToken = await refreshAccessToken(auth.refreshToken);
  const remote = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
  );
  if (!remote.ok) throw new Error("Drive 사진을 받지 못했습니다.");
  return {
    bytes: await remote.arrayBuffer(),
    contentType: remote.headers.get("content-type") || "image/jpeg",
  };
}
