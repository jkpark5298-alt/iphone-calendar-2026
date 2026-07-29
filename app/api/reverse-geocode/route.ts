import { NextRequest, NextResponse } from "next/server";

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  city_district?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  hamlet?: string;
  borough?: string;
  state?: string;
  province?: string;
};

function normalizePlacePart(value?: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 아이폰 사진앱 스타일: "파주시 - 기산리" */
export function formatKoreanPlaceName(address?: NominatimAddress | null, displayName?: string): string {
  if (!address) {
    const fallback = normalizePlacePart(displayName?.split(",")[0]);
    return fallback;
  }

  const city = normalizePlacePart(
    address.city ||
      address.town ||
      address.municipality ||
      address.county ||
      address.city_district
  );

  const detailCandidates = [
    address.suburb,
    address.village,
    address.hamlet,
    address.neighbourhood,
    address.quarter,
    address.borough,
  ]
    .map(normalizePlacePart)
    .filter(Boolean)
    .filter((part) => part !== city);

  const detail = detailCandidates[0] || "";

  if (city && detail) return `${city} - ${detail}`;
  if (city) return city;
  if (detail) return detail;

  const state = normalizePlacePart(address.state || address.province);
  if (state) return state;

  return normalizePlacePart(displayName?.split(",")[0]);
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "invalid coordinates" }, { status: 400 });
  }
  if (Math.abs(lat) < 0.00001 && Math.abs(lon) < 0.00001) {
    return NextResponse.json({ place: "" });
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("zoom", "16");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "ko");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "iphone-calendar-2026/1.0 (photobook reverse-geocode)",
      },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return NextResponse.json({ place: "" }, { status: 200 });
    }

    const data = (await response.json()) as {
      display_name?: string;
      address?: NominatimAddress;
    };

    const place = formatKoreanPlaceName(data.address, data.display_name);
    return NextResponse.json({
      place,
      displayName: data.display_name || "",
    });
  } catch (error) {
    console.warn("reverse-geocode failed", error);
    return NextResponse.json({ place: "" }, { status: 200 });
  }
}
