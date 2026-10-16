"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Chapter3AlbumPhoto } from "../utils/chapter3Utils";
import { formatDistanceMeters, formatDurationMs } from "../utils/chapter3Utils";
import { photoDisplayUrl } from "../utils/chapter3AlbumSyncUtils";
import { getPhotoExifPlaceName, isDomesticPhotoLocation } from "../utils/exifUtils";
import { sortAlbumPhotos } from "../utils/albumPhotoOrderUtils";

const ROUTE_RED = "#dc2626";
const ROUTE_RED_ACTIVE = "#b91c1c";
const ROUTE_GREEN = "#16a34a";
const MARKER_WIDTH = 88;
const MARKER_HEIGHT = 100;

function getNaverMapKey(): { key: string; scriptUrl: string } | null {
  const keyId =
    process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID?.trim() ||
    process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?.trim();
  if (!keyId) return null;
  const params = new URLSearchParams({ ncpKeyId: keyId, submodules: "geocoder" });
  return {
    key: keyId,
    scriptUrl: `https://oapi.map.naver.com/openapi/v3/maps.js?${params.toString()}`,
  };
}

type LatLng = { lat: number; lng: number };

type NaverMapsApi = {
  maps: {
    Map: new (
      el: HTMLElement,
      opts: { center: unknown; zoom: number },
    ) => {
      setCenter: (c: unknown) => void;
      setZoom: (z: number) => void;
      fitBounds: (b: unknown, padding?: unknown) => void;
      getZoom: () => number;
    };
    LatLng: new (lat: number, lng: number) => unknown;
    LatLngBounds: new () => { extend: (c: unknown) => void };
    Point: new (x: number, y: number) => unknown;
    Marker: new (opts: {
      position: unknown;
      map: unknown;
      icon?: unknown;
      zIndex?: number;
    }) => {
      setMap: (m: unknown) => void;
      setIcon: (icon: unknown) => void;
      setZIndex: (z: number) => void;
    };
    Polyline: new (opts: {
      path: unknown[];
      strokeColor: string;
      strokeOpacity: number;
      strokeWeight: number;
      map: unknown;
      zIndex?: number;
    }) => { setMap: (m: unknown) => void };
    Event: {
      addListener: (target: unknown, event: string, handler: () => void) => void;
      trigger: (target: unknown, event: string) => void;
    };
  };
};

function escapeHtml(text: string | undefined | null): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPhotoRouteMarkerHtml(opts: {
  index: number;
  imageUrl: string;
  address: string;
  active: boolean;
  dimmed?: boolean;
  asButton?: boolean;
  /** 개인 앨범 — 여행 동선 번호 숨김 */
  hideIndex?: boolean;
}): string {
  const addr = escapeHtml(opts.address.slice(0, 36));
  const img = escapeHtml(opts.imageUrl);
  const numBg = opts.active ? ROUTE_RED_ACTIVE : ROUTE_RED;
  const border = opts.active ? "3px solid #38bdf8" : "2px solid #fff";
  const photo = opts.active ? 72 : 52;
  const width = opts.active ? 96 : MARKER_WIDTH;
  const opacity = opts.dimmed ? 0.28 : 1;
  const tag = opts.asButton ? "button" : "div";
  const extraAttrs = opts.asButton ? ' type="button"' : ' role="img"';
  const indexBadge = opts.hideIndex
    ? ""
    : `<span style="margin-top:4px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:${numBg};border:2px solid #fff;color:#fff;font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);">${opts.index}</span>`;
  return `<${tag} aria-label="사진 ${opts.index}"${extraAttrs} style="display:flex;flex-direction:column;align-items:center;width:${width}px;padding:0;margin:0;border:none;background:transparent;cursor:${opts.asButton ? "pointer" : "default"};font-family:inherit;opacity:${opacity};${opts.asButton ? "" : "pointer-events:none;"}">
    <div style="width:${photo}px;height:${photo}px;border-radius:8px;overflow:hidden;border:${border};box-shadow:0 2px 8px rgba(0,0,0,.45);background:#0f172a;">
      <img src="${img}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />
    </div>
    ${indexBadge}
    <span style="margin-top:3px;max-width:${width}px;padding:2px 4px;border-radius:4px;background:rgba(15,23,42,.88);color:#f1f5f9;font-size:9px;line-height:1.25;text-align:center;word-break:keep-all;">${addr}</span>
  </${tag}>`;
}

