import { NextRequest, NextResponse } from "next/server";

type Body = {
  query?: string;
  regionHint?: string;
};

/**
 * 서버측 OSM Nominatim geocode — 브라우저 CORS 우회.
 * Google Maps API 키가 없을 때 해외 좌표 폴백용.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const query = [body.query?.trim(), body.regionHint?.trim()]
      .filter(Boolean)
      .join(", ");

    if (!query) {
      return NextResponse.json({ ok: false, error: "query_required" }, { status: 400 });
    }

    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q: query,
      format: "json",
      limit: "1",
    }).toString()}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "travel-diary/1.0 (overseas place geocode fallback)",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `nominatim_${res.status}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = data?.[0];
    const lat = hit?.lat ? Number(hit.lat) : NaN;
    const lng = hit?.lon ? Number(hit.lon) : NaN;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ ok: false, error: "not_found", query });
    }

    return NextResponse.json({ ok: true, lat, lng, provider: "nominatim" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "server_error",
      },
      { status: 500 },
    );
  }
}
