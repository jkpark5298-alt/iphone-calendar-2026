"use client";

/**
 * 개인 앨범 이식용 스텁.
 * 원본 travel-diary 의 여행지 DB(Supabase travel_places_state 동기화)는 가져오지 않는다.
 * useTravelPlacesDb() 는 Provider 없이도 동작하는 "빈 여행지 DB" 를 돌려준다.
 */

import React, { useMemo } from "react";
import type { TravelPlaceRecord } from "../types";
import { newTravelPlaceRecord } from "../utils/travelPlacesDb";

export type TravelPlacesSyncPhase = "idle" | "loading" | "saving" | "ok" | "error" | "local";

type TravelPlacesDbContextValue = {
  places: TravelPlaceRecord[];
  hydrated: boolean;
  syncStatus: string;
  syncPhase: TravelPlacesSyncPhase;
  retrySync: () => void;
  addPlace: () => string;
  updatePlace: (id: string, patch: Partial<TravelPlaceRecord>) => void;
  removePlace: (id: string) => void;
  savePlace: (record: TravelPlaceRecord) => TravelPlaceRecord;
  searchPlaces: (query: string) => TravelPlaceRecord[];
  mergePlaces: (
    incoming: Array<
      Pick<TravelPlaceRecord, "name" | "address" | "country" | "city" | "area" | "category" | "phone">
    >,
  ) => void;
  replaceAll: (places: TravelPlaceRecord[]) => void;
};

const EMPTY_PLACES: TravelPlaceRecord[] = [];

const STUB_VALUE: TravelPlacesDbContextValue = {
  places: EMPTY_PLACES,
  hydrated: true,
  syncStatus: "개인 앨범 — 여행지 DB 미사용",
  syncPhase: "local",
  retrySync: () => {},
  addPlace: () => newTravelPlaceRecord().id,
  updatePlace: () => {},
  removePlace: () => {},
  savePlace: (record) => record,
  searchPlaces: () => EMPTY_PLACES,
  mergePlaces: () => {},
  replaceAll: () => {},
};

export function TravelPlacesDbProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => STUB_VALUE, []);
  void value;
  return <>{children}</>;
}

export function useTravelPlacesDb(): TravelPlacesDbContextValue {
  return STUB_VALUE;
}
