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

/** 임시 접근 토큰. 어떤 연결 정보(refresh token)로 받은 것인지 함께 기억한다. */
let accessCache: { token: string; expiresAt: number; refreshToken: string } | null = null;

/** Google이 연결 자체를 거절함(권한 철회·7일 만료 등). 다시 연결해야 한다. */
export class DriveAuthRevokedError extends Error {
  constructor(message = "Google Drive 연결이 끊겼습니다. 다시 연결해 주세요.") {
    super(message);
    this.name = "DriveAuthRevokedError";
  }
}

/** 이미 연결된 구글 계정과 다른 계정으로 바꾸려는 시도 */
export class DriveOwnerMismatchError extends Error {
  constructor(message = "이미 연결된 Google 계정과 다른 계정입니다.") {
    super(message);
    this.name = "DriveOwnerMismatchError";
  }
}

export type GoogleDriveHealth = {
  configured: boolean;
  /** 연결 정보가 저장되어 있음 */
  connected: boolean;
  /** 지금 실제로 Drive를 쓸 수 있음 (토큰 갱신·계정 확인까지 성공) */
  healthy: boolean;
  reason?: "not-configured" | "not-connected" | "token-revoked" | "network" | "error";
  message?: string;
  email?: string;
  storage?: { usedBytes: number; limitBytes: number };
};

const HEALTH_CACHE_MS = 60_000;
let healthCache: { at: number; value: GoogleDriveHealth } | null = null;

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
  healthCache = null;
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
  // 같은 연결 정보로 받은 토큰일 때만 재사용한다.
  // (이전에는 구분하지 않아서, 다른 계정으로 새로 연결할 때 기존 계정의 토큰이 그대로 쓰여 계정 확인을 통과할 수 있었다.)
  if (accessCache && accessCache.refreshToken === refreshToken && accessCache.expiresAt > Date.now() + 30_000) {
    return accessCache.token;
  }
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
    if (json.error === "invalid_grant") throw new DriveAuthRevokedError();
    throw new Error(json.error_description || json.error || "Drive 토큰을 갱신하지 못했습니다.");
  }
  accessCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    refreshToken,
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

type DriveAbout = { email?: string; usedBytes?: number; limitBytes?: number };

async function driveAbout(accessToken: string): Promise<DriveAbout> {
  const response = await driveFetch(
    accessToken,
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota(limit,usage)",
  );
  if (!response.ok) throw new Error(`Drive 계정 정보를 읽지 못했습니다 (${response.status})`);
  const body = (await response.json()) as {
    user?: { emailAddress?: string };
    storageQuota?: { limit?: string; usage?: string };
  };
  const used = Number(body.storageQuota?.usage);
  const limit = Number(body.storageQuota?.limit);
  return {
    email: body.user?.emailAddress?.toLowerCase(),
    usedBytes: Number.isFinite(used) ? used : undefined,
    limitBytes: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  };
}

/** 허용 계정 목록(선택). Vercel env GOOGLE_DRIVE_ALLOWED_EMAILS="a@gmail.com,b@gmail.com" */
function allowedDriveEmails(): string[] {
  return (process.env.GOOGLE_DRIVE_ALLOWED_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 새로 연결하려는 계정이 허용되는지 확인한다.
 * 1) 허용 목록이 있으면 그 안의 계정만
 * 2) 이미 연결된 계정이 있으면 같은 계정만 (남이 자기 Drive로 바꿔치기하는 것을 막음)
 */
async function assertDriveOwner(newEmail: string | undefined, existing: GoogleDriveAuth | null): Promise<void> {
  const allowed = allowedDriveEmails();
  if (allowed.length > 0) {
    if (!newEmail || !allowed.includes(newEmail)) throw new DriveOwnerMismatchError();
    return;
  }
  if (!existing) return;
  let currentEmail = existing.email?.toLowerCase();
  if (!currentEmail) {
    // 예전 연결에는 계정 정보가 없다. 지금 연결이 살아 있으면 그 계정을 확인한다.
    try {
      currentEmail = (await driveAbout(await refreshAccessToken(existing.refreshToken))).email;
    } catch {
      return; // 기존 연결이 이미 끊겨 있으면 다시 연결할 수 있게 둔다.
    }
  }
  if (currentEmail && newEmail !== currentEmail) throw new DriveOwnerMismatchError();
}

export async function connectGoogleDrive(refreshToken: string): Promise<GoogleDriveAuth> {
  const accessToken = await refreshAccessToken(refreshToken);
  const about = await driveAbout(accessToken);
  const existing = await readGoogleDriveAuth().catch(() => null);
  await assertDriveOwner(about.email, existing);
  const folderId = await ensureAlbumFolder(accessToken, existing?.folderId);
  const auth = { refreshToken, folderId, email: about.email };
  await writeGoogleDriveAuth(auth);
  healthCache = null;
  return auth;
}

/**
 * 연결 상태를 실제로 확인한다 (1분 동안 결과를 재사용).
 * 예전에는 "연결 정보 파일이 있는지"만 봐서, 구글이 연결을 끊어도 계속 「연결됨」으로 보였다.
 */
export async function googleDriveStatus(force = false): Promise<GoogleDriveHealth> {
  if (!googleDriveConfigured()) {
    return { configured: false, connected: false, healthy: false, reason: "not-configured" };
  }
  if (!force && healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) return healthCache.value;

  let value: GoogleDriveHealth;
  const auth = await readGoogleDriveAuth().catch(() => null);
  if (!auth) {
    value = { configured: true, connected: false, healthy: false, reason: "not-connected" };
  } else {
    try {
      const accessToken = await refreshAccessToken(auth.refreshToken);
      const about = await driveAbout(accessToken);
      if (about.email && !auth.email) {
        await writeGoogleDriveAuth({ ...auth, email: about.email }).catch(() => {});
      }
      value = {
        configured: true,
        connected: true,
        healthy: true,
        email: about.email || auth.email,
        storage:
          about.usedBytes !== undefined && about.limitBytes !== undefined
            ? { usedBytes: about.usedBytes, limitBytes: about.limitBytes }
            : undefined,
      };
    } catch (error) {
      const revoked = error instanceof DriveAuthRevokedError;
      value = {
        configured: true,
        connected: true,
        healthy: false,
        reason: revoked ? "token-revoked" : "network",
        message: revoked
          ? "Google이 연결을 끊었습니다. Google Drive를 다시 연결해 주세요."
          : "Google Drive에 일시적으로 접속하지 못했습니다.",
        email: auth.email,
      };
    }
  }
  healthCache = { at: Date.now(), value };
  return value;
}

export function drivePhotoUrl(fileId: string): string {
  return `/api/google-drive/file?id=${encodeURIComponent(fileId)}`;
}

/** 일반정보수집 글처럼 다른 앱도 읽는 자료에 넣을 때는 앱 주소까지 붙인 전체 주소를 쓴다. */
export function driveAbsolutePhotoUrl(fileId: string): string {
  const origin = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://iphone-calendar-2026.vercel.app"
  ).replace(/\/$/, "");
  return `${origin}${drivePhotoUrl(fileId)}`;
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
