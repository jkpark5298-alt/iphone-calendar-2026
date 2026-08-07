import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

const isProductionRuntime = () =>
  process.env.VERCEL_ENV === "production" ||
  process.env.NODE_ENV === "production";

export const isPrivateOrLocalHost = (hostname: string) => {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host === "metadata.google.internal") return true;
  if (PRIVATE_IP_PATTERNS.some((re) => re.test(host))) return true;
  return false;
};

export const isSameOriginRequest = (request: NextRequest) => {
  const host = request.headers.get("host") || request.nextUrl.host;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const allowedHosts = new Set(
    [host, request.nextUrl.host, forwardedHost]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase()),
  );

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (allowedHosts.has(new URL(origin).host.toLowerCase())) return true;
    } catch {
      /* ignore */
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (allowedHosts.has(new URL(referer).host.toLowerCase())) return true;
    } catch {
      /* ignore */
    }
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return true;
  }

  return false;
};

/** Browser same-origin or Bearer APP/GENERAL_INFO token */
export const assertAppApiAccess = (request: NextRequest) => {
  const tokens = [
    process.env.APP_API_TOKEN,
    process.env.GENERAL_INFO_API_TOKEN,
  ].filter(Boolean) as string[];

  const authorization = request.headers.get("authorization") || "";
  if (tokens.some((token) => authorization === `Bearer ${token}`)) {
    return null;
  }

  if (isSameOriginRequest(request)) return null;

  return NextResponse.json(
    { ok: false, error: "요청 권한이 없습니다." },
    { status: 401 },
  );
};

export const getServerGeminiApiKey = (request?: NextRequest) => {
  const serverKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const clientKey = request?.headers.get("x-gemini-api-key")?.trim() || "";
  // 서버 키 우선. 클라이언트 키는 same-origin 인증 통과 후에만 사용.
  return serverKey || clientKey;
};

export const assertSafePublicHttpUrl = async (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("유효하지 않은 URL입니다.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http/https URL만 허용됩니다.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("인증 정보가 포함된 URL은 허용되지 않습니다.");
  }

  const hostname = parsed.hostname;
  if (isPrivateOrLocalHost(hostname)) {
    throw new Error("내부/로컬 주소는 가져올 수 없습니다.");
  }

  // Resolve DNS and block private IPs (SSRF via DNS rebinding mitigation)
  if (!isIP(hostname)) {
    try {
      const records = await lookup(hostname, { all: true, verbatim: true });
      for (const record of records) {
        if (isPrivateOrLocalHost(record.address)) {
          throw new Error("내부망으로 해석되는 주소는 허용되지 않습니다.");
        }
      }
    } catch (error) {
      if (error instanceof Error && /내부/.test(error.message)) throw error;
      throw new Error("URL 호스트를 확인할 수 없습니다.");
    }
  }

  return parsed.toString();
};

/** Simple in-memory rate limit (best-effort on serverless) */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export const assertRateLimit = (
  key: string,
  limit: number,
  windowMs: number,
) => {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  current.count += 1;
  if (current.count > limit) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  }
  return null;
};

export const clientIpFromRequest = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";

export const genericApiError = (status = 500) =>
  NextResponse.json(
    { ok: false, error: "요청을 처리하지 못했습니다." },
    { status },
  );

export { isProductionRuntime };
