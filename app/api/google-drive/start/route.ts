import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { googleDriveAuthUrl, googleDriveConfigured } from "../../../../lib/googleDrive";

export async function GET(request: NextRequest) {
  if (!googleDriveConfigured()) {
    return NextResponse.redirect(new URL("/?googleDrive=missing", request.url));
  }
  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/google-drive/callback", request.nextUrl.origin).toString();
  const response = NextResponse.redirect(googleDriveAuthUrl(redirectUri, state));
  response.cookies.set("google_drive_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
