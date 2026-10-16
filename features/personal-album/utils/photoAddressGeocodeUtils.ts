import { expandBareKoreanRoadAddress } from "./naverGeocodeUtils";

export type GeocodedPhotoAddress = {
  lat: number;
  lng: number;
  label: string;
};

function firstCoord(
  coords: { lat?: number; lng?: number; name?: string; place?: string }[] | undefined,
  fallbackLabel: string,
): GeocodedPhotoAddress | null {
  const hit = coords?.find((item) => typeof item.lat === "number" && typeof item.lng === "number");
  if (!hit || typeof hit.lat !== "number" || typeof hit.lng !== "number") return null;
  return {
    lat: hit.lat,
    lng: hit.lng,
    label: (hit.name || hit.place || fallbackLabel).trim() || fallbackLabel,
  };
}

async function geocodeViaNaver(
  places: string[],
  regionHint?: string,
): Promise<GeocodedPhotoAddress | null> {
  const res = await fetch("/api/naver-geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ places, regionHint }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    coords?: { lat?: number; lng?: number; name?: string }[];
  };
  return data.ok ? firstCoord(data.coords, places[0]) : null;
}

async function geocodeViaGoogle(
  places: string[],
  regionHint?: string,
): Promise<GeocodedPhotoAddress | null> {
  const res = await fetch("/api/google-geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ places, regionHint }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    coords?: { lat?: number; lng?: number; place?: string }[];
  };
  return data.ok ? firstCoord(data.coords, places[0]) : null;
}

async function geocodeViaPlacesSearch(
  query: string,
  regionHint?: string,
): Promise<GeocodedPhotoAddress | null> {
  const res = await fetch("/api/places-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, regionHint }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    suggestions?: { name?: string; address?: string; lat?: number; lng?: number }[];
  };
  const hit = data.suggestions?.find(
    (item) => typeof item.lat === "number" && typeof item.lng === "number",
  );
  if (!hit || typeof hit.lat !== "number" || typeof hit.lng !== "number") return null;
  return {
    lat: hit.lat,
    lng: hit.lng,
    label: (hit.address || hit.name || query).trim() || query,
  };
}

async function geocodeViaNominatim(query: string): Promise<GeocodedPhotoAddress | null> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "kr",
    addressdetails: "0",
  }).toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "ko",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
  if (!data?.[0]?.lat || !data?.[0]?.lon) return null;
  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    label: (data[0].display_name || query).trim() || query,
  };
}

/** 주소·장소명을 좌표로 변환. 국내는 네이버 → 구글 → Places → OSM 순. */
export async function geocodePhotoAddress(
  query: string,
  regionHint?: string,
): Promise<GeocodedPhotoAddress | null> {
  const q = query.trim();
  if (!q) return null;

  const expanded = expandBareKoreanRoadAddress(q, regionHint);
  const preferred = expanded.filter(
    (candidate) => /(?:읍|면)\s/.test(candidate) || /특별자치도/.test(candidate),
  );
  const candidates = [...new Set([...preferred, q, ...expanded])].slice(0, 6);

  try {
    const hit = await geocodeViaNaver(candidates, regionHint);
    if (hit) return { ...hit, label: q };
  } catch {
    /* continue */
  }

  try {
    const hit = await geocodeViaGoogle(candidates, regionHint);
    if (hit) return { ...hit, label: q };
  } catch {
    /* continue */
  }

  for (const candidate of candidates.slice(0, 4)) {
    try {
      const hit = await geocodeViaPlacesSearch(candidate, regionHint || "제주");
      if (hit) return { ...hit, label: q };
    } catch {
      /* continue */
    }
  }

  for (const candidate of candidates.slice(0, 4)) {
    try {
      const hit = await geocodeViaNominatim(candidate);
      if (hit) return { ...hit, label: q };
    } catch {
      /* continue */
    }
  }

  return null;
}
