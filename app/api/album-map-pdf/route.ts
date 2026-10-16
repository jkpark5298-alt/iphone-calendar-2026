import { NextRequest, NextResponse } from "next/server";
import { isDomesticPhotoLocation } from "../../../features/personal-album/utils/exifUtils";
import { getNaverGeocodeCredentials } from "../../../features/personal-album/utils/naverGeocodeUtils";
import { buildMapCoordMap } from "../../../features/personal-album/utils/mapGeocodeUtils";
import {
  fetchGoogleStaticMapDataUrl,
  geocodePlaceWithGoogle,
  hasGoogleMapsPdfSupport,
  type MapStaticMarker,
} from "../../../features/personal-album/utils/googleStaticMapUtils";
import { fetchNaverDayMapWithRoadRoute } from "../../../features/personal-album/utils/naverStaticMapUtils";
import {
  fetchOsmStaticMapDataUrl,
  geocodeWithNominatim,
} from "../../../features/personal-album/utils/osmStaticMapUtils";
import { getPlanDayColor } from "../../../features/personal-album/utils/planConstants";
import { isDomesticPlaceRecord } from "../../../features/personal-album/utils/travelPlacesDb";
import type {
  PlanMapMarkerOverlay,
  PlanMapRouteOverlay,
} from "../../../features/personal-album/utils/planMapPdfUtils";

export const maxDuration = 60;

type AlbumMapPhoto = {
  id: string;
  lat?: number;
  lng?: number;
};

type AlbumMapPlace = {
  name?: string;
  address?: string;
};

type AlbumMapDay = {
  day: number;
  dateLabel?: string;
  places?: AlbumMapPlace[];
  photos?: AlbumMapPhoto[];
};

type AlbumMapPdfRequest = {
  days?: AlbumMapDay[];
  regionHint?: string;
};

export type AlbumDayMapBlock = {
  day: number;
  kind: "photo" | "place";
  title: string;
  mapDataUrl: string | null;
  mapError?: string;
  routeOverlays?: PlanMapRouteOverlay[];
  markerOverlays?: PlanMapMarkerOverlay[];
  mapWidth?: number;
  mapHeight?: number;
};

function hasGps(photo: AlbumMapPhoto): photo is AlbumMapPhoto & { lat: number; lng: number } {
  return typeof photo.lat === "number" && typeof photo.lng === "number";
}

function placeQuery(place: AlbumMapPlace): string | null {
  const address = place.address?.trim();
  const name = place.name?.trim();
  if (address) return name ? `${name} ${address}` : address;
  if (name && !/사진 앨범$/.test(name) && !/^(오전|오후)\s*사진\s*앨범$/.test(name)) {
    return name;
  }
  return null;
}

function dayIsDomestic(day: AlbumMapDay): boolean {
  const gps = (day.photos || []).filter(hasGps);
  if (gps.length > 0) {
    return gps.every((p) => isDomesticPhotoLocation(p.lat, p.lng));
  }
  const places = (day.places || []).filter((p) => placeQuery(p));
  if (places.length === 0) return true;
  return places.every((p) =>
    isDomesticPlaceRecord({
      name: p.name || "",
      address: p.address || "",
    }),
  );
}

async function geocodePlaceQueries(
  queries: string[],
  domestic: boolean,
  regionHint?: string,
): Promise<Map<string, { lat: number; lng: number }>> {
  if (queries.length === 0) return new Map();
  if (domestic) {
    const credentials = getNaverGeocodeCredentials();
    if (!credentials) return new Map();
    const lookup = new Map<string, string>();
    return buildMapCoordMap(queries, lookup, regionHint, credentials);
  }
  const result = new Map<string, { lat: number; lng: number }>();
  for (const query of queries) {
    const withHint = regionHint ? `${query} ${regionHint}` : query;
    const coord =
      (await geocodePlaceWithGoogle(query, regionHint)) ||
      (await geocodeWithNominatim(withHint)) ||
      (await geocodeWithNominatim(query));
    if (coord) result.set(query, coord);
    // Nominatim rate limit
    await new Promise((r) => setTimeout(r, 200));
  }
  return result;
}

