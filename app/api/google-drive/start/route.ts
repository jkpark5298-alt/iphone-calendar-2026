import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertRateLimit, clientIpFromRequest } from "../../../../lib/apiSecurity";
import {
  googleDriveAuthUrl,
  googleDriveConfigured,
  googleDriveRedirectUri,
} from "../../../../lib/googleDrive";

export async function GET(request: NextRequest) {
  const limited = assertRateLimit(`drive-start:${clientIpFromRequest(request)}`, 10, 60_000);
  if (limited) return limited;
  if (!googleDriveConfigured()) {
    return NextResponse.redirect(
      new URL("/?googleDrive=missing&personalAlbum=1", request.url),
    );
  }
  const state = randomBytes(16).toString("hex");
  const redirectUri = googleDriveRedirectUri(request.nextUrl.origin);
  const response = NextResponse.redirect(googleDriveAuthUrl(redirectUri, state));
  response.cookies.set("google_drive_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 600,
  });
  return response;
}
