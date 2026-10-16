import { NextRequest, NextResponse } from "next/server";

import {
  getNaverGeocodeCredentials,
  isKoreaCoordinates,
  reverseGeocodeWithNaver,
} from "../../../features/personal-album/utils/naverGeocodeUtils";

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
function formatKoreanPlaceName(
  parts: { city?: string; detail?: string; state?: string },
  displayName?: string,
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
    displayName,
  );
}

function formatFromNaverFullAddress(full: string): string {
  const parts = full.split(/\s+/).filter(Boolean);
  // "경기도 파주시 운정2동 …" → "파주시 - 운정2동"
  if (parts.length >= 3 && /[시도]$/.test(parts[0]) && /[시군구]$/.test(parts[1])) {
    return formatKoreanPlaceName({ state: parts[0], city: parts[1], detail: parts[2] });
  }
  if (parts.length >= 2 && /[시군구]$/.test(parts[0])) {
    return formatKoreanPlaceName({ city: parts[0], detail: parts[1] });
  }
  return full;
}

async function reverseWithNaver(lat: number, lon: number): Promise<string> {
  const credentials = getNaverGeocodeCredentials();
  if (!credentials || !isKoreaCoordinates(lat, lon)) return "";
  const full = await reverseGeocodeWithNaver(
    lat,
    lon,
    credentials.keyId,
    credentials.keySecret,
  );
  if (!full?.trim()) return "";
  return formatFromNaverFullAddress(full.trim());
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

async function resolvePlaceName(lat: number, lon: number, preferDomestic: boolean) {
  let place = "";
  let provider = "";

  if (preferDomestic || isKoreaCoordinates(lat, lon)) {
    place = await reverseWithNaver(lat, lon);
    if (place) provider = "naver";
  }

  if (!place) {
    place = await reverseWithBigDataCloud(lat, lon);
    if (place) provider = "bigdatacloud";
  }

  if (!place) {
    place = await reverseWithNominatim(lat, lon);
    if (place) provider = "nominatim";
  }

  if (looksLikeCoordinateText(place)) {
    place = "";
    provider = "";
  }

  return { place, provider };
}

function parseCoords(input: { lat?: unknown; lon?: unknown; lng?: unknown }) {
  const lat = Number(input.lat);
  const lon = Number(input.lon ?? input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) < 0.00001 && Math.abs(lon) < 0.00001) return null;
  return { lat, lon };
}

function placeResponse(place: string, provider: string) {
  return NextResponse.json({
    ok: Boolean(place),
    place,
    placeName: place,
    provider: provider || undefined,
  });
}

export async function GET(request: NextRequest) {
  const coords = parseCoords({
    lat: request.nextUrl.searchParams.get("lat"),
    lon: request.nextUrl.searchParams.get("lon"),
    lng: request.nextUrl.searchParams.get("lng"),
  });
  if (!coords) {
    return NextResponse.json({ ok: false, error: "invalid coordinates", place: "", placeName: "" }, { status: 400 });
  }

  try {
    const domesticHint = request.nextUrl.searchParams.get("isDomestic");
    const preferDomestic =
      domesticHint === "1" ||
      domesticHint === "true" ||
      isKoreaCoordinates(coords.lat, coords.lon);
    const result = await resolvePlaceName(coords.lat, coords.lon, preferDomestic);
    return placeResponse(result.place, result.provider);
  } catch (error) {
    console.warn("reverse-geocode GET failed", error);
    return placeResponse("", "");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      lat?: unknown;
      lng?: unknown;
      lon?: unknown;
      isDomestic?: unknown;
    };
    const coords = parseCoords(body);
    if (!coords) {
      return NextResponse.json(
        { ok: false, error: "invalid coordinates", place: "", placeName: "" },
        { status: 400 },
      );
    }

    const preferDomestic =
      body.isDomestic === true ||
      body.isDomestic === "true" ||
      isKoreaCoordinates(coords.lat, coords.lon);
    const result = await resolvePlaceName(coords.lat, coords.lon, preferDomestic);
    return placeResponse(result.place, result.provider);
  } catch (error) {
    console.warn("reverse-geocode POST failed", error);
    return placeResponse("", "");
  }
}
