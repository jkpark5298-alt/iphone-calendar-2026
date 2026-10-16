import { NextRequest, NextResponse } from "next/server";
import { fetchBestDrivingRoute } from "../../../features/personal-album/utils/osrmDirectionsUtils";

type Body = {
  coords?: { lat?: number; lng?: number }[];
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const coords = (Array.isArray(body.coords) ? body.coords : [])
      .filter(
        (c): c is { lat: number; lng: number } =>
          typeof c?.lat === "number" && typeof c?.lng === "number",
      )
      .slice(0, 40);

    if (coords.length < 2) {
      return NextResponse.json({ ok: false, error: "coords_required" }, { status: 400 });
    }

    const route = await fetchBestDrivingRoute(coords);
    if (route) {
      return NextResponse.json({
        ok: true,
        usedRoad: true,
        provider: route.provider,
        path: route.path,
        distanceMeters: route.distanceMeters,
        durationMs: route.durationMs,
        legs: route.legs,
      });
    }

    return NextResponse.json({
      ok: false,
      usedRoad: false,
      provider: "none",
      path: [],
      distanceMeters: 0,
      durationMs: 0,
      legs: [],
      error: "no_road_route",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "driving_route_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
