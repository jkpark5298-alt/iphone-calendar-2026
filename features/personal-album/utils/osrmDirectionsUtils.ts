export type DrivingRouteLeg = {
  distanceMeters: number;
  durationMs: number;
};

export type DrivingRouteResult = {
  path: [number, number][];
  distanceMeters: number;
  durationMs: number;
  legs: DrivingRouteLeg[];
  provider: "naver" | "osrm" | "google";
};

type LatLng = { lat: number; lng: number };

const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";
const SNAP_NEAR_METERS = 25;

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function appendPath(target: [number, number][], next: [number, number][]) {
  if (next.length === 0) return;
  if (target.length === 0) {
    target.push(...next);
    return;
  }
  target.push(...next.slice(1));
}

async function fetchOsrmPair(
  start: LatLng,
  goal: LatLng,
  radius: number,
): Promise<{ path: [number, number][]; distanceMeters: number; durationMs: number } | null> {
  const url = `${OSRM_ENDPOINT}/${start.lng},${start.lat};${goal.lng},${goal.lat}?overview=full&geometries=geojson&radiuses=${radius};${radius}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "travel-diary-driving-route/1.0" },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    code?: string;
    routes?: {
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: [number, number][] };
    }[];
  };
  if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates) return null;
  const path = data.routes[0].geometry.coordinates;
  if (!Array.isArray(path) || path.length < 2) return null;
  return {
    path,
    distanceMeters: Math.max(0, Number(data.routes[0].distance) || 0),
    durationMs: Math.max(0, Math.round((Number(data.routes[0].duration) || 0) * 1000)),
  };
}

/** 연속 지점을 자동차 도로로 이어 OSRM 경로를 만듭니다. */
export async function fetchOsrmDrivingRoute(coords: LatLng[]): Promise<DrivingRouteResult | null> {
  if (coords.length < 2) return null;

  const mergedPath: [number, number][] = [];
  const legs: DrivingRouteLeg[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let gotRoad = false;

  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const goal = coords[i + 1];
    if (haversineMeters(start, goal) < SNAP_NEAR_METERS) {
      legs.push({ distanceMeters: 0, durationMs: 0 });
      continue;
    }

    let pair = await fetchOsrmPair(start, goal, 80);
    if (!pair) pair = await fetchOsrmPair(start, goal, 300);
    if (!pair) {
      legs.push({ distanceMeters: 0, durationMs: 0 });
      continue;
    }

    gotRoad = true;
    appendPath(mergedPath, pair.path);
    legs.push({ distanceMeters: pair.distanceMeters, durationMs: pair.durationMs });
    totalDistance += pair.distanceMeters;
    totalDuration += pair.durationMs;
  }

  if (!gotRoad || mergedPath.length < 2) return null;
  return {
    path: mergedPath,
    distanceMeters: totalDistance,
    durationMs: totalDuration,
    legs,
    provider: "osrm",
  };
}

function decodeGooglePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng / 1e5, lat / 1e5]);
  }

  return points;
}

async function fetchGoogleDrivingRoute(coords: LatLng[]): Promise<DrivingRouteResult | null> {
  const { getGoogleMapsApiKey } = await import("./googleStaticMapUtils");
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey || coords.length < 2) return null;

  const origin = `${coords[0].lat},${coords[0].lng}`;
  const destination = `${coords[coords.length - 1].lat},${coords[coords.length - 1].lng}`;
  const waypoints =
    coords.length > 2
      ? coords
          .slice(1, -1)
          .slice(0, 23)
          .map((c) => `${c.lat},${c.lng}`)
          .join("|")
      : "";

  const params = new URLSearchParams({
    origin,
    destination,
    mode: "driving",
    key: apiKey,
    language: "ko",
  });
  if (waypoints) params.set("waypoints", waypoints);

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;

  const data = (await response.json()) as {
    status?: string;
    routes?: {
      overview_polyline?: { points?: string };
      legs?: { distance?: { value?: number }; duration?: { value?: number } }[];
    }[];
  };
  if (data.status !== "OK" || !data.routes?.[0]) return null;

  const encoded = data.routes[0].overview_polyline?.points;
  const path = encoded ? decodeGooglePolyline(encoded) : [];
  if (path.length < 2) return null;

  const legs = (data.routes[0].legs || []).map((leg) => ({
    distanceMeters: Math.max(0, Number(leg.distance?.value) || 0),
    durationMs: Math.max(0, Math.round((Number(leg.duration?.value) || 0) * 1000)),
  }));

  return {
    path,
    distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
    durationMs: legs.reduce((sum, leg) => sum + leg.durationMs, 0),
    legs,
    provider: "google",
  };
}

/** 네이버(국내) → OSRM 도로 → 구글 자동차 경로 순으로 시도합니다. */
export async function fetchBestDrivingRoute(coords: LatLng[]): Promise<DrivingRouteResult | null> {
  const cleaned = coords.filter((c) => typeof c?.lat === "number" && typeof c?.lng === "number");
  if (cleaned.length < 2) return null;

  try {
    const { fetchDrivingRoutePath } = await import("./naverDirectionsUtils");
    const naver = await fetchDrivingRoutePath(cleaned.map((c) => ({ lng: c.lng, lat: c.lat })));
    if (naver?.path && naver.path.length >= 3) {
      return {
        path: naver.path,
        distanceMeters: naver.distanceMeters,
        durationMs: naver.durationMs,
        legs: naver.legs,
        provider: "naver",
      };
    }
  } catch {
    /* OSRM fallback */
  }

  const osrm = await fetchOsrmDrivingRoute(cleaned);
  if (osrm) return osrm;

  try {
    return await fetchGoogleDrivingRoute(cleaned);
  } catch {
    return null;
  }
}
