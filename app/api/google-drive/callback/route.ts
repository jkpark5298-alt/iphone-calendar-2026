import { NextRequest, NextResponse } from "next/server";
import {
  connectGoogleDrive,
  exchangeGoogleDriveCode,
  googleDriveRedirectUri,
} from "../../../../lib/googleDrive";

export async function GET(request: NextRequest) {
  const back = (flag: string) =>
    NextResponse.redirect(
      new URL(`/?googleDrive=${encodeURIComponent(flag)}&personalAlbum=1`, request.url),
    );

  const error = request.nextUrl.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "denied" : "error");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("google_drive_oauth_state")?.value;
  if (!code) return back("error");
  if (!state || !savedState || state !== savedState) {
    console.error("google drive callback state mismatch", {
      hasState: Boolean(state),
      hasCookie: Boolean(savedState),
    });
    return back("state");
  }

  const redirectUri = googleDriveRedirectUri(request.nextUrl.origin);
  try {
    const token = await exchangeGoogleDriveCode(code, redirectUri);
    if (token.error) {
      console.error("google drive token exchange failed", token.error, token.error_description);
      return back("token");
    }
    if (!token.refresh_token) {
      console.error("google drive callback missing refresh_token");
      return back("no-refresh");
    }
    await connectGoogleDrive(token.refresh_token);
    const response = back("connected");
    response.cookies.delete("google_drive_oauth_state");
    return response;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("google drive callback failed", message, cause);
    if (/service role|Supabase|bucket|storage/i.test(message)) return back("storage");
    if (/Drive 폴더|folder|drive\.googleapis/i.test(message)) return back("folder");
    return back("error");
  }
}
