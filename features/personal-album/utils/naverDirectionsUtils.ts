import { getNaverGeocodeCredentials } from "./naverGeocodeUtils";

const DIRECTIONS_ENDPOINT = "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const MAX_WAYPOINTS = 5;

type LngLat = { lng: number; lat: number };

export type DrivingRouteLegMetrics = {
  distanceMeters: number;
  durationMs: number;
};

export type DrivingRouteResult = {
  path: [number, number][];
  distanceMeters: number;
  durationMs: number;
  /** 연속 지점 사이 단계별 거리·시간 (coords.length - 1개) */
  legs: DrivingRouteLegMetrics[];
};

type RouteOptionPayload = {
  path?: [number, number][];
  summary?: {
    distance?: number;
    duration?: number;
  };
};

function extractRouteOption(data: unknown): RouteOptionPayload | null {
  const route = (data as { route?: Record<string, RouteOptionPayload[]> })?.route;
  if (!route) return null;

  for (const key of ["traoptimal", "trafast", "tracomfort"]) {
    const option = route[key]?.[0];
    if (option && Array.isArray(option.path) && option.path.length >= 2) {
      return option;
    }
  }
  return null;
}

async function fetchDrivingSegment(
  start: LngLat,
  goal: LngLat,
  waypoints: LngLat[],
  keyId: string,
  keySecret: string,
): Promise<DrivingRouteResult | null> {
  const params = new URLSearchParams({
    start: `${start.lng},${start.lat}`,
    goal: `${goal.lng},${goal.lat}`,
    option: "traoptimal",
  });

  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map((w) => `${w.lng},${w.lat}`).join("|"));
  }

  const response = await fetch(`${DIRECTIONS_ENDPOINT}?${params.toString()}`, {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": keyId,
      "X-NCP-APIGW-API-KEY": keySecret,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = await response.json();
  const code = (data as { code?: number }).code;
  if (typeof code === "number" && code !== 0) return null;

  const option = extractRouteOption(data);
  if (!option?.path) return null;

  const distanceMeters = Math.max(0, Number(option.summary?.distance) || 0);
  const durationMs = Math.max(0, Number(option.summary?.duration) || 0);

  return {
    path: option.path,
    distanceMeters,
    durationMs,
    legs: [{ distanceMeters, durationMs }],
  };
}

/**
 * Directions 5 — 자동차 도로 경로 + 거리/시간
 * coords가 3곳 이상이면 단계별(연속 구간) 메트릭을 각각 조회해 합산합니다.
 */
export async function fetchDrivingRoutePath(
  coords: LngLat[],
): Promise<DrivingRouteResult | null> {
  if (coords.length < 2) return null;

  const credentials = getNaverGeocodeCredentials();
  if (!credentials) return null;

  // 단계별: A→B, B→C … 각각 조회 (거리·시간 표시용)
  if (coords.length >= 3) {
    const legs: DrivingRouteLegMetrics[] = [];
    const mergedPath: [number, number][] = [];
    let totalDistance = 0;
    let totalDuration = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const leg = await fetchDrivingSegment(
        coords[i],
        coords[i + 1],
        [],
        credentials.keyId,
        credentials.keySecret,
      );
      if (!leg) {
        return mergedPath.length >= 2
          ? {
              path: mergedPath,
              distanceMeters: totalDistance,
              durationMs: totalDuration,
              legs,
            }
          : null;
      }
      legs.push({
        distanceMeters: leg.distanceMeters,
        durationMs: leg.durationMs,
      });
      totalDistance += leg.distanceMeters;
      totalDuration += leg.durationMs;
      if (mergedPath.length > 0) {
        mergedPath.push(...leg.path.slice(1));
      } else {
        mergedPath.push(...leg.path);
      }
    }

    return {
      path: mergedPath,
      distanceMeters: totalDistance,
      durationMs: totalDuration,
      legs,
    };
  }

  // 2곳: 단일 구간 (필요 시 waypoint 청크 — 현재는 2점만)
  const merged: [number, number][] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let startIdx = 0;

  while (startIdx < coords.length - 1) {
    const remaining = coords.length - startIdx;
    const segmentSize = Math.min(remaining, 2 + MAX_WAYPOINTS);
    const endIdx = startIdx + segmentSize - 1;
    const segment = coords.slice(startIdx, endIdx + 1);
    if (segment.length < 2) break;

    const result = await fetchDrivingSegment(
      segment[0],
      segment[segment.length - 1],
      segment.slice(1, -1),
      credentials.keyId,
      credentials.keySecret,
    );

    if (!result) {
      return merged.length >= 2
        ? {
            path: merged,
            distanceMeters: totalDistance,
            durationMs: totalDuration,
            legs: [{ distanceMeters: totalDistance, durationMs: totalDuration }],
          }
        : null;
    }

    totalDistance += result.distanceMeters;
    totalDuration += result.durationMs;

    if (merged.length > 0) {
      merged.push(...result.path.slice(1));
    } else {
      merged.push(...result.path);
    }

    startIdx = endIdx;
  }

  if (merged.length < 2) return null;

  return {
    path: merged,
    distanceMeters: totalDistance,
    durationMs: totalDuration,
    legs: [{ distanceMeters: totalDistance, durationMs: totalDuration }],
  };
}

export function markerPathFallback(coords: LngLat[]): [number, number][] {
  return coords.map((c) => [c.lng, c.lat]);
}
