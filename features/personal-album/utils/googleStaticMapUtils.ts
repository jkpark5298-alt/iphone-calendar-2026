import {
  buildGeocodeQueryCandidatesForMap,
  getStrictAddressQuery,
} from "./naverGeocodeUtils";

export type MapStaticMarker = {
  lat: number;
  lng: number;
  label: string;
  color: string;
};

export function getGoogleMapsApiKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    null
  );
}

/** #ef4444 → 0xef4444ff (Google Static Maps) */
export function toGoogleStaticColor(hex: string): string {
  const cleaned = hex.replace("#", "").trim();
  if (/^0x/i.test(hex)) return hex.replace(/^0x/i, "0x");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `0x${cleaned}ff`;
  if (/^[0-9a-fA-F]{8}$/.test(cleaned)) return `0x${cleaned}`;
  return "0x3b82f6ff";
}

export async function geocodePlaceWithGoogle(
  place: string,
  regionHint?: string,
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;

  const hint = getStrictAddressQuery(place) ? undefined : regionHint;
  const candidates = buildGeocodeQueryCandidatesForMap(place, hint);

  for (const query of candidates) {
    const coord = await geocodeQueryWithGoogle(query, apiKey);
    if (coord) return coord;
  }

  return null;
}

async function geocodeQueryWithGoogle(
  query: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  const isKorean = /[가-힣]/.test(query);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({
    address: query,
    key: apiKey,
    language: isKorean ? "ko" : "en",
    ...(isKorean ? { region: "kr" } : {}),
  }).toString()}`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };

  if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  }

  return null;
}

export async function geocodePlacesWithGoogle(
  places: string[],
  regionHint?: string,
): Promise<Map<string, { lat: number; lng: number }>> {
  const result = new Map<string, { lat: number; lng: number }>();
  for (const place of places) {
    const coord = await geocodePlaceWithGoogle(place, regionHint);
    if (coord) result.set(place, coord);
  }
  return result;
}

/** Google Static Maps → base64 data URL */
export async function fetchGoogleStaticMapDataUrl(
  markers: MapStaticMarker[],
  width = 640,
  height = 400,
): Promise<string | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey || markers.length === 0) return null;

  const w = Math.min(Math.max(width, 100), 640);
  const h = Math.min(Math.max(height, 100), 640);

  const markerParams = markers.slice(0, 20).map((m) => {
    const color = toGoogleStaticColor(m.color);
    const label = m.label.slice(0, 1);
    return `color:${color}|label:${label}|${m.lat},${m.lng}`;
  });

  const pathCoords = markers
    .slice(0, 20)
    .map((m) => `${m.lat},${m.lng}`)
    .join("|");
  const pathColor = toGoogleStaticColor(markers[0]?.color || "#3b82f6");

  const params = new URLSearchParams({
    size: `${w}x${h}`,
    scale: "2",
    maptype: "roadmap",
    format: "png",
    key: apiKey,
  });

  markerParams.forEach((m) => params.append("markers", m));
  if (pathCoords.includes("|")) {
    params.append("path", `color:${pathColor}|weight:4|${pathCoords}`);
  }

  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("image")) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  const mime = contentType.split(";")[0] || "image/png";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function hasGoogleMapsPdfSupport(): boolean {
  return Boolean(getGoogleMapsApiKey());
}

export async function reverseGeocodeWithGoogle(lat: number, lng: number): Promise<string | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;

  const languages = ["ko", "en"];
  for (const language of languages) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: apiKey,
      language,
    }).toString()}`;

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) continue;

    const data = (await response.json()) as {
      status?: string;
      results?: {
        formatted_address?: string;
        address_components?: { long_name?: string; short_name?: string; types?: string[] }[];
      }[];
    };

    if (data.status !== "OK" || !data.results?.length) continue;

    const top = data.results[0];
    const components = top.address_components || [];
    const pick = (...types: string[]) =>
      components.find((c) => (c.types || []).some((t) => types.includes(t)))?.long_name?.trim();

    const pointOfInterest = pick("point_of_interest", "establishment", "premise", "tourist_attraction");
    const route = pick("route");
    const neighborhood = pick("sublocality_level_2", "sublocality_level_1", "neighborhood", "sublocality");
    const locality = pick("locality", "administrative_area_level_2");
    const admin1 = pick("administrative_area_level_1");
    const country = pick("country");

    const shortParts = [pointOfInterest, route || neighborhood, locality || admin1, country].filter(
      Boolean,
    ) as string[];
    const uniqueShort = shortParts.filter((part, idx) => shortParts.indexOf(part) === idx);
    if (uniqueShort.length > 0) return uniqueShort.slice(0, 3).join(", ");

    const address = top.formatted_address?.trim();
    if (address) return address;
  }

  return null;
}
