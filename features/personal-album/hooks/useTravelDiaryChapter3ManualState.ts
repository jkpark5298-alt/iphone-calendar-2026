import { useCallback, useEffect, useRef, useState } from "react";
import type { DayPlan, PlanRequest, PlanScheduleSegment, PlanScheduleSegmentField } from "../types";
import {
  createManualDayPlan,
  createManualTrip,
  ensureManualTripSegmentIds,
  newScheduleSegment,
  syncManualTripDayCount,
  type Chapter3AlbumSource,
  type Chapter3ManualTrip,
} from "../utils/chapter3Utils";
import { readManualTripsStore, writeManualTripsStore } from "../utils/chapter3ManualStorage";
import {
  CHAPTER3_CLOUD_SYNC_EVENT,
  type Chapter3CloudSyncDetail,
} from "../utils/chapter3CloudSyncUtils";
import { scheduleChapter3CloudSave } from "../utils/travelAlbumsSupabaseUtils";

export interface UseTravelDiaryChapter3ManualStateProps {
  showPasteHint: (msg: string) => void;
}

type ScheduleKey = "morningSchedule" | "afternoonSchedule" | "eveningSchedule";

export function useTravelDiaryChapter3ManualState({ showPasteHint }: UseTravelDiaryChapter3ManualStateProps) {
  const [activeSource, setActiveSource] = useState<Chapter3AlbumSource>("chapter2");
  const [trips, setTrips] = useState<Chapter3ManualTrip[]>([]);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [editingDay, setEditingDay] = useState<number | null>(1);
  const skipCloudSaveRef = useRef(false);

  useEffect(() => {
    const store = readManualTripsStore();
    setTrips(store.trips.map(ensureManualTripSegmentIds));
    setActiveSource(store.activeSource);
    setActiveTripId(store.activeTripId ?? store.trips[0]?.id ?? null);
    setHydrated(true);
  }, []);

  const persist = useCallback(
    (nextTrips: Chapter3ManualTrip[], source: Chapter3AlbumSource, tripId: string | null) => {
      writeManualTripsStore({
        trips: nextTrips,
        activeSource: source,
        activeTripId: tripId,
        updatedAt: new Date().toISOString(),
      });
    },
    [],
  );

  useEffect(() => {
    if (!hydrated) return;
    persist(trips, activeSource, activeTripId);
    if (skipCloudSaveRef.current) {
      skipCloudSaveRef.current = false;
      return;
    }
    scheduleChapter3CloudSave(800);
  }, [trips, activeSource, activeTripId, hydrated, persist]);

  useEffect(() => {
    const handleCloudSync = (event: Event) => {
      const detail = (event as CustomEvent<Chapter3CloudSyncDetail>).detail;
      if (!detail?.manualTrips) return;
      const remote = detail.manualTrips;
      skipCloudSaveRef.current = true;
      setTrips(remote.trips.map(ensureManualTripSegmentIds));
      setActiveSource(remote.activeSource);
      setActiveTripId(remote.activeTripId ?? remote.trips[0]?.id ?? null);
    };

    window.addEventListener(CHAPTER3_CLOUD_SYNC_EVENT, handleCloudSync);
    return () => window.removeEventListener(CHAPTER3_CLOUD_SYNC_EVENT, handleCloudSync);
  }, []);

  const activeTrip = trips.find((t) => t.id === activeTripId) ?? null;

  const updateTrips = useCallback((updater: (prev: Chapter3ManualTrip[]) => Chapter3ManualTrip[]) => {
    setTrips((prev) => updater(prev));
  }, []);

  const setAlbumSource = useCallback((source: Chapter3AlbumSource) => {
    setActiveSource(source);
  }, []);

  const selectTrip = useCallback((tripId: string) => {
    setActiveTripId(tripId);
    const trip = trips.find((t) => t.id === tripId);
    if (trip?.dayPlans[0]) setEditingDay(trip.dayPlans[0].day);
  }, [trips]);

  const addTrip = useCallback(() => {
    const trip = createManualTrip(`기존 여행 ${trips.length + 1}`);
    setTrips((prev) => [trip, ...prev]);
    setActiveTripId(trip.id);
    setActiveSource("manual");
    setEditingDay(1);
    showPasteHint("✏️ 새 기존 여행 계획을 추가했습니다.");
  }, [trips.length, showPasteHint]);

  const removeTrip = useCallback(
    (tripId: string, options?: { silent?: boolean }) => {
      if (
        !options?.silent &&
        !window.confirm("이 여행 계획과 연결된 앨범 초안이 함께 삭제될 수 있습니다. 삭제할까요?")
      ) {
        return;
      }
      setTrips((prev) => {
        const next = prev.filter((t) => t.id !== tripId);
        if (activeTripId === tripId) {
          setActiveTripId(next[0]?.id ?? null);
        }
        return next;
      });
      if (!options?.silent) {
        showPasteHint("🗑️ 기존 여행 계획을 삭제했습니다.");
      }
    },
    [activeTripId, showPasteHint],
  );

  const updateTripMeta = useCallback(
    (tripId: string, patch: Partial<Pick<Chapter3ManualTrip, "title">>) => {
      updateTrips((prev) =>
        prev.map((t) =>
          t.id !== tripId ? t : { ...t, ...patch, updatedAt: new Date().toISOString() },
        ),
      );
    },
    [updateTrips],
  );

  const updatePlanRequest = useCallback(
    (tripId: string, patch: Partial<PlanRequest>) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          const nextRequest = { ...t.planRequest, ...patch };
          let next = { ...t, planRequest: nextRequest, updatedAt: new Date().toISOString() };
          if (patch.startDate !== undefined || patch.endDate !== undefined) {
            next = syncManualTripDayCount(next);
          }
          return next;
        }),
      );
    },
    [updateTrips],
  );

  const updateDayPlanField = useCallback(
    (tripId: string, day: number, field: keyof DayPlan, value: unknown) => {
      updateTrips((prev) =>
        prev.map((t) =>
          t.id !== tripId
            ? t
            : {
                ...t,
                dayPlans: t.dayPlans.map((dp) =>
                  dp.day !== day ? dp : { ...dp, [field]: value },
                ),
                updatedAt: new Date().toISOString(),
              },
        ),
      );
    },
    [updateTrips],
  );

  const addDay = useCallback(
    (tripId: string) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          const nextDay = t.dayPlans.length > 0 ? Math.max(...t.dayPlans.map((d) => d.day)) + 1 : 1;
          return {
            ...t,
            dayPlans: [...t.dayPlans, createManualDayPlan(nextDay)],
            updatedAt: new Date().toISOString(),
          };
        }),
      );
      showPasteHint("일차를 추가했습니다.");
    },
    [updateTrips, trips, showPasteHint],
  );

  const removeDay = useCallback(
    (tripId: string, day: number) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId || t.dayPlans.length <= 1) return t;
          const next = t.dayPlans.filter((d) => d.day !== day).map((d, idx) => ({
            ...d,
            day: idx + 1,
          }));
          return { ...t, dayPlans: next, updatedAt: new Date().toISOString() };
        }),
      );
    },
    [updateTrips],
  );

  const addScheduleSegment = useCallback(
    (tripId: string, day: number, scheduleKey: ScheduleKey, label?: string) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          return {
            ...t,
            dayPlans: t.dayPlans.map((dp) => {
              if (dp.day !== day) return dp;
              const segments = [...(dp[scheduleKey] || []), newScheduleSegment(label)];
              return { ...dp, [scheduleKey]: segments };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [updateTrips],
  );

  const updateScheduleSegment = useCallback(
    (
      tripId: string,
      day: number,
      scheduleKey: ScheduleKey,
      index: number,
      field: PlanScheduleSegmentField,
      value: string,
    ) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          return {
            ...t,
            dayPlans: t.dayPlans.map((dp) => {
              if (dp.day !== day) return dp;
              const segments = [...(dp[scheduleKey] || [])];
              if (!segments[index]) return dp;
              segments[index] = { ...segments[index], [field]: value };
              return { ...dp, [scheduleKey]: segments };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [updateTrips],
  );

  const removeScheduleSegment = useCallback(
    (tripId: string, day: number, scheduleKey: ScheduleKey, index: number) => {
      updateTrips((prev) =>
        prev.map((t) => {
          if (t.id !== tripId) return t;
          return {
            ...t,
            dayPlans: t.dayPlans.map((dp) => {
              if (dp.day !== day) return dp;
              const segments = (dp[scheduleKey] || []).filter((_, i) => i !== index);
              return { ...dp, [scheduleKey]: segments };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [updateTrips],
  );

  const updateRecommendationsText = useCallback(
    (
      tripId: string,
      day: number,
      field: "lunchRecommendations" | "dinnerRecommendations" | "accommodationRecommendations",
      text: string,
    ) => {
      const items = text
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      updateDayPlanField(tripId, day, field, items);
    },
    [updateDayPlanField],
  );

  return {
    activeSource,
    setAlbumSource,
    trips,
    activeTrip,
    activeTripId,
    editingDay,
    setEditingDay,
    selectTrip,
    addTrip,
    removeTrip,
    updateTripMeta,
    updatePlanRequest,
    updateDayPlanField,
    addDay,
    removeDay,
    addScheduleSegment,
    updateScheduleSegment,
    removeScheduleSegment,
    updateRecommendationsText,
  };
}
