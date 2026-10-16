import { NextResponse } from "next/server";

/** 배포된 Drive OAuth env 형태만 확인 (값은 노출하지 않음) */
export async function GET() {
  const id = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() || "";
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || "";
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
  return NextResponse.json({
    hasClientId: Boolean(id),
    clientIdSuffix: id ? id.slice(-24) : null,
    hasSecret: Boolean(secret),
    secretLength: secret.length,
    secretPrefix: secret ? secret.slice(0, 7) : null,
    secretHasWhitespace: /\s/.test(process.env.GOOGLE_DRIVE_CLIENT_SECRET || ""),
    siteUrl: site || null,
  });
}
