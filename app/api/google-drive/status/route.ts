import { NextResponse } from "next/server";
import { googleDriveStatus } from "../../../../lib/googleDrive";

export async function GET() {
  try {
    return NextResponse.json(await googleDriveStatus());
  } catch (error) {
    console.error("google drive status failed", error);
    return NextResponse.json({ configured: true, connected: false });
  }
}
