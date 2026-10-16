"use client";

import { useMemo } from "react";
import type { Chapter3AlbumDay, Chapter3AlbumPlace } from "../utils/chapter3Utils";
import { formatPlaceWithAddress } from "../utils/planUtils";
import { isDomesticPlaceRecord, travelPlaceMapQuery } from "../utils/travelPlacesDb";
import { DAY_MAP_HEIGHT } from "../utils/planConstants";
import { NaverMap } from "./NaverMap";
import { Chapter3DayPhotoLocationMap } from "./Chapter3PhotoAlbumPanel";
import { EmptyState } from "./SharedComponents";

function isAlbumMapPlace(place: Chapter3AlbumPlace): boolean {
  const name = place.name?.trim() ?? "";
  if (!name && !place.address?.trim()) return false;
  if (/^(오전|오후)\s*사진\s*앨범$/.test(name)) return false;
  if (name === "사진 앨범" && !place.address?.trim()) return false;
  return true;
}

function albumPlaceMapQuery(place: Chapter3AlbumPlace): string | null {
  if (!isAlbumMapPlace(place)) return null;
  const query = travelPlaceMapQuery(place);
  return query.trim() || null;
}

function buildGoogleMapSrc(places: string[]): string | null {
  if (places.length === 0) return null;
  if (places.length === 1) {
    return `https://maps.google.com/maps?q=${encodeURIComponent(places[0])}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
  }
  const origin = places[0];
  const dest = places[places.length - 1];
  const waypoints = places.slice(1, places.length - 1);
  const daddrStr =
    encodeURIComponent(dest) +
    waypoints.map((w) => "+to:" + encodeURIComponent(w)).join("");
  return `https://maps.google.com/maps?saddr=${encodeURIComponent(origin)}&daddr=${daddrStr}&dirflg=d&t=&z=14&ie=UTF8&iwloc=&output=embed`;
}

export function Chapter3AlbumDayMap({
  day,
  showPlaceMap = true,
  showPhotoMap = true,
  allowGoogleEmbed = true,
}: {
  day: Chapter3AlbumDay;
  showPlaceMap?: boolean;
  showPhotoMap?: boolean;
  /** 아이폰에서 구글 삽입 지도가 스크롤을 가로채므로 보기 화면에서는 끄고 장소 목록만 보여 줍니다. */
  allowGoogleEmbed?: boolean;
}) {
  const mapPlaces = useMemo(
    () =>
      day.places
        .map(albumPlaceMapQuery)
        .filter((query): query is string => Boolean(query)),
    [day.places],
  );

  const addressLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    day.places.forEach((place) => {
      const address = place.address?.trim();
      const name = place.name?.trim();
      if (!name || !address) return;
      lookup.set(name.toLowerCase().replace(/\s+/g, ""), address);
      lookup.set(formatPlaceWithAddress(name, address).toLowerCase().replace(/\s+/g, ""), address);
    });
    return lookup;
  }, [day.places]);

  const isDomestic = useMemo(() => {
    const candidates = day.places.filter(isAlbumMapPlace);
    if (candidates.length === 0) return true;
    return candidates.every((place) => isDomesticPlaceRecord(place));
  }, [day.places]);

  const dayPhotos = useMemo(() => day.places.flatMap((place) => place.photos), [day.places]);
  const googleMapSrc =
    !isDomestic && allowGoogleEmbed ? buildGoogleMapSrc(mapPlaces) : null;

  if (mapPlaces.length === 0 && dayPhotos.length === 0) {
    return (
      <section className="chapter3AlbumDayMap">
        <h5>🗺️ 일자별 여행 지도</h5>
        <EmptyState icon="📍" text="장소 주소 또는 GPS가 있는 사진을 등록하면 지도에 표시됩니다." />
      </section>
    );
  }

  return (
    <section className="chapter3AlbumDayMap">
      <h5>🗺️ 일자별 여행 지도</h5>
      {showPlaceMap && mapPlaces.length > 0 && (
        <div className="chapter3AlbumDayMapPanel">
          <p className="chapter3Muted chapter3AlbumDayMapNote">
            {isDomestic
              ? "국내: 네이버 지도 · 자동차 도로 경로"
              : allowGoogleEmbed
                ? "해외: 구글 지도 · 자동차 경로"
                : "해외: 장소 목록"}
          </p>
          {isDomestic ? (
            <NaverMap
              places={mapPlaces}
              day={day.day}
              height={DAY_MAP_HEIGHT}
              addressLookup={addressLookup}
              drawRoutes={mapPlaces.length >= 2}
            />
          ) : googleMapSrc ? (
            <iframe
              width="100%"
              height={DAY_MAP_HEIGHT}
              style={{ border: "none", display: "block", borderRadius: 12 }}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              src={googleMapSrc}
              title={`${day.dateLabel || `${day.day}일차`} Google Maps`}
            />
          ) : !isDomestic ? (
            <ul className="chapter3AlbumDayMapPlaceList">
              {mapPlaces.map((place) => (
                <li key={place}>{place}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {showPhotoMap && dayPhotos.length > 0 && (
        <Chapter3DayPhotoLocationMap
          photos={dayPhotos}
          day={day.day}
          title="📍 사진 촬영 위치 지도"
        />
      )}
    </section>
  );
}
