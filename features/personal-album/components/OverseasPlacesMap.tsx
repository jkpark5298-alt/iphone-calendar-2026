"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type OverseasMapPlace = {
  id: string;
  label: string;
  query: string;
  address?: string;
  lat?: number;
  lng?: number;
};

type OverseasPlacesMapProps = {
  places: OverseasMapPlace[];
  height?: number | string;
  regionHint?: string;
  selectedId?: string | null;
  onMapClick?: (lat: number, lng: number) => void;
  pickMode?: boolean;
};

type GeoPoint = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

function buildRedPinHtml(label: string, active: boolean): string {
  const size = active ? 28 : 24;
  const safe = label.replace(/[<>&"]/g, "");
  return `
    <div title="${safe}" style="position:relative;width:${size}px;height:${size + 8}px;">
      <div style="
        width:${size}px;height:${size}px;
        background:#ea4335;
        border:2px solid #fff;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        box-shadow:0 2px 6px rgba(0,0,0,0.4);
      "></div>
      <div style="
        position:absolute;left:50%;top:42%;
        transform:translate(-50%,-50%) rotate(0deg);
        width:8px;height:8px;border-radius:50%;background:#fff;
      "></div>
    </div>
  `;
}

function guessDefaultCenter(regionHint?: string): { lat: number; lng: number; zoom: number } {
  const hint = (regionHint || "").toLowerCase();
  if (/일본|japan|tokyo|도쿄|오사카|osaka|kyoto|京都/i.test(hint)) {
    return { lat: 35.68, lng: 139.76, zoom: 11 };
  }
  if (/중국|china|beijing|상해|shanghai/i.test(hint)) {
    return { lat: 39.9, lng: 116.4, zoom: 10 };
  }
  if (/미국|usa|america|new york|los angeles/i.test(hint)) {
    return { lat: 40.71, lng: -74.0, zoom: 10 };
  }
  if (/유럽|europe|paris|london|rome/i.test(hint)) {
    return { lat: 48.86, lng: 2.35, zoom: 10 };
  }
  return { lat: 20, lng: 0, zoom: 2 };
}

async function geocodeViaServer(
  query: string,
  regionHint?: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch("/api/osm-geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, regionHint }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      lat?: number;
      lng?: number;
    };
    if (data.ok && typeof data.lat === "number" && typeof data.lng === "number") {
      return { lat: data.lat, lng: data.lng };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function OverseasPlacesMap({
  places,
  height = 480,
  regionHint,
  selectedId = null,
  onMapClick,
  pickMode = false,
}: OverseasPlacesMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [roadPath, setRoadPath] = useState<[number, number][]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  const placesKey = useMemo(
    () =>
      places
        .map(
          (p) =>
            `${p.id}|${p.query}|${p.address || ""}|${p.lat ?? ""}|${p.lng ?? ""}`,
        )
        .join("||"),
    [places],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (places.length === 0) {
        setPoints([]);
        setStatus(pickMode ? "ready" : "empty");
        setErrorText(pickMode ? "지도를 클릭해 핀을 지정하세요." : "");
        return;
      }

      setStatus("loading");
      setErrorText("");

      const queries = places.map((p) => p.address?.trim() || p.query);
      let googleCoords: { place: string; lat: number; lng: number }[] = [];

      try {
        const res = await fetch("/api/google-geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ places: queries, regionHint }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          coords?: { place: string; lat: number; lng: number }[];
        };
        if (data.ok && Array.isArray(data.coords)) {
          googleCoords = data.coords;
        }
      } catch {
        // OSM fallback below
      }

      const next: GeoPoint[] = [];
      for (let i = 0; i < places.length; i += 1) {
        const place = places[i];
        if (typeof place.lat === "number" && typeof place.lng === "number") {
          next.push({
            id: place.id,
            label: place.label,
            lat: place.lat,
            lng: place.lng,
          });
          continue;
        }
        const query = queries[i];
        const fromGoogle = googleCoords.find((c) => c.place === query);
        if (fromGoogle) {
          next.push({
            id: place.id,
            label: place.label,
            lat: fromGoogle.lat,
            lng: fromGoogle.lng,
          });
          continue;
        }

        const fromOsm = await geocodeViaServer(query, regionHint);
        if (fromOsm) {
          next.push({
            id: place.id,
            label: place.label,
            lat: fromOsm.lat,
            lng: fromOsm.lng,
          });
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      if (cancelled) return;
      setPoints(next);
      setRoadPath([]);
      if (next.length > 0) {
        setStatus("ready");
        setErrorText("");
      } else if (pickMode) {
        setStatus("ready");
        setErrorText("자동 좌표를 못 찾았습니다. 지도를 클릭해 핀을 직접 지정하세요.");
      } else {
        setStatus("empty");
        setErrorText(
          "해외 좌표를 찾지 못했습니다. 주소를 확인하거나 Google Maps API 키를 설정해 주세요.",
        );
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [places, placesKey, regionHint, pickMode]);

  useEffect(() => {
    if (points.length < 2) {
      setRoadPath([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/driving-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coords: points.map((p) => ({ lat: p.lat, lng: p.lng })),
          }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          ok?: boolean;
          usedRoad?: boolean;
          path?: [number, number][];
        };
        if (
          !cancelled &&
          data.ok &&
          data.usedRoad &&
          Array.isArray(data.path) &&
          data.path.length >= 2
        ) {
          setRoadPath(data.path.map(([lng, lat]) => [lat, lng] as [number, number]));
          return;
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setRoadPath([]);
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [points]);

  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    if (points.length === 0 && !pickMode) return;

    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    void (async () => {
      const leaflet = await import("leaflet");
      if (cancelled || !mapRef.current) return;
      const L = leaflet.default;

      map = L.map(mapRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const markers = points.map((point) => {
        const active = point.id === selectedId;
        const icon = L.divIcon({
          className: "overseasPlacesMapPin",
          html: buildRedPinHtml(point.label, active),
          iconSize: [active ? 28 : 24, active ? 36 : 32],
          iconAnchor: [active ? 14 : 12, active ? 36 : 32],
        });
        return L.marker([point.lat, point.lng], {
          icon,
          title: point.label,
          zIndexOffset: active ? 1000 : 100,
        })
          .bindPopup(`<strong>${point.label}</strong>`)
          .addTo(map!);
      });

      if (roadPath.length >= 2) {
        L.polyline(roadPath, {
          color: "#16a34a",
          weight: 5,
          opacity: 0.9,
        }).addTo(map);
      }

      const selected = selectedId ? points.find((p) => p.id === selectedId) : null;
      if (selected) {
        map.setView([selected.lat, selected.lng], 13, { animate: false });
      } else if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 13, { animate: false });
      } else if (points.length > 1) {
        const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
      } else {
        const fallback = guessDefaultCenter(regionHint);
        map.setView([fallback.lat, fallback.lng], fallback.zoom, { animate: false });
      }

      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
      });

      return () => {
        markers.forEach((m) => m.remove());
      };
    })();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
        map = null;
      }
    };
  }, [status, points, selectedId, roadPath, pickMode, regionHint]);

  const minHeight = typeof height === "number" ? height : 320;
  const showBanner =
    status === "loading" || Boolean(errorText) || status === "empty" || status === "error";

  return (
    <div
      className={`overseasPlacesMapWrap${pickMode ? " pickMode" : ""}`}
      style={{ height, minHeight, cursor: pickMode ? "crosshair" : undefined }}
    >
      {showBanner && (
        <div className="overseasPlacesMapStatus">
          {status === "loading"
            ? "해외 지도 좌표를 찾는 중…"
            : errorText || "표시할 해외 여행지가 없습니다."}
        </div>
      )}
      <div
        ref={mapRef}
        className="overseasPlacesMapCanvas"
        style={{
          width: "100%",
          height: "100%",
          minHeight,
          opacity: status === "ready" ? 1 : 0.35,
        }}
      />
    </div>
  );
}
