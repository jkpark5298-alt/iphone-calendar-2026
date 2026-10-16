import { NextRequest, NextResponse } from "next/server";
import { fetchBestDrivingRoute } from "../../../features/personal-album/utils/osrmDirectionsUtils";

type DirectionsRequest = {
  segments?: { coords?: { lat: number; lng: number }[] }[];
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DirectionsRequest;
    const segments = Array.isArray(body.segments) ? body.segments : [];

    if (segments.length === 0) {
      return NextResponse.json({ ok: false, error: "segments_required" }, { status: 400 });
    }

    const results: {
      path: [number, number][];
      usedRoad: boolean;
      distanceMeters: number;
      durationMs: number;
      legs: { distanceMeters: number; durationMs: number }[];
      provider?: string;
    }[] = [];

    for (const seg of segments) {
      const coords = Array.isArray(seg.coords)
        ? seg.coords.filter((c) => typeof c?.lat === "number" && typeof c?.lng === "number")
        : [];

      if (coords.length < 2) {
        results.push({
          path: [],
          usedRoad: false,
          distanceMeters: 0,
          durationMs: 0,
          legs: [],
        });
        continue;
      }

      const route = await fetchBestDrivingRoute(coords);
      results.push({
        path: route?.path || [],
        usedRoad: Boolean(route?.path && route.path.length >= 2),
        distanceMeters: route?.distanceMeters || 0,
        durationMs: route?.durationMs || 0,
        legs: route?.legs || [],
        provider: route?.provider,
      });
    }

    return NextResponse.json({ ok: true, segments: results });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "directions_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