function getBrowserGoogleMapsKey(): string | null {
  return (
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY?.trim() ||
    null
  );
}

type GoogleMapsRuntime = {
  maps: {
    Map: new (
      el: HTMLElement,
      opts: Record<string, unknown>,
    ) => {
      setCenter: (c: { lat: number; lng: number }) => void;
      setZoom: (z: number) => void;
      fitBounds: (b: unknown, padding?: number) => void;
    };
    LatLng: new (lat: number, lng: number) => unknown;
    LatLngBounds: new () => { extend: (c: { lat: number; lng: number }) => void };
    Polyline: new (opts: Record<string, unknown>) => unknown;
    OverlayView: new () => {
      onAdd: () => void;
      draw: () => void;
      onRemove: () => void;
      setMap: (map: unknown) => void;
      getPanes: () => { overlayMouseTarget: HTMLElement } | null;
      getProjection: () => {
        fromLatLngToDivPixel: (latLng: unknown) => { x: number; y: number } | null;
      } | null;
    };
  };
};

function loadGoogleMapsApi(apiKey: string): Promise<GoogleMapsRuntime> {
  const win = window as Window & {
    google?: GoogleMapsRuntime;
    __iphoneCalGmapsPromise?: Promise<GoogleMapsRuntime>;
  };
  if (win.google?.maps) return Promise.resolve(win.google);
  if (win.__iphoneCalGmapsPromise) return win.__iphoneCalGmapsPromise;

  win.__iphoneCalGmapsPromise = new Promise((resolve, reject) => {
    const callbackName = `__iphoneCalGmapsCb_${Date.now()}`;
    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (win.google?.maps) resolve(win.google);
      else reject(new Error("google maps unavailable"));
    };
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=en&callback=${callbackName}`;
    script.onerror = () => reject(new Error("google maps script failed"));
    document.head.appendChild(script);
  });

  return win.__iphoneCalGmapsPromise;
}

type RoutePoint = {
  id: string;
  index: number;
  lat: number;
  lng: number;
  name: string;
  imageUrl: string;
};

type DrivingLeg = { distanceMeters: number; durationMs: number };

type DrivingRouteState = {
  path: LatLng[];
  usedRoad: boolean;
  distanceMeters: number;
  durationMs: number;
  legs: DrivingLeg[];
  status: "idle" | "loading" | "ok" | "none";
};

const EMPTY_ROUTE: DrivingRouteState = {
  path: [],
  usedRoad: false,
  distanceMeters: 0,
  durationMs: 0,
  legs: [],
  status: "idle",
};

function PhotoRouteDistancePanel({
  points,
  route,
  overlay = false,
}: {
  points: RoutePoint[];
  route: DrivingRouteState;
  overlay?: boolean;
}) {
  if (points.length < 2) return null;
  const hasMetrics = route.distanceMeters > 0 || route.legs.some((leg) => leg.distanceMeters > 0);

  return (
    <div className={`chapter3PhotoRouteDistance${overlay ? " chapter3PhotoRouteDistanceOverlay" : ""}`}>
      <p className="chapter3PhotoRouteDistanceTotal">
        🚗 자동차 이동{" "}
        {hasMetrics ? (
          <>
            총 {formatDistanceMeters(route.distanceMeters)}
            {route.durationMs > 0 ? ` · 약 ${formatDurationMs(route.durationMs)}` : ""}
          </>
        ) : route.status === "none" ? (
          "자동차 도로 경로를 찾지 못했습니다."
        ) : (
          "자동차 도로 경로를 계산하는 중…"
        )}
      </p>
      {!overlay && route.legs.length > 0 && (
        <ol className="chapter3PhotoRouteDistanceLegs">
          {route.legs.map((leg, index) => (
            <li key={`${points[index]?.id || index}-${index}`}>
              {index + 1}→{index + 2} {formatDistanceMeters(leg.distanceMeters)}
              {leg.durationMs > 0 ? ` · ${formatDurationMs(leg.durationMs)}` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function buildRoutePoints(photos: Chapter3AlbumPhoto[]): RoutePoint[] {
  return sortAlbumPhotos(
    photos.filter((p) => typeof p.exifLat === "number" && typeof p.exifLng === "number"),
  ).map((p, index) => ({
    id: p.id,
    index: index + 1,
    lat: p.exifLat!,
    lng: p.exifLng!,
    // 메모가 있으면 마커 라벨에 메모 우선 표시, 없으면 주소·파일명
    name: p.memo?.trim() || getPhotoExifPlaceName(p) || p.fileName || `사진 ${index + 1}`,
    imageUrl: photoDisplayUrl(p),
  }));
}

/** 메모·표시명 변경은 지도 재생성 트리거에서 제외 (선택·메모 입력 시 크래시/점프 방지) */
function routeLayoutKey(photos: Chapter3AlbumPhoto[]): string {
  return buildRoutePoints(photos)
    .map((p) => `${p.id}:${p.lat}:${p.lng}:${p.index}:${p.imageUrl}`)
    .join("|");
}

export function Chapter3PhotoRouteMap({
  photos,
  selectedPhotoId,
  onPhotoSelect,
  height = 380,
  distancePlacement = "below",
  dimOthers = false,
  variant = "route",
}: {
  photos: Chapter3AlbumPhoto[];
  selectedPhotoId?: string | null;
  onPhotoSelect?: (photoId: string) => void;
  previewImageUrl?: string | null;
  selectedNumber?: number;
  height?: number;
  /** 보기 화면에서는 거리 한 줄을 지도 위에 올려 지도가 영역을 채우게 합니다. */
  distancePlacement?: "below" | "overlay";
  /** 선택한 사진 외의 마커를 흐리게 둡니다. */
  dimOthers?: boolean;
  /** route: 여행 동선(번호·경로). places: 개인 앨범 위치만 */
  variant?: "route" | "places";
}) {
  const hideIndex = variant === "places";
  const hideIndexRef = useRef(hideIndex);
  hideIndexRef.current = hideIndex;
  const layoutKey = useMemo(() => routeLayoutKey(photos), [photos]);
  const pointsRef = useRef<RoutePoint[]>([]);
  const points = useMemo(() => {
    const next = buildRoutePoints(photos);
    const prev = pointsRef.current;
    if (
      prev.length === next.length &&
      prev.every(
        (p, i) =>
          p.id === next[i].id &&
          p.lat === next[i].lat &&
          p.lng === next[i].lng &&
          p.index === next[i].index &&
          p.imageUrl === next[i].imageUrl &&
          p.name === next[i].name,
      )
    ) {
      return prev;
    }
    pointsRef.current = next;
    return next;
    // layoutKey가 바뀔 때만 좌표·순서가 달라진 것으로 본다 (메모 변경 제외)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const isDomestic = points.length > 0 && points.every((p) => isDomesticPhotoLocation(p.lat, p.lng));
  const mapRef = useRef<HTMLDivElement>(null);
  const [naverLoaded, setNaverLoaded] = useState(false);
  const [mapConfig, setMapConfig] = useState<ReturnType<typeof getNaverMapKey>>(null);
  const [route, setRoute] = useState<DrivingRouteState>(EMPTY_ROUTE);
  const [osmReady, setOsmReady] = useState(false);
  const roadPath = route.path;
  const selectedPhotoIdRef = useRef(selectedPhotoId);
  selectedPhotoIdRef.current = selectedPhotoId;
  const onPhotoSelectRef = useRef(onPhotoSelect);
  onPhotoSelectRef.current = onPhotoSelect;
  const dimOthersRef = useRef(dimOthers);
  dimOthersRef.current = dimOthers;
  const markerHandlesRef = useRef<Array<{ id: string; apply: (selectedId: string | null) => void }>>(
    [],
  );

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedPhotoId) ?? null,
    [points, selectedPhotoId],
  );

  useEffect(() => {
    if (isDomestic) setMapConfig(getNaverMapKey());
  }, [isDomestic]);

  useEffect(() => {
    if (!isDomestic || !mapConfig) return;
    const win = window as Window & { naver?: NaverMapsApi };
    if (win.naver?.maps) {
      setNaverLoaded(true);
      return;
    }
    const existing = document.querySelector(`script[src="${mapConfig.scriptUrl}"]`);
    if (existing) {
      const onLoad = () => setNaverLoaded(true);
      existing.addEventListener("load", onLoad);
      return () => existing.removeEventListener("load", onLoad);
    }
    const script = document.createElement("script");
    script.src = mapConfig.scriptUrl;
    script.async = true;
    script.onload = () => setNaverLoaded(true);
    document.head.appendChild(script);
  }, [isDomestic, mapConfig]);

  useEffect(() => {
    if (variant === "places" || points.length < 2) {
      setRoute(EMPTY_ROUTE);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const coords = points.map((p) => ({ lat: p.lat, lng: p.lng }));
    setRoute({ ...EMPTY_ROUTE, status: "loading" });

    void (async () => {
      try {
        const res = await fetch("/api/driving-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coords }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          ok?: boolean;
          usedRoad?: boolean;
          path?: [number, number][];
          distanceMeters?: number;
          durationMs?: number;
          legs?: DrivingLeg[];
        };
        if (
          !cancelled &&
          data.ok &&
          data.usedRoad &&
          Array.isArray(data.path) &&
          data.path.length >= 2
        ) {
          setRoute({
            path: data.path.map(([lng, lat]) => ({ lat, lng })),
            usedRoad: true,
            distanceMeters: Number(data.distanceMeters) || 0,
            durationMs: Number(data.durationMs) || 0,
            legs: Array.isArray(data.legs) ? data.legs : [],
            status: "ok",
          });
          return;
        }
      } catch {
        /* keep empty until retry */
      }
      if (!cancelled) {
        setRoute({ ...EMPTY_ROUTE, status: "none" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isDomestic, points, variant]);

  // 해외: Google Maps (영문). 키 없으면 OSM(Leaflet) 폴백
  const googleMapRef = useRef<{
    setCenter: (c: { lat: number; lng: number }) => void;
    setZoom: (z: number) => void;
  } | null>(null);
  const leafletMapRef = useRef<import("leaflet").Map | null>(null);
  const [overseasProvider, setOverseasProvider] = useState<"google" | "osm" | "loading" | "none">(
    "loading",
  );

  useEffect(() => {
    if (isDomestic || !mapRef.current || points.length === 0) return;

    let cancelled = false;
    const container = mapRef.current;
    container.replaceChildren();
    setOverseasProvider("loading");
    setOsmReady(false);
    googleMapRef.current = null;
    leafletMapRef.current = null;
    markerHandlesRef.current = [];

    const googleKey = getBrowserGoogleMapsKey();

    void (async () => {
      if (googleKey) {
        try {
          const g = await loadGoogleMapsApi(googleKey);
          if (cancelled || !mapRef.current) return;
          const maps = g.maps;
          const activeId = selectedPhotoIdRef.current;
          const focus = points.find((p) => p.id === activeId) || points[0];
          const map = new maps.Map(mapRef.current, {
            center: { lat: focus.lat, lng: focus.lng },
            zoom: activeId ? 15 : 13,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
          });
          googleMapRef.current = map;

          const overlays: Array<{
            id: string;
            overlay: { setMap: (map: unknown) => void };
            apply: (selectedId: string | null) => void;
          }> = [];

          points.forEach((point) => {
            const paint = (selectedId: string | null | undefined) => {
              const selectedOnMap =
                selectedId != null && points.some((item) => item.id === selectedId);
              const active = selectedOnMap && point.id === selectedId;
              const dimmed = Boolean(dimOthersRef.current && selectedOnMap && !active);
              const width = active ? 96 : MARKER_WIDTH;
              const heightPx = hideIndexRef.current
                ? active
                  ? 100
                  : MARKER_HEIGHT - 24
                : active
                  ? 128
                  : MARKER_HEIGHT;
              return {
                active,
                width,
                heightPx,
                html: buildPhotoRouteMarkerHtml({
                  index: point.index,
                  imageUrl: point.imageUrl || "",
                  address: point.name || "",
                  active,
                  dimmed,
                  asButton: true,
                  hideIndex: hideIndexRef.current,
                }),
              };
            };

            const first = paint(activeId);
            const div = document.createElement("div");
            div.style.position = "absolute";
            div.style.transform = "translate(-50%, -100%)";
            div.style.cursor = "pointer";
            div.innerHTML = first.html;
            div.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              onPhotoSelectRef.current?.(point.id);
            });

            const overlay = new maps.OverlayView();
            overlay.onAdd = function onAdd() {
              this.getPanes()?.overlayMouseTarget.appendChild(div);
            };
            overlay.draw = function draw() {
              const projection = this.getProjection();
              if (!projection) return;
              const pos = projection.fromLatLngToDivPixel(
                new maps.LatLng(point.lat, point.lng),
              );
              if (!pos) return;
              div.style.left = `${pos.x}px`;
              div.style.top = `${pos.y}px`;
            };
            overlay.onRemove = function onRemove() {
              div.remove();
            };
            overlay.setMap(map);

            overlays.push({
              id: point.id,
              overlay,
              apply: (selectedId) => {
                try {
                  const next = paint(selectedId);
                  div.innerHTML = next.html;
                  div.style.zIndex = next.active ? "1000" : String(100 + point.index);
                } catch (error) {
                  console.warn("google marker update failed", error);
                }
              },
            });
          });

          markerHandlesRef.current = overlays.map(({ id, apply }) => ({ id, apply }));
          overlays.forEach((item) => item.apply(selectedPhotoIdRef.current ?? null));

          if (variant === "route" && route.usedRoad && roadPath.length >= 2) {
            new maps.Polyline({
              path: roadPath.map((p) => ({ lat: p.lat, lng: p.lng })),
              strokeColor: ROUTE_GREEN,
              strokeOpacity: 0.9,
              strokeWeight: 5,
              map,
            });
          }

          if (activeId) {
            const sel = points.find((p) => p.id === activeId);
            if (sel) {
              map.setCenter({ lat: sel.lat, lng: sel.lng });
              map.setZoom(16);
            }
          } else if (points.length === 1) {
            map.setCenter({ lat: points[0].lat, lng: points[0].lng });
            map.setZoom(15);
          } else {
            const bounds = new maps.LatLngBounds();
            points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
            map.fitBounds(bounds, 48);
          }

          if (!cancelled) {
            setOverseasProvider("google");
            setOsmReady(true);
          }

          return () => {
            overlays.forEach((item) => item.overlay.setMap(null));
          };
        } catch (error) {
          console.warn("google maps init failed, fallback to OSM", error);
        }
      }

      // OSM 폴백
      try {
        const leaflet = await import("leaflet");
        if (cancelled || !mapRef.current) return;
        const L = leaflet.default;
        const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true });
        leafletMapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);

        const activeId = selectedPhotoIdRef.current;
        const markerHandles: Array<{ id: string; apply: (selectedId: string | null) => void }> = [];
        points.forEach((point) => {
          const paint = (selectedId: string | null | undefined) => {
            const selectedOnMap =
              selectedId != null && points.some((item) => item.id === selectedId);
            const active = selectedOnMap && point.id === selectedId;
            const dimmed = Boolean(dimOthersRef.current && selectedOnMap && !active);
            const width = active ? 96 : MARKER_WIDTH;
            const heightPx = active ? 128 : MARKER_HEIGHT;
            return {
              active,
              icon: L.divIcon({
                className: "chapter3PhotoRouteLeafletIcon",
                html: buildPhotoRouteMarkerHtml({
                  index: point.index,
                  imageUrl: point.imageUrl || "",
                  address: point.name || "",
                  active,
                  dimmed,
                  hideIndex: hideIndexRef.current,
                }),
                iconSize: [width, heightPx],
                iconAnchor: [width / 2, heightPx],
              }),
            };
          };
          const first = paint(activeId);
          const marker = L.marker([point.lat, point.lng], {
            icon: first.icon,
            zIndexOffset: first.active ? 1000 : point.index * 10,
          }).addTo(map);
          marker.on("click", () => onPhotoSelectRef.current?.(point.id));
          markerHandles.push({
            id: point.id,
            apply: (selectedId) => {
              try {
                const next = paint(selectedId);
                marker.setIcon(next.icon);
                marker.setZIndexOffset(next.active ? 1000 : point.index * 10);
              } catch (error) {
                console.warn("leaflet marker update failed", error);
              }
            },
          });
        });
        markerHandlesRef.current = markerHandles;
        markerHandles.forEach((item) => item.apply(selectedPhotoIdRef.current ?? null));

        const focus = points.find((p) => p.id === activeId) || null;
        if (focus) map.setView([focus.lat, focus.lng], 16, { animate: false });
        else if (points.length === 1) map.setView([points[0].lat, points[0].lng], 15, { animate: false });
        else {
          const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
          map.fitBounds(bounds, { padding: [80, 48], maxZoom: 15 });
        }

        if (!cancelled) {
          setOverseasProvider("osm");
          setOsmReady(true);
        }
      } catch (error) {
        console.warn("overseas map failed", error);
        if (!cancelled) setOverseasProvider("none");
      }
    })();

    return () => {
      cancelled = true;
      setOsmReady(false);
      markerHandlesRef.current = [];
      try {
        googleMapRef.current = null;
      } catch {
        /* ignore */
      }
      try {
        leafletMapRef.current?.remove();
      } catch {
        /* ignore */
      }
      leafletMapRef.current = null;
      if (mapRef.current) mapRef.current.replaceChildren();
    };
  }, [isDomestic, points, roadPath, route.usedRoad, variant]);

  useEffect(() => {
    if (isDomestic || !selectedPoint) return;
    if (googleMapRef.current) {
      googleMapRef.current.setCenter({ lat: selectedPoint.lat, lng: selectedPoint.lng });
      googleMapRef.current.setZoom(16);
      return;
    }
    leafletMapRef.current?.setView([selectedPoint.lat, selectedPoint.lng], 16, { animate: true });
  }, [isDomestic, selectedPoint]);

  const naverMapApiRef = useRef<{
    setCenter: (c: unknown) => void;
    setZoom: (z: number) => void;
  } | null>(null);

  useEffect(() => {
    if (!isDomestic || !naverLoaded || !mapRef.current || points.length === 0) return;

    const naver = (window as Window & { naver?: NaverMapsApi }).naver;
    if (!naver?.maps) return;

    const container = mapRef.current;
    let map: {
      setCenter: (c: unknown) => void;
      setZoom: (z: number) => void;
      fitBounds: (b: unknown, padding?: unknown) => void;
      destroy?: () => void;
    } | null = null;
    let polyline: { setMap: (m: unknown) => void } | null = null;
    let markers: Array<{
      id: string;
      marker: { setMap: (m: unknown) => void; setIcon: (icon: unknown) => void; setZIndex: (z: number) => void };
      apply: (selectedId: string | null) => void;
    }> = [];
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;

    try {
      const activeId = selectedPhotoIdRef.current;
      const focus = points.find((p) => p.id === activeId) || points[0];
      container.replaceChildren();
      map = new naver.maps.Map(container, {
        center: new naver.maps.LatLng(focus.lat, focus.lng),
        zoom: activeId ? 15 : 13,
      });
      naverMapApiRef.current = map;
      const resizeMap = () => {
        try {
          if (map) naver.maps.Event.trigger(map, "resize");
        } catch {
          /* map already destroyed */
        }
      };
      resizeObserver = new ResizeObserver(resizeMap);
      resizeObserver.observe(container);
      resizeFrame = window.requestAnimationFrame(resizeMap);

      markers = points.map((point) => {
        const paint = (selectedId: string | null | undefined) => {
          const selectedOnMap = selectedId != null && points.some((item) => item.id === selectedId);
          const active = selectedOnMap && point.id === selectedId;
          const dimmed = Boolean(dimOthersRef.current && selectedOnMap && !active);
          const width = active ? 96 : MARKER_WIDTH;
          const height = active ? 128 : MARKER_HEIGHT;
          return {
            active,
            icon: {
            content: buildPhotoRouteMarkerHtml({
              index: point.index,
              imageUrl: point.imageUrl || "",
              address: point.name || "",
              active,
              dimmed,
              asButton: true,
              hideIndex: hideIndexRef.current,
            }),
            anchor: new naver.maps.Point(width / 2, height),
          },
          zIndex: active ? 500 : 100 + point.index,
        };
      };
      const first = paint(activeId);
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(point.lat, point.lng),
        map,
        icon: first.icon,
        zIndex: first.zIndex,
      });
      naver.maps.Event.addListener(marker, "click", () => onPhotoSelectRef.current?.(point.id));
      return {
        id: point.id,
        marker,
        apply: (selectedId: string | null) => {
          try {
            const next = paint(selectedId);
            marker.setIcon(next.icon);
            marker.setZIndex(next.zIndex);
          } catch (error) {
            console.warn("naver marker update failed", error);
          }
        },
      };
    });
    markerHandlesRef.current = markers.map(({ id, apply }) => ({ id, apply }));

    const path =
      variant !== "places" && route.usedRoad && roadPath.length >= 2 ? roadPath : [];
    polyline =
      path.length >= 2
        ? new naver.maps.Polyline({
            path: path.map((p) => new naver.maps.LatLng(p.lat, p.lng)),
            strokeColor: ROUTE_GREEN,
            strokeOpacity: 0.9,
            strokeWeight: 5,
            map,
            zIndex: 50,
          })
        : null;

      if (activeId) {
        const sel = points.find((p) => p.id === activeId);
        if (sel) {
          map.setCenter(new naver.maps.LatLng(sel.lat, sel.lng));
          map.setZoom(16);
        }
      } else if (points.length === 1) {
        map.setCenter(new naver.maps.LatLng(points[0].lat, points[0].lng));
        map.setZoom(15);
      } else {
        const bounds = new naver.maps.LatLngBounds();
        points.forEach((p) => bounds.extend(new naver.maps.LatLng(p.lat, p.lng)));
        map.fitBounds(bounds, {
          top: 72,
          right: 40,
          bottom: distancePlacement === "overlay" ? 64 : 40,
          left: 40,
          maxZoom: 14,
        });
      }
    } catch (error) {
      console.warn("naver photo route map failed", error);
      naverMapApiRef.current = null;
      markerHandlesRef.current = [];
    }

    return () => {
      try {
        window.cancelAnimationFrame(resizeFrame);
        resizeObserver?.disconnect();
        naverMapApiRef.current = null;
        markerHandlesRef.current = [];
        markers.forEach((item) => {
          try {
            item.marker.setMap(null);
          } catch {
            /* ignore */
          }
        });
        try {
          polyline?.setMap(null);
        } catch {
          /* ignore */
        }
        try {
          (map as { destroy?: () => void } | null)?.destroy?.();
        } catch {
          /* ignore */
        }
        container.replaceChildren();
      } catch (error) {
        console.warn("naver photo route map cleanup failed", error);
      }
    };
  }, [distancePlacement, isDomestic, naverLoaded, points, roadPath, route.usedRoad, variant]);

  useEffect(() => {
    if (!isDomestic || !selectedPoint || !naverMapApiRef.current) return;
    const naver = (window as Window & { naver?: NaverMapsApi }).naver;
    if (!naver?.maps) return;
    naverMapApiRef.current.setCenter(new naver.maps.LatLng(selectedPoint.lat, selectedPoint.lng));
    naverMapApiRef.current.setZoom(16);
  }, [isDomestic, selectedPoint]);

  useEffect(() => {
    const selectedOnMap =
      selectedPhotoId != null && markerHandlesRef.current.some((item) => item.id === selectedPhotoId);
    const focusId = selectedOnMap ? selectedPhotoId : null;
    try {
      markerHandlesRef.current.forEach((item) => item.apply(focusId));
    } catch (error) {
      console.warn("photo route marker update failed", error);
    }
  }, [selectedPhotoId, dimOthers]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      leafletMapRef.current?.invalidateSize();
      const naver = (window as Window & {
        naver?: { maps?: { Event?: { trigger: (target: unknown, name: string) => void } } };
      }).naver;
      if (naverMapApiRef.current) naver?.maps?.Event?.trigger(naverMapApiRef.current, "resize");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [height]);

  const containerStyle: React.CSSProperties = {
    width: "100%",
    height,
    minHeight: height,
    borderRadius: 8,
    overflow: "hidden",
    background: "#0f172a",
  };

  if (points.length === 0) return null;

  const mapBox = (inner: ReactNode) => (
    <div
      className={`chapter3PhotoRouteWrap${distancePlacement === "overlay" ? " chapter3PhotoRouteWrapFill" : ""}`}
    >
      {inner}
      {variant !== "places" && (
        <PhotoRouteDistancePanel
          points={points}
          route={route}
          overlay={distancePlacement === "overlay"}
        />
      )}
    </div>
  );

  if (!isDomestic) {
    return mapBox(
      <div className="chapter3PhotoRouteOsmShell" style={containerStyle}>
        <div
          ref={mapRef}
          className="chapter3PhotoRouteOsmMap"
          style={{ height, minHeight: height }}
        />
        {!osmReady && (
          <div className="chapter3PhotoRouteOsmLoading">
            {overseasProvider === "none"
              ? "해외 지도를 불러오지 못했습니다."
              : "지도 로딩 중…"}
          </div>
        )}
      </div>,
    );
  }

  if (!mapConfig) {
    return mapBox(
      <div style={{ ...containerStyle, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 13 }}>
        네이버 지도 API 키가 필요합니다.
      </div>,
    );
  }

  if (!naverLoaded) {
    return mapBox(
      <div style={{ ...containerStyle, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 13 }}>
        지도 로딩 중…
      </div>,
    );
  }

  return mapBox(
    <div className="chapter3PhotoRouteNaverShell" style={containerStyle}>
      <div
        ref={mapRef}
        className="chapter3PhotoRouteNaverMap"
        style={{ height, minHeight: height }}
      />
    </div>,
  );
}
