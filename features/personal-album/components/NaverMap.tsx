"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGeocodeQueryCandidatesForMap,
  hasMapAddress,
  lookupKnownMapCoord,
  resolveGeocodeCoordFromAddresses,
} from "../utils/naverGeocodeUtils";
import { optimizeRoutePlacesForMap, parsePlaceWithAddress, normalizePlaceDedupeKey, sanitizeMapAddress, resolvePlaceForMapGeocode, type MapRouteDaySegment } from "../utils/planUtils";
import { getPlanDayColor, parseMapPlaceKey } from "../utils/planConstants";
import { formatDistanceMeters, formatDurationMs } from "../utils/chapter3Utils";

function stablePlaceKey(place: string): string {
  return normalizePlaceDedupeKey(parsePlaceWithAddress(place).name || place);
}

interface NaverMapProps {
  places: string[];
  selectedPlace?: string | null;
  day?: number;
  height?: number | string;
  /** 여행 목적지 문자열 — geocoding 시 "전주 한옥마을" 등 보조 */
  regionHint?: string;
  /** 선택 해제 — 전체 동선 보기 */
  onClearSelection?: () => void;
  /** 일차별 동선 (색상·구간 분리) */
  routeDaySegments?: MapRouteDaySegment[];
  /** false면 마커만 표시(동선 선 없음). 기본 true */
  drawRoutes?: boolean;
  /** true면 Directions 실패 시 직선 폴백을 그리지 않음 */
  roadRoutesOnly?: boolean;
  /** 일정 segment·목적지 주소 lookup (PDF와 동일) */
  addressLookup?: Map<string, string>;
  /** 수동 주소 저장 — 일정 segment.address에 반영 */
  onSaveManualAddresses?: (entries: { place: string; address: string }[]) => void;
  /** numbered(기본) | red-dot(작은 빨간 원) */
  markerVariant?: "numbered" | "red-dot";
  /** 도로 동선 거리·시간(단계별 포함) 콜백 */
  onRouteMetrics?: (metrics: NaverRouteMetrics | null) => void;
  /** 지도 클릭 시 좌표 (핀 보정용) */
  onMapClick?: (lat: number, lng: number) => void;
  /** true면 클릭 커서 강조 */
  pickMode?: boolean;
}

export type NaverRouteLegMetric = {
  distanceMeters: number;
  durationMs: number;
};

export type NaverRouteMetrics = {
  distanceMeters: number;
  durationMs: number;
  legs: NaverRouteLegMetric[];
  placeNames: string[];
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isRouteEndpoint(name: string): boolean {
  return name.includes("출발") || name.startsWith("집:") || name.includes("도착");
}

function coordNamesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const na = parsePlaceWithAddress(a).name || a;
  const nb = parsePlaceWithAddress(b).name || b;
  return na === nb || a.startsWith(nb) || b.startsWith(na);
}

/** 여행지 클러스터 중심으로 fit — 출발지·도착지가 멀면 제외 */
function pickCoordsForFit(
  coords: { name: string; lat: number; lng: number }[],
): { name: string; lat: number; lng: number }[] {
  if (coords.length <= 1) return coords;

  const travel = coords.filter((c) => !isRouteEndpoint(c.name));
  const pool = travel.length >= 1 ? travel : coords;

  if (pool.length === 1) return pool;

  const centerLat = pool.reduce((s, c) => s + c.lat, 0) / pool.length;
  const centerLng = pool.reduce((s, c) => s + c.lng, 0) / pool.length;
  const clustered = pool.filter((c) => haversineKm(c.lat, c.lng, centerLat, centerLng) < 45);
  const fitPool = clustered.length >= 1 ? clustered : pool;

  const fitCenterLat = fitPool.reduce((s, c) => s + c.lat, 0) / fitPool.length;
  const fitCenterLng = fitPool.reduce((s, c) => s + c.lng, 0) / fitPool.length;
  const nearEndpoints = coords.filter(
    (c) =>
      isRouteEndpoint(c.name) &&
      haversineKm(c.lat, c.lng, fitCenterLat, fitCenterLng) < 25,
  );

  return nearEndpoints.length > 0 ? [...nearEndpoints, ...fitPool] : fitPool;
}

function centroidOfCoords(coords: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (coords.length === 0) return { lat: 36.5, lng: 127.5 };
  return {
    lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
    lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length,
  };
}

