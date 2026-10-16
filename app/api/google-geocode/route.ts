import { NextRequest, NextResponse } from "next/server";
import { geocodePlaceWithGoogle } from "../../../features/personal-album/utils/googleStaticMapUtils";

type Body = {
  places?: string[];
  regionHint?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const places = Array.isArray(body.places)
      ? body.places.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 30)
      : [];
    const regionHint = body.regionHint?.trim() || undefined;

    if (places.length === 0) {
      return NextResponse.json({ ok: false, error: "places required" }, { status: 400 });
    }

    const coords: { place: string; lat: number; lng: number }[] = [];
    for (const place of places) {
      const hit = await geocodePlaceWithGoogle(place, regionHint);
      if (hit) {
        coords.push({ place, lat: hit.lat, lng: hit.lng });
      }
    }

    return NextResponse.json({
      ok: true,
      coords,
      missing: places.filter((p) => !coords.some((c) => c.place === p)),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