async function buildMapBlock(opts: {
  day: number;
  kind: "photo" | "place";
  title: string;
  markers: MapStaticMarker[];
  domestic: boolean;
  color: string;
}): Promise<AlbumDayMapBlock> {
  const { day, kind, title, markers, domestic, color } = opts;
  if (markers.length === 0) {
    return {
      day,
      kind,
      title,
      mapDataUrl: null,
      mapError: "표시할 위치가 없습니다.",
    };
  }

  if (domestic) {
    if (!getNaverGeocodeCredentials()) {
      // 국내도 키 없으면 OSM으로라도 표시
      const osm = await fetchOsmStaticMapDataUrl(markers, 800, 500);
      return {
        day,
        kind,
        title,
        mapDataUrl: osm,
        mapError: osm ? undefined : "네이버 지도 API 키가 없어 지도를 만들지 못했습니다.",
      };
    }
    const mapResult = await fetchNaverDayMapWithRoadRoute(markers, color);
    if (mapResult.mapDataUrl) {
      return {
        day,
        kind,
        title,
        mapDataUrl: mapResult.mapDataUrl,
        routeOverlays: mapResult.routeOverlays,
        markerOverlays: mapResult.markerOverlays,
        mapWidth: mapResult.mapWidth,
        mapHeight: mapResult.mapHeight,
      };
    }
    const osm = await fetchOsmStaticMapDataUrl(markers, 800, 500);
    return {
      day,
      kind,
      title,
      mapDataUrl: osm,
      mapError: osm ? undefined : "지도 이미지를 만들지 못했습니다.",
    };
  }

  // 해외: Google → 없으면 OSM
  if (hasGoogleMapsPdfSupport()) {
    const mapDataUrl = await fetchGoogleStaticMapDataUrl(markers, 640, 400);
    if (mapDataUrl) {
      return { day, kind, title, mapDataUrl };
    }
  }

  const osm = await fetchOsmStaticMapDataUrl(markers, 800, 500);
  return {
    day,
    kind,
    title,
    mapDataUrl: osm,
    mapError: osm
      ? undefined
      : "해외 지도를 만들지 못했습니다. 네트워크를 확인해 주세요.",
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AlbumMapPdfRequest;
    const days = Array.isArray(body.days) ? body.days : [];
    if (days.length === 0) {
      return NextResponse.json({ ok: false, error: "days_required" }, { status: 400 });
    }

    const regionHint = body.regionHint?.trim() || undefined;
    const maps: AlbumDayMapBlock[] = [];

    for (const day of days) {
      const domestic = dayIsDomestic(day);
      const color = getPlanDayColor(day.day);
      const gpsPhotos = (day.photos || []).filter(hasGps);

      if (gpsPhotos.length > 0) {
        const markers: MapStaticMarker[] = gpsPhotos.map((photo, index) => ({
          lat: photo.lat,
          lng: photo.lng,
          label: String(index + 1),
          color: "#dc2626",
        }));
        maps.push(
          await buildMapBlock({
            day: day.day,
            kind: "photo",
            title: "사진 촬영 위치 지도",
            markers,
            domestic,
            color: "#dc2626",
          }),
        );
      }

      const queries = (day.places || [])
        .map(placeQuery)
        .filter((q): q is string => Boolean(q));
      const uniqueQueries = [...new Set(queries)];
      if (uniqueQueries.length > 0) {
        const coordMap = await geocodePlaceQueries(uniqueQueries, domestic, regionHint);
        const markers: MapStaticMarker[] = uniqueQueries
          .map((query, index) => {
            const coord = coordMap.get(query);
            if (!coord) return null;
            return {
              lat: coord.lat,
              lng: coord.lng,
              label: String(index + 1),
              color,
            };
          })
          .filter((m): m is MapStaticMarker => Boolean(m));

        maps.push(
          await buildMapBlock({
            day: day.day,
            kind: "place",
            title: "일자별 여행 지도",
            markers,
            domestic,
            color,
          }),
        );
      }
    }

    return NextResponse.json({ ok: true, maps });
  } catch (error) {
    console.error("album-map-pdf failed", error);
    return NextResponse.json(
      { ok: false, error: "album_map_pdf_failed", hint: String(error) },
      { status: 500 },
    );
  }
}