function getNaverMapKey(): { key: string; scriptUrl: string } | null {
  const keyId =
    process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID?.trim() ||
    process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?.trim();
  if (!keyId) return null;
  // NCP Maps Application: Client ID → ncpKeyId + oapi.map.naver.com (2024+)
  const params = new URLSearchParams({ ncpKeyId: keyId, submodules: "geocoder" });
  return {
    key: keyId,
    scriptUrl: `https://oapi.map.naver.com/openapi/v3/maps.js?${params.toString()}`,
  };
}

function getNaverSearchUrl(place: string, regionHint?: string, addressLookup?: Map<string, string>): string {
  const hint = hasMapAddress(place) ? undefined : regionHint;
  const queries = buildGeocodeQueryCandidatesForMap(place, hint, addressLookup);
  const query = encodeURIComponent(queries[0] || place);
  return `https://map.naver.com/v5/search/${query}`;
}

export function NaverMap({
  places,
  selectedPlace = null,
  day,
  height = "100%",
  regionHint,
  onClearSelection,
  routeDaySegments,
  drawRoutes = true,
  roadRoutesOnly = false,
  addressLookup,
  onSaveManualAddresses,
  markerVariant = "numbered",
  onRouteMetrics,
  onMapClick,
  pickMode = false,
}: NaverMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<{ setCenter: (c: unknown) => void; setZoom: (z: number) => void } | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const [naverLoaded, setNaverLoaded] = useState(false);
  const [mapAuthFailed, setMapAuthFailed] = useState(false);
  const [mapConfig, setMapConfig] = useState<ReturnType<typeof getNaverMapKey>>(null);
  const [coords, setCoords] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [partialGeocode, setPartialGeocode] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [manualAddresses, setManualAddresses] = useState<Record<string, string>>({});
  const [geocodeAttempt, setGeocodeAttempt] = useState(0);
  const [roadRoutes, setRoadRoutes] = useState<
    { color: string; path: { lat: number; lng: number }[]; usedRoad: boolean }[]
  >([]);
  const [roadRouteStatus, setRoadRouteStatus] = useState<"idle" | "loading" | "ok" | "fallback" | "none">("idle");
  const [routeMetrics, setRouteMetrics] = useState<NaverRouteMetrics | null>(null);
  const onRouteMetricsRef = useRef(onRouteMetrics);
  onRouteMetricsRef.current = onRouteMetrics;
  /** true = fitBounds 자동, false = 줌 고정 */
  const [autoFitZoom, setAutoFitZoom] = useState(true);
  const [lockedZoom, setLockedZoom] = useState(14);

  /** 지도 마커용 — places 전체 (선택 동선과 분리) */
  const markerPlaces = useMemo(() => optimizeRoutePlacesForMap(places), [places]);

  const placeDayMeta = useMemo(() => {
    const meta = new Map<string, { day: number; color: string }>();
    if (routeDaySegments?.length) {
      routeDaySegments.forEach((seg) => {
        seg.places.forEach((p) => meta.set(p, { day: seg.day, color: seg.color }));
      });
    } else if (day && day > 0) {
      const color = getPlanDayColor(day);
      markerPlaces.forEach((p) => meta.set(p, { day, color }));
    }
    return meta;
  }, [routeDaySegments, markerPlaces, day]);
  const placesKey = markerPlaces.map((p) => stablePlaceKey(p)).join("|");

  const effectivePlaces = useMemo(
    () =>
      markerPlaces.map((place) => {
        const key = stablePlaceKey(place);
        const manual = manualAddresses[key]?.trim();
        return resolvePlaceForMapGeocode(place, addressLookup, manual || undefined);
      }),
    [markerPlaces, manualAddresses, addressLookup],
  );

  const lookupKey = addressLookup ? addressLookup.size : 0;
  const geocodeKey = `${effectivePlaces.join("|")}#${lookupKey}#${geocodeAttempt}`;

  useEffect(() => {
    setManualAddresses({});
    setGeocodeAttempt(0);
  }, [placesKey]);

  useEffect(() => {
    setMapConfig(getNaverMapKey());
  }, []);

  useEffect(() => {
    if (!mapConfig) return;

    const win = window as Window & {
      naver?: { maps?: { Service?: unknown } };
      navermap_authFailure?: () => void;
    };

    win.navermap_authFailure = () => {
      setMapAuthFailed(true);
      setNaverLoaded(false);
    };

    if (win.naver?.maps?.Service) {
      setNaverLoaded(true);
      setMapAuthFailed(false);
      return;
    }

    const scriptId = "naver-map-script";
    const expectedSrc = mapConfig.scriptUrl;
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (script && script.src !== expectedSrc) {
      script.remove();
      script = null;
    }
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = expectedSrc;
      script.async = true;
      document.head.appendChild(script);
    }

    const interval = window.setInterval(() => {
      if (win.naver?.maps?.Service) {
        setNaverLoaded(true);
        setMapAuthFailed(false);
        window.clearInterval(interval);
      }
    }, 100);

    const timeout = window.setTimeout(() => window.clearInterval(interval), 15000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [mapConfig]);

  useEffect(() => {
    if (effectivePlaces.length === 0) {
      setCoords([]);
      setGeocodeFailed(true);
      setPartialGeocode(false);
      setIsGeocoding(false);
      return;
    }

    let cancelled = false;
    setCoords([]);
    setIsGeocoding(true);
    setGeocodeFailed(false);
    setPartialGeocode(false);

    const geocodeClientSide = async (): Promise<{ name: string; lat: number; lng: number }[]> => {
      if (!naverLoaded) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const naver = (window as any).naver;

      const geocodeQuery = (query: string): Promise<{ lat: number; lng: number } | null> =>
        new Promise((resolve) => {
          const timer = window.setTimeout(() => resolve(null), 8000);
          naver.maps.Service.geocode(
            { query },
            (status: unknown, response: { v2: { addresses: { x: string; y: string; roadAddress?: string; jibunAddress?: string }[] } }) => {
              window.clearTimeout(timer);
              if (status === naver.maps.Service.Status.OK && response.v2.addresses.length > 0) {
                const coord = resolveGeocodeCoordFromAddresses(query, response.v2.addresses);
                resolve(coord);
              } else {
                resolve(null);
              }
            },
          );
        });

      const results: { name: string; lat: number; lng: number }[] = [];
      for (const place of effectivePlaces) {
        if (cancelled) break;

        const known = lookupKnownMapCoord(place);
        if (known) {
          results.push({ name: place, ...known });
          continue;
        }

        const hint = hasMapAddress(place) ? undefined : regionHint;
        const candidates = buildGeocodeQueryCandidatesForMap(place, hint, addressLookup);
        for (const query of candidates) {
          const preset = lookupKnownMapCoord(query);
          if (preset) {
            results.push({ name: place, ...preset });
            break;
          }
          const coord = await geocodeQuery(query);
          if (coord) {
            if (/파주/.test(query) && coord.lat < 37.5) {
              const fix = lookupKnownMapCoord(query);
              if (fix) {
                results.push({ name: place, ...fix });
                break;
              }
            }
            results.push({ name: place, ...coord });
            break;
          }
        }
      }
      return results;
    };

    const runGeocode = async () => {
      try {
        const response = await fetch("/api/naver-geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ places: effectivePlaces, regionHint }),
        });
        const data = await response.json();

        if (!cancelled && data.ok && Array.isArray(data.coords) && data.coords.length > 0) {
          setCoords(data.coords);
          setGeocodeFailed(false);
          setPartialGeocode(Boolean(data.partial));
          return;
        }

        if (!cancelled && naverLoaded) {
          const clientCoords = await geocodeClientSide();
          if (!cancelled) {
            setCoords(clientCoords);
            setGeocodeFailed(clientCoords.length === 0);
            setPartialGeocode(clientCoords.length > 0 && clientCoords.length < effectivePlaces.length);
          }
          return;
        }

        if (!cancelled && !naverLoaded) {
          const waitForNaver = new Promise<void>((resolve) => {
            const t = window.setInterval(() => {
              const win = window as Window & { naver?: { maps?: { Service?: unknown } } };
              if (win.naver?.maps?.Service) {
                window.clearInterval(t);
                resolve();
              }
            }, 200);
            window.setTimeout(() => {
              window.clearInterval(t);
              resolve();
            }, 12000);
          });
          await waitForNaver;
          if (cancelled) return;
          const clientCoords = await geocodeClientSide();
          if (!cancelled) {
            setCoords(clientCoords);
            setGeocodeFailed(clientCoords.length === 0);
            setPartialGeocode(clientCoords.length > 0 && clientCoords.length < effectivePlaces.length);
          }
        }
      } catch {
        if (!cancelled && naverLoaded) {
          const clientCoords = await geocodeClientSide();
          if (!cancelled) {
            setCoords(clientCoords);
            setGeocodeFailed(clientCoords.length === 0);
            setPartialGeocode(clientCoords.length > 0 && clientCoords.length < effectivePlaces.length);
          }
        } else if (!cancelled) {
          setGeocodeFailed(true);
        }
      } finally {
        if (!cancelled) {
          setIsGeocoding(false);
        }
      }
    };

    runGeocode();

    return () => {
      cancelled = true;
      setIsGeocoding(false);
    };
  }, [naverLoaded, geocodeKey, regionHint, effectivePlaces]);

  const failedPlaces = useMemo(
    () =>
      effectivePlaces.filter(
        (place) => !coords.some((c) => coordNamesMatch(c.name, place)),
      ),
    [effectivePlaces, coords],
  );

  /** 마커 번호 = places 목록 순서 */
  const orderedCoords = useMemo(() => {
    const matched = markerPlaces
      .map((place, routeIndex) => {
        const coord = coords.find((c) => coordNamesMatch(c.name, place));
        return coord ? { ...coord, routeIndex } : null;
      })
      .filter((c): c is { name: string; lat: number; lng: number; routeIndex: number } => Boolean(c));
    if (matched.length > 0) return matched;
    return coords.map((c, routeIndex) => ({ ...c, routeIndex }));
  }, [coords, markerPlaces]);

  const routeFetchKey = useMemo(() => {
    if (!drawRoutes) return "no-route";
    if (routeDaySegments?.length) {
      return routeDaySegments
        .map((seg) =>
          seg.places
            .map((p) => {
              const c = orderedCoords.find((oc) => coordNamesMatch(oc.name, p));
              return c ? `${c.lat.toFixed(5)},${c.lng.toFixed(5)}` : p;
            })
            .join(">"),
        )
        .join("|");
    }
    return orderedCoords.map((c) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`).join(">");
  }, [drawRoutes, routeDaySegments, orderedCoords]);

  useEffect(() => {
    if (!drawRoutes || orderedCoords.length < 2) {
      setRoadRoutes([]);
      setRoadRouteStatus(drawRoutes ? "idle" : "none");
      setRouteMetrics(null);
      onRouteMetricsRef.current?.(null);
      return;
    }

    let cancelled = false;
    setRoadRouteStatus("loading");

    const segments: {
      color: string;
      coords: { lat: number; lng: number }[];
      placeNames: string[];
    }[] = [];
    if (routeDaySegments?.length) {
      routeDaySegments.forEach((seg) => {
        const matched = seg.places
          .map((p) => {
            const c = orderedCoords.find((oc) => coordNamesMatch(oc.name, p));
            return c ? { coord: c, name: p } : null;
          })
          .filter((x): x is { coord: (typeof orderedCoords)[number]; name: string } => Boolean(x));
        if (matched.length >= 2) {
          segments.push({
            color: seg.color,
            coords: matched.map((m) => ({ lat: m.coord.lat, lng: m.coord.lng })),
            placeNames: matched.map((m) => m.name),
          });
        }
      });
    } else {
      segments.push({
        color: getPlanDayColor(day || 0),
        coords: orderedCoords.map((c) => ({ lat: c.lat, lng: c.lng })),
        placeNames: orderedCoords.map((c) => c.name),
      });
    }

    if (segments.length === 0) {
      setRoadRoutes([]);
      setRoadRouteStatus("idle");
      setRouteMetrics(null);
      onRouteMetricsRef.current?.(null);
      return;
    }

    type DirectionsSeg = {
      path: [number, number][];
      usedRoad: boolean;
      distanceMeters?: number;
      durationMs?: number;
      legs?: { distanceMeters: number; durationMs: number }[];
    };

    fetch("/api/naver-directions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: segments.map((s) => ({ coords: s.coords })) }),
    })
      .then(async (res) => res.json())
      .then((data: { ok?: boolean; segments?: DirectionsSeg[] }) => {
        if (cancelled) return;

        if (data.ok && Array.isArray(data.segments)) {
          const mapped = data.segments
            .map((result, i) => ({
              color: segments[i]?.color || "#00c73c",
              path: (result.path || []).map(([lng, lat]) => ({ lat, lng })),
              usedRoad: Boolean(result.usedRoad),
              distanceMeters: Number(result.distanceMeters) || 0,
              durationMs: Number(result.durationMs) || 0,
              legs: Array.isArray(result.legs) ? result.legs : [],
              placeNames: segments[i]?.placeNames || [],
            }))
            .filter((r) => r.usedRoad && r.path.length >= 2);

          setRoadRoutes(mapped);

          const metricSource = mapped;
          if (metricSource.length > 0) {
            const legs: NaverRouteLegMetric[] = [];
            const placeNames: string[] = [];
            let distanceMeters = 0;
            let durationMs = 0;

            metricSource.forEach((seg, segIndex) => {
              if (segIndex === 0) {
                placeNames.push(...seg.placeNames);
              } else if (seg.placeNames.length > 0) {
                placeNames.push(...seg.placeNames.slice(1));
              }
              distanceMeters += seg.distanceMeters;
              durationMs += seg.durationMs;
              if (seg.legs.length > 0) {
                legs.push(...seg.legs);
              } else if (seg.distanceMeters > 0 || seg.durationMs > 0) {
                legs.push({
                  distanceMeters: seg.distanceMeters,
                  durationMs: seg.durationMs,
                });
              }
            });

            const metrics: NaverRouteMetrics = {
              distanceMeters,
              durationMs,
              legs,
              placeNames,
            };
            setRouteMetrics(metrics);
            onRouteMetricsRef.current?.(metrics);
          } else {
            setRouteMetrics(null);
            onRouteMetricsRef.current?.(null);
          }

          setRoadRouteStatus(mapped.length === 0 ? "none" : "ok");
          return;
        }

        setRouteMetrics(null);
        onRouteMetricsRef.current?.(null);
        setRoadRoutes([]);
        setRoadRouteStatus("none");
      })
      .catch(() => {
        if (cancelled) return;
        setRouteMetrics(null);
        onRouteMetricsRef.current?.(null);
        setRoadRoutes([]);
        setRoadRouteStatus("none");
      });

    return () => {
      cancelled = true;
    };
  }, [routeFetchKey, routeDaySegments, orderedCoords, day, drawRoutes, roadRoutesOnly]);

  const routeMetricsHint = useMemo(() => {
    if (!routeMetrics || routeMetrics.distanceMeters <= 0) return "";
    return ` · ${formatDistanceMeters(routeMetrics.distanceMeters)} · ${formatDurationMs(routeMetrics.durationMs)}`;
  }, [routeMetrics]);

  const collectManualAddressEntries = () =>
    failedPlaces
      .map((place) => {
        const key = stablePlaceKey(place);
        const routePlace = markerPlaces.find((p) => stablePlaceKey(p) === key) ?? place;
        const plainPlace = places.find((p) => stablePlaceKey(p) === key);
        let { name, address } = parsePlaceWithAddress(routePlace);
        if (/(?:특별자치도|광역시|특별시)\s/.test(name) && plainPlace) {
          name = parsePlaceWithAddress(plainPlace).name || plainPlace;
        }
        const raw = manualAddresses[key] ?? address;
        return { place: name || plainPlace || key, address: sanitizeMapAddress(raw) };
      })
      .filter((e) => e.address.length > 0);

  const renderManualAddressPanel = (compact?: boolean) => (
    <div className={`naverMapManualPanel${compact ? " compact" : ""}`}>
      <p className="naverMapManualTitle">
        {compact ? "⚠ 주소 확인 불가 — 수동 입력" : "장소명만으로는 좌표를 찾지 못했습니다. 도로명·지번 주소를 입력한 뒤 지도를 표시하세요."}
      </p>
      <ul className="naverMapManualList">
        {failedPlaces.map((place) => {
          const parsed = parsePlaceWithAddress(place);
          const key = stablePlaceKey(place);
          const resolved = resolvePlaceForMapGeocode(place, addressLookup);
          const resolvedParsed = parsePlaceWithAddress(resolved);
          const defaultAddress = sanitizeMapAddress(resolvedParsed.address || parsed.address);
          return (
            <li key={key} className="naverMapManualRow">
              <div className="naverMapManualRowHead">
                <span className="naverMapManualPlaceName">{parsed.name || place}</span>
                <span className="naverMapManualPlaceHint">← 이 장소의 주소</span>
              </div>
              <div className="naverMapManualRowFields">
              <input
                className="naverMapManualAddressInput"
                value={manualAddresses[key] ?? defaultAddress}
                placeholder="도로명/지번 주소 직접 입력"
                onChange={(e) =>
                  setManualAddresses((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
              <a
                href={getNaverSearchUrl(
                  resolvePlaceForMapGeocode(place, addressLookup, manualAddresses[key]),
                  regionHint,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="naverMapManualSearchLink"
                title="네이버 지도에서 주소 확인"
              >
                ↗
              </a>
              </div>
            </li>
          );
        })}
      </ul>
      {onSaveManualAddresses && (
        <p className="naverMapManualSaveHint">
          저장 시 해당 일정 카드의 주소 필드에 반영되며, localStorage·Supabase에 자동 저장됩니다.
        </p>
      )}
      <button
        type="button"
        className="secondaryButton naverMapManualRetryBtn"
        onClick={() => {
          const entries = collectManualAddressEntries();
          if (entries.length > 0) {
            const patch: Record<string, string> = {};
            entries.forEach(({ place, address }) => {
              patch[stablePlaceKey(place)] = address;
            });
            setManualAddresses((prev) => ({ ...prev, ...patch }));
            onSaveManualAddresses?.(entries);
          }
          setGeocodeAttempt((n) => n + 1);
        }}
      >
        주소 저장 후 지도 다시 표시
      </button>
    </div>
  );

  useEffect(() => {
    if (!naverLoaded || !mapRef.current || coords.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const naver = (window as any).naver;

    const selectedParsed = selectedPlace ? parseMapPlaceKey(selectedPlace) : null;
    const selectedName = selectedParsed?.name || selectedPlace || "";
    const selectedCoord = selectedName
      ? orderedCoords.find((c) => coordNamesMatch(c.name, selectedName))
      : undefined;
    const fitTargetsPreview = selectedCoord ? [selectedCoord] : pickCoordsForFit(orderedCoords);
    const previewCenter = centroidOfCoords(selectedCoord ? [selectedCoord] : fitTargetsPreview);
    let centerCoord = new naver.maps.LatLng(previewCenter.lat, previewCenter.lng);
    if (selectedCoord) {
      centerCoord = new naver.maps.LatLng(selectedCoord.lat, selectedCoord.lng);
    }

    const initialZoom = selectedCoord ? 15 : fitTargetsPreview.length === 1 ? 14 : lockedZoom;

    const map = new naver.maps.Map(mapRef.current, {
      center: centerCoord,
      zoom: autoFitZoom ? initialZoom : lockedZoom,
      minZoom: 9,
      maxZoom: 18,
      zoomControl: true,
      mapTypeControl: true,
    });
    mapInstanceRef.current = map;

    const markers: { setMap: (map: null) => void }[] = [];
    const polylines: { setMap: (map: null) => void }[] = [];

    const routesToDraw = !drawRoutes ? [] : roadRoutes.filter((r) => r.usedRoad && r.path.length >= 2);

    orderedCoords.forEach((coord) => {
      const latlng = new naver.maps.LatLng(coord.lat, coord.lng);

      const routePlaceName = markerPlaces[coord.routeIndex] ?? coord.name;
      const meta = placeDayMeta.get(routePlaceName) ?? placeDayMeta.get(coord.name);
      const isSelected = selectedName ? coordNamesMatch(coord.name, selectedName) : false;
      const isDeparture = coord.name.includes("출발") || coord.name.startsWith("집:");
      const isArrival = coord.name.includes("도착");
      const dayColor = meta?.color || getPlanDayColor(day || 0);

      let marker: { setMap: (map: null) => void };
      if (markerVariant === "red-dot") {
        const size = isSelected ? 16 : 12;
        marker = new naver.maps.Marker({
          position: latlng,
          map,
          title: coord.name,
          zIndex: isSelected ? 200 : 100,
          icon: {
            content: `
              <div style="
                width:${size}px;height:${size}px;border-radius:50%;
                background:#ef4444;border:2px solid #fff;
                box-shadow:0 1px 4px rgba(0,0,0,0.45);
              "></div>
            `,
            anchor: new naver.maps.Point(size / 2, size / 2),
          },
        });
      } else {
        const markerColor = isDeparture
          ? "#10b981"
          : isArrival
            ? "#ef4444"
            : isSelected
              ? "#f59e0b"
              : dayColor;
        const label = isDeparture ? "출" : isArrival ? "도" : String(coord.routeIndex + 1);
        marker = new naver.maps.Marker({
          position: latlng,
          map,
          title: coord.name,
          zIndex: isSelected ? 200 : 100,
          icon: {
            content: `
              <div style="
                display:flex;align-items:center;justify-content:center;
                background:${markerColor};color:white;font-size:11px;font-weight:bold;
                border-radius:50%;width:${isSelected ? 28 : 24}px;height:${isSelected ? 28 : 24}px;border:2px solid white;
                box-shadow:0 2px 6px rgba(0,0,0,0.35);
              ">${label}</div>
            `,
            anchor: new naver.maps.Point(isSelected ? 14 : 12, isSelected ? 14 : 12),
          },
        });
      }

      const shortName = coord.name.split(/[-–—~:|·(\[]/)[0].trim();
      const infoWindow = new naver.maps.InfoWindow({
        content: `<div style="padding:8px 10px;min-width:120px;font-size:12px;color:#333;background:white;border-radius:4px;border:1px solid #ccc;"><strong>${shortName}</strong></div>`,
      });

      naver.maps.Event.addListener(marker, "click", () => {
        if (infoWindow.getMap()) {
          infoWindow.close();
        } else {
          infoWindow.open(map, marker);
        }
      });

      markers.push(marker);
    });

    routesToDraw.forEach((seg) => {
      if (seg.path.length < 2) return;
      polylines.push(
        new naver.maps.Polyline({
          path: seg.path.map((p) => new naver.maps.LatLng(p.lat, p.lng)),
          strokeColor: seg.color,
          strokeOpacity: 0.9,
          strokeWeight: 5,
          map,
          zIndex: 50,
        }),
      );
    });

    if (autoFitZoom && orderedCoords.length > 0) {
      const fitTargets = selectedCoord ? [selectedCoord] : pickCoordsForFit(orderedCoords);
      const bounds = new naver.maps.LatLngBounds();
      fitTargets.forEach((c) => {
        bounds.extend(new naver.maps.LatLng(c.lat, c.lng));
      });
      if (fitTargets.length === 1) {
        map.setCenter(new naver.maps.LatLng(fitTargets[0].lat, fitTargets[0].lng));
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, { top: 56, right: 56, bottom: 56, left: 56, maxZoom: 16 });
        window.setTimeout(() => {
          const z = map.getZoom();
          if (typeof z === "number" && z < 11) {
            map.setZoom(11);
          }
        }, 80);
      }
    }

    naver.maps.Event.addListener(map, "zoom_changed", () => {
      if (!autoFitZoom) {
        setLockedZoom(map.getZoom());
      }
    });

    const clickListener = naver.maps.Event.addListener(
      map,
      "click",
      (e: { coord?: { y: number; x: number }; latlng?: { lat: () => number; lng: () => number } }) => {
        if (!onMapClickRef.current) return;
        if (e?.coord && typeof e.coord.y === "number" && typeof e.coord.x === "number") {
          onMapClickRef.current(e.coord.y, e.coord.x);
          return;
        }
        if (e?.latlng) {
          onMapClickRef.current(e.latlng.lat(), e.latlng.lng());
        }
      },
    );

    return () => {
      markers.forEach((m) => m.setMap(null));
      polylines.forEach((p) => p.setMap(null));
      naver.maps.Event.removeListener(clickListener);
      mapInstanceRef.current = null;
    };
  }, [naverLoaded, coords, orderedCoords, selectedPlace, autoFitZoom, lockedZoom, routeDaySegments, placeDayMeta, day, markerPlaces, roadRoutes, drawRoutes, roadRoutesOnly, markerVariant]);

  const containerBaseStyle: React.CSSProperties = {
    width: "100%",
    height,
    minHeight: typeof height === "number" ? height : 240,
    borderRadius: "8px",
  };

  const containerStyle: React.CSSProperties = {
    ...containerBaseStyle,
    overflow: "hidden",
  };

  if (mapAuthFailed) {
    return (
      <div className="naverMapMockBox" style={{ ...containerStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "20px" }}>
        <strong>🗺️ 네이버 지도 인증 실패</strong>
        <p style={{ maxWidth: "90%", margin: "8px auto 0", fontSize: "12px", color: "#cbd5e1", lineHeight: 1.5 }}>
          NCP 콘솔 → Maps → travel-diary → 서비스 URL에 <code style={{ color: "#38bdf8" }}>http://localhost:3000</code> 이 등록되어 있는지 확인한 뒤, 페이지를 새로고침하세요.
        </p>
      </div>
    );
  }

  if (!mapConfig) {
    return (
      <div className="naverMapMockBox" style={{ ...containerStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "20px" }}>
        <strong>🗺️ 네이버 지도 API 연결 필요</strong>
        <p style={{ maxWidth: "90%", margin: "8px auto 0", fontSize: "12px", color: "#cbd5e1", lineHeight: 1.5 }}>
          .env.local에 <code style={{ color: "#38bdf8" }}>NEXT_PUBLIC_NAVER_MAP_CLIENT_ID</code> 또는 <code style={{ color: "#38bdf8" }}>NEXT_PUBLIC_NAVER_MAP_KEY_ID</code>를 설정해 주세요.
        </p>
      </div>
    );
  }

  if (!naverLoaded) {
    return (
      <div style={{ ...containerStyle, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
        네이버 지도 로딩 중...
      </div>
    );
  }

  if (isGeocoding && coords.length === 0) {
    return (
      <div style={{ ...containerStyle, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
        여행지 좌표 확인 중...
      </div>
    );
  }

  if (coords.length === 0 && geocodeFailed) {
    return (
      <div style={{ ...containerBaseStyle, display: "flex", flexDirection: "column", background: "#0f172a", padding: "12px", gap: "8px", overflowX: "hidden", overflowY: "auto" }}>
        {renderManualAddressPanel()}
      </div>
    );
  }

  return (
    <div style={{ ...containerStyle, display: "flex", flexDirection: "column" }}>
      <div className="naverMapToolbar">
        {onClearSelection && selectedPlace && (
          <button type="button" className="naverMapToolBtn" onClick={onClearSelection}>
            🗺️ 전체 동선
          </button>
        )}
        <button
          type="button"
          className={`naverMapToolBtn${autoFitZoom ? " active" : ""}`}
          onClick={() => setAutoFitZoom(true)}
          title="모든 마커가 보이도록 자동 줌"
        >
          📐 자동 맞춤
        </button>
        <button
          type="button"
          className={`naverMapToolBtn${!autoFitZoom ? " active" : ""}`}
          onClick={() => {
            setAutoFitZoom(false);
            if (mapInstanceRef.current) {
              mapInstanceRef.current.setZoom(lockedZoom);
            }
          }}
          title="현재 줌 유지 (± 버튼으로 조절)"
        >
          🔒 줌 고정
        </button>
        {routeDaySegments && routeDaySegments.length > 0 && drawRoutes ? (
          <span className="naverMapToolHint">
            {routeDaySegments.map((s) => `${s.day}일`).join(" · ")} · 선택 구간 · 자동차 도로 동선
            {routeMetricsHint}
            {roadRouteStatus === "loading" ? " · 경로 조회 중…" : ""}
            {roadRouteStatus === "none" ? " · 도로 경로를 찾지 못함" : ""}
            {roadRouteStatus === "ok" ? " · 도로 기준" : ""}
          </span>
        ) : drawRoutes && coords.length >= 2 ? (
          <span className="naverMapToolHint">
            {coords.length}곳 · 자동차 도로 동선 (Directions 5)
            {routeMetricsHint}
            {roadRouteStatus === "loading" ? " · 경로 조회 중…" : ""}
            {roadRouteStatus === "ok" ? " · 도로 기준" : ""}
            {roadRouteStatus === "fallback" ? " · 직선(도로 조회 실패)" : ""}
          </span>
        ) : !drawRoutes ? (
          <span className="naverMapToolHint">마커만 표시 · 2곳 이상 선택 시 도로 동선</span>
        ) : null}
      </div>
      {(partialGeocode || isGeocoding) && (
        <p style={{ margin: 0, padding: "6px 10px", fontSize: "11px", color: "#fbbf24", background: "rgba(251, 191, 36, 0.08)", borderBottom: "1px solid rgba(251, 191, 36, 0.2)" }}>
          {isGeocoding
            ? "좌표를 추가 확인하는 중..."
            : "일부 장소만 지도에 표시됩니다. 아래에서 주소를 직접 입력해 주세요."}
        </p>
      )}
      {partialGeocode && failedPlaces.length > 0 && renderManualAddressPanel(true)}
      <div ref={mapRef} style={{ flex: 1, width: "100%", minHeight: typeof height === "number" ? height - 30 : 210 }} />
    </div>
  );
}
