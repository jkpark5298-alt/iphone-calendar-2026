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

function looksLikeCoordinateText(text?: string) {
  if (!text) return false;
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(text.trim());
}

/** 아이폰 사진앱 스타일: "파주시 - 기산리" */
export function formatKoreanPlaceName(
  parts: { city?: string; detail?: string; state?: string },
  displayName?: string
): string {
  const city = normalizePlacePart(parts.city);
  const detail = normalizePlacePart(parts.detail);
  if (city && detail && city !== detail) return `${city} - ${detail}`;
  if (city) return city;
  if (detail) return detail;
  const state = normalizePlacePart(parts.state);
  if (state) return state;
  const fallback = normalizePlacePart(displayName?.split(",")[0]);
  if (fallback && !looksLikeCoordinateText(fallback)) return fallback;
  return "";
}

function formatFromNominatim(address?: NominatimAddress | null, displayName?: string): string {
  if (!address) {
    return formatKoreanPlaceName({}, displayName);
  }
  const city =
    address.city ||
    address.town ||
    address.municipality ||
    address.county ||
    address.city_district;
  const detail =
    address.suburb ||
    address.village ||
    address.hamlet ||
    address.neighbourhood ||
    address.quarter ||
    address.borough ||
    (address.city_district && address.city_district !== city ? address.city_district : "");
  return formatKoreanPlaceName(
    {
      city,
      detail,
      state: address.state || address.province,
    },
    displayName
  );
}

async function reverseWithBigDataCloud(lat: number, lon: number): Promise<string> {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("localityLanguage", "ko");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return "";

  const data = (await response.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
    localityInfo?: {
      administrative?: Array<{ name?: string; adminLevel?: number }>;
    };
  };

  const admin = data.localityInfo?.administrative || [];
  // adminLevel 6 ≈ 시/군, 8+ ≈ 읍/면/동/리
  const cityFromAdmin = admin.find((item) => item.adminLevel === 6)?.name || data.city;
  const detailFromAdmin =
    [...admin].reverse().find((item) => (item.adminLevel || 0) >= 8)?.name || data.locality;

  return formatKoreanPlaceName({
    city: cityFromAdmin,
    detail: detailFromAdmin,
    state: data.principalSubdivision,
  });
}

async function reverseWithNominatim(lat: number, lon: number): Promise<string> {
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
    cache: "no-store",
  });
  if (!response.ok) return "";

  const data = (await response.json()) as {
    display_name?: string;
    address?: NominatimAddress;
  };
  return formatFromNominatim(data.address, data.display_name);
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
    // BigDataCloud가 Vercel/브라우저에서 더 안정적인 경우가 많아 우선 사용
    let place = await reverseWithBigDataCloud(lat, lon);
    let provider = "bigdatacloud";
    if (!place) {
      place = await reverseWithNominatim(lat, lon);
      provider = "nominatim";
    }

    return NextResponse.json({
      place: looksLikeCoordinateText(place) ? "" : place,
      provider,
    });
  } catch (error) {
    console.warn("reverse-geocode failed", error);
    return NextResponse.json({ place: "" }, { status: 200 });
  }
}
