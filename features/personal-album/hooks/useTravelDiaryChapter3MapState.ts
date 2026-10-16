import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdditionalTravelInfo, DayPlan } from "../types";
import {
  createDefaultSimMap,
  importDayPlansToSimMap,
  isSimMapDomestic,
  newSimPlace,
  newTravelPlaceEntry,
  normalizeSimMapConfig,
  type Chapter3PlaceKind,
  type Chapter3SimMapConfig,
  type Chapter3SimPlace,
  type Chapter3TravelPlaceEntry,
} from "../utils/chapter3Utils";
import { readChapter3SimMap, writeChapter3SimMap } from "../utils/chapter3Storage";
import { parsePlaceWithAddress, sanitizeMapAddress } from "../utils/planUtils";

export interface UseTravelDiaryChapter3MapStateProps {
  showPasteHint: (msg: string) => void;
}

export function useTravelDiaryChapter3MapState({ showPasteHint }: UseTravelDiaryChapter3MapStateProps) {
  const [config, setConfig] = useState<Chapter3SimMapConfig>(createDefaultSimMap);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = readChapter3SimMap();
    if (saved) setConfig(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeChapter3SimMap(config);
  }, [config, hydrated]);

  const isDomestic = useMemo(() => isSimMapDomestic(config), [config]);

  const updateConfigField = useCallback((field: "regionHint" | "departure", value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setMapRegion = useCallback((mapRegion: "domestic" | "overseas") => {
    setConfig((prev) => ({ ...prev, mapRegion }));
  }, []);

  const addDay = useCallback(() => {
    setConfig((prev) => {
      const nextDay = prev.days.length > 0 ? Math.max(...prev.days.map((d) => d.day)) + 1 : 1;
      return {
        ...prev,
        days: [...prev.days, { day: nextDay, dateLabel: `${nextDay}일차`, places: [] }],
      };
    });
  }, []);

  const removeDay = useCallback((day: number) => {
    setConfig((prev) => {
      if (prev.days.length <= 1) {
        showPasteHint("⚠️ 최소 1일차는 유지해야 합니다.");
        return prev;
      }
      const next = prev.days.filter((d) => d.day !== day);
      return { ...prev, days: next };
    });
  }, [showPasteHint]);

  const updateDayLabel = useCallback((day: number, dateLabel: string) => {
    setConfig((prev) => ({
      ...prev,
      days: prev.days.map((d) => (d.day === day ? { ...d, dateLabel } : d)),
    }));
  }, []);

  const addPlace = useCallback((day: number, kind: Chapter3PlaceKind = "destination") => {
    setConfig((prev) => ({
      ...prev,
      days: prev.days.map((d) =>
        d.day !== day ? d : { ...d, places: [...d.places, newSimPlace(kind)] },
      ),
    }));
  }, []);

  /** 주소록(DB)에서 선택한 장소를 일차에 추가 (복수 가능) */
  const addFilledPlace = useCallback(
    (
      day: number,
      kind: Chapter3PlaceKind,
      patch: Pick<Chapter3SimPlace, "name" | "address"> & Partial<Chapter3SimPlace>,
    ) => {
      setConfig((prev) => ({
        ...prev,
        days: prev.days.map((d) =>
          d.day !== day
            ? d
            : {
                ...d,
                places: [
                  ...d.places,
                  {
                    ...newSimPlace(kind),
                    name: patch.name || "",
                    address: patch.address || "",
                    transport: patch.transport || "",
                  },
                ],
              },
        ),
      }));
    },
    [],
  );

  const updatePlace = useCallback(
    (day: number, placeId: string, patch: Partial<Chapter3SimPlace>) => {
      setConfig((prev) => ({
        ...prev,
        days: prev.days.map((d) =>
          d.day !== day
            ? d
            : {
                ...d,
                places: d.places.map((p) => (p.id === placeId ? { ...p, ...patch } : p)),
              },
        ),
      }));
    },
    [],
  );

  const removePlace = useCallback((day: number, placeId: string) => {
    setConfig((prev) => ({
      ...prev,
      days: prev.days.map((d) =>
        d.day !== day ? d : { ...d, places: d.places.filter((p) => p.id !== placeId) },
      ),
    }));
  }, []);

  const addTravelPlace = useCallback(() => {
    const entry = newTravelPlaceEntry();
    setConfig((prev) => ({
      ...prev,
      travelPlaces: [...(prev.travelPlaces ?? []), entry],
    }));
    return entry.id;
  }, []);

  const updateTravelPlace = useCallback(
    (placeId: string, patch: Partial<Pick<Chapter3TravelPlaceEntry, "name" | "address">>) => {
      setConfig((prev) => ({
        ...prev,
        travelPlaces: (prev.travelPlaces ?? []).map((p) =>
          p.id === placeId
            ? { ...p, ...patch, updatedAt: new Date().toISOString() }
            : p,
        ),
      }));
    },
    [],
  );

  const removeTravelPlace = useCallback((placeId: string) => {
    setConfig((prev) => ({
      ...prev,
      travelPlaces: (prev.travelPlaces ?? []).filter((p) => p.id !== placeId),
    }));
  }, []);

  const saveManualAddresses = useCallback((entries: { place: string; address: string }[]) => {
    const applyAddress = (name: string, address: string) => {
      const parsed = parsePlaceWithAddress(placeLabelFromNameAddress(name, address));
      const match = entries.find((e) => {
        const ep = parsePlaceWithAddress(e.place);
        return (
          ep.name === parsed.name ||
          ep.name === name ||
          e.place === name ||
          e.place === parsed.name
        );
      });
      return match ? sanitizeMapAddress(match.address) : address;
    };

    setConfig((prev) => ({
      ...prev,
      travelPlaces: (prev.travelPlaces ?? []).map((p) => ({
        ...p,
        address: applyAddress(p.name, p.address),
        updatedAt: new Date().toISOString(),
      })),
      days: prev.days.map((day) => ({
        ...day,
        places: day.places.map((p) => {
          const nextAddress = applyAddress(p.name, p.address);
          if (nextAddress === p.address) return p;
          return { ...p, address: nextAddress };
        }),
      })),
    }));
  }, []);

  const importFromPlan = useCallback(
    (
      dayPlans: DayPlan[],
      regionHint: string,
      departure: string,
      additionalTravelInfo?: AdditionalTravelInfo | null,
    ) => {
      if (!dayPlans.length) {
        showPasteHint("⚠️ 불러올 2번 챕터 일정이 없습니다.");
        return;
      }
      setConfig(importDayPlansToSimMap(dayPlans, regionHint, departure, additionalTravelInfo));
      showPasteHint("📋 2번 챕터 계획서를 시뮬레이션 지도로 불러왔습니다. (2번과 연동되지 않음)");
    },
    [showPasteHint],
  );

  const resetSimMap = useCallback(() => {
    setConfig(createDefaultSimMap());
    showPasteHint("🗺️ 시뮬레이션 지도를 초기화했습니다.");
  }, [showPasteHint]);

  const loadSimConfig = useCallback(
    (next: Chapter3SimMapConfig, hint?: string) => {
      setConfig(normalizeSimMapConfig(next));
      if (hint) showPasteHint(hint);
    },
    [showPasteHint],
  );

  return {
    config,
    isDomestic,
    updateConfigField,
    setMapRegion,
    addDay,
    removeDay,
    updateDayLabel,
    addPlace,
    addFilledPlace,
    updatePlace,
    removePlace,
    addTravelPlace,
    updateTravelPlace,
    removeTravelPlace,
    saveManualAddresses,
    importFromPlan,
    resetSimMap,
    loadSimConfig,
  };
}

function placeLabelFromSim(place: Chapter3SimPlace): string {
  return placeLabelFromNameAddress(place.name, place.address);
}

function placeLabelFromNameAddress(name: string, address: string): string {
  if (address?.trim()) {
    return address.includes(name) ? address : `${name} (${address})`;
  }
  return name;
}
