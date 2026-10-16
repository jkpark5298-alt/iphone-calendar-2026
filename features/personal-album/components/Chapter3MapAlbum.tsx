"use client";

/**
 * Chapter 3 — 여행 앨범 / 개인 앨범
 * Chapter 4 — 여행 지도(시뮬레이션) (panelMode="map")
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdditionalTravelInfo, DayPlan, PlanRequest } from "../types";
import { Chapter3AlbumExifUpload } from "./Chapter3AlbumExifUpload";
import { parseAlbumAppFile, prepareImportedAlbum } from "../utils/albumAppFileUtils";
import {
  importAlbumFullBackupZip,
  saveAlbumFullBackup,
  saveAllAlbumsFullBackup,
} from "../utils/albumFullBackupUtils";
import { setArchiveMigrationSkipAlbumId } from "../utils/albumArchivePressure";
import { photoIsArchived } from "../utils/albumArchivePlan";
import { ALBUM_UPLOAD_MAX_ROUNDS } from "../utils/albumUploadBatch";
import { Card, EmptyState } from "./SharedComponents";
import { NaverMap, type NaverRouteMetrics } from "./NaverMap";
import { OverseasPlacesMap } from "./OverseasPlacesMap";
import {
  buildSimAddressLookup,
  buildSimDayRoutePlaces,
  buildSimRouteDaySegments,
  buildSimRouteLegs,
  formatDistanceKm,
  formatDistanceMeters,
  formatDurationMs,
  haversineKm,
  simPlaceMapLabel,
  collectPhotoPlaceNames,
  isAutoPhotoPlaceDescription,
  photosForPlaceDescription,
  preservePlaceDescriptions,
  simPlaceToMapItem,
  withResolvedPlaceDescriptions,
  type Chapter3MapPlaceItem,
  type Chapter3PlaceKind,
  type Chapter3RouteLeg,
  type Chapter3SimDay,
  type Chapter3SimPlace,
} from "../utils/chapter3Utils";
import { getPlanDayColor, toMapPlaceKey, DAY_MAP_HEIGHT } from "../utils/planConstants";
import { buildGeocodeQueryCandidatesForMap } from "../utils/naverGeocodeUtils";
import { useTravelDiaryChapter3State, manualTripAlbumPlanId } from "../hooks/useTravelDiaryChapter3State";
import { useTravelDiaryChapter3MapState } from "../hooks/useTravelDiaryChapter3MapState";
import { useTravelDiaryChapter3ManualState } from "../hooks/useTravelDiaryChapter3ManualState";
import { useTravelPlacesDb } from "../hooks/TravelPlacesDbContext";
import { travelPlaceLabel, isDomesticPlaceRecord, travelPlaceMapQuery } from "../utils/travelPlacesDb";
import { TravelPlaceDbSearch, TravelPlaceLookupFields } from "./TravelPlaceLookupInput";
import { readChapter3Album, writeChapter3Album, removeChapter3Album } from "../utils/chapter3Storage";
import {
  clearAlbumEditingSession,
  readAlbumEditingSession,
  writeAlbumEditingSession,
  type AlbumEditOrigin,
  type AlbumLibraryFilter,
  type AlbumTabView,
  type Chapter3AlbumTab,
} from "../utils/chapter3AlbumEditingSession";
import { parseManualTripIdFromPlanId } from "../utils/chapter3Utils";
import { Chapter3ManualPlanEditor } from "./Chapter3ManualPlanEditor";
import { Chapter3DayPhotoLocationMap, Chapter3PhotoAlbumPanel } from "./Chapter3PhotoAlbumPanel";
import { Chapter3SavedAlbumList } from "./Chapter3SavedAlbumList";
import { useTravelDiarySavedAlbums } from "../hooks/useTravelDiarySavedAlbums";
import { formatDateSlash, resolveAlbumDayDateIso, sortAlbumDaysByDate } from "../utils/albumDateUtils";
import { openTravelAlbumPdfWindow } from "../utils/albumPdfUtils";
import {
  albumKindOf,
  createFreshAlbumPlanId,
  filterAlbumsByKind,
  isFreshAlbumPlanId,
  type AlbumKind,
  type SavedTravelAlbum,
} from "../utils/chapter3SavedAlbumUtils";
import {
  countSimPlaces,
  deleteSavedSim,
  formatSimSavedAt,
  readSavedSims,
  upsertSavedSim,
  type SavedSimMap,
  type SavedSimRouteStats,
} from "../utils/chapter3SavedSimUtils";

export type Chapter3PanelMode = "albums" | "map";

export interface Chapter3MapAlbumProps {
  planRequest: PlanRequest;
  dayPlans: DayPlan[];
  additionalTravelInfo: AdditionalTravelInfo | null;
  isPlanConfirmed: boolean;
  activePlanId: string | null;
  effectiveDeparture: string;
  showPasteHint: (msg: string) => void;
  /** albums: 3번 챕터(여행/개인 앨범) · map: 4번 챕터 여행 지도 */
  panelMode?: Chapter3PanelMode;
  initialFocusPlaceId?: string | null;
  onFocusPlaceConsumed?: () => void;
  selectedSimPlaceIds?: string[];
  onToggleSimPlaceId?: (placeId: string) => void;
  onClearSimPlaceIds?: () => void;
  /** 개인 앨범 전용 — 여행 앨범/지도 탭 숨김, activeTab 을 "personal" 로 고정 */
  personalOnly?: boolean;
}

export function Chapter3MapAlbum({
  planRequest,
  dayPlans,
  additionalTravelInfo,
  isPlanConfirmed,
  activePlanId,
  effectiveDeparture,
  showPasteHint,
  panelMode = "albums",
  initialFocusPlaceId = null,
  onFocusPlaceConsumed,
  selectedSimPlaceIds,
  onToggleSimPlaceId,
  onClearSimPlaceIds,
  personalOnly = false,
}: Chapter3MapAlbumProps) {
  const [activeTab, setActiveTabRaw] = useState<Chapter3AlbumTab>(
    personalOnly ? "personal" : panelMode === "map" ? "map" : "album",
  );
  const setActiveTab = useCallback(
    (tab: Chapter3AlbumTab) => {
      setActiveTabRaw(personalOnly ? "personal" : tab);
    },
    [personalOnly],
  );
  const albumKind: AlbumKind = activeTab === "personal" ? "personal" : "travel";
  const isPersonalAlbum = albumKind === "personal";
  const [albumView, setAlbumView] = useState<AlbumTabView>("library");
  const [libraryFilter, setLibraryFilter] = useState<AlbumLibraryFilter>("saved");
  const [editingSavedAlbumId, setEditingSavedAlbumId] = useState<string | null>(null);
  const [editingSourcePlanId, setEditingSourcePlanId] = useState<string | null>(null);
  const [albumEditOrigin, setAlbumEditOrigin] = useState<AlbumEditOrigin | null>(null);
  const [forceAlbumEdit, setForceAlbumEdit] = useState(false);
  const [photoUploadRounds, setPhotoUploadRounds] = useState(0);
  const [albumTitleDraft, setAlbumTitleDraft] = useState("");
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  /** 등록 여행지 vs 일차 동선 — 기본은 일차 동선(장소 직접 입력) */
  const [mapRouteMode, setMapRouteMode] = useState<"registered" | "day">("day");
  /** 등록 여행지 모드: 선택한 장소만 도로 동선 (선택 순서) */
  const [routePlaceIds, setRoutePlaceIds] = useState<string[]>([]);
  const [legDistances, setLegDistances] = useState<Record<string, number>>({});
  const [liveRouteMetrics, setLiveRouteMetrics] = useState<NaverRouteMetrics | null>(null);
  const [savedSims, setSavedSims] = useState<SavedSimMap[]>([]);
  const [simSaveTitle, setSimSaveTitle] = useState("");
  const [editingSimId, setEditingSimId] = useState<string | null>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);

  const mapState = useTravelDiaryChapter3MapState({ showPasteHint });
  const travelPlacesDb = useTravelPlacesDb();
  const manualState = useTravelDiaryChapter3ManualState({ showPasteHint });
  const savedAlbums = useTravelDiarySavedAlbums(showPasteHint);
  const focusPlaceConsumedRef = useRef<string | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);

  useEffect(() => {
    setSavedSims(readSavedSims());
  }, []);

  useEffect(() => {
    if (panelMode === "map") {
      setActiveTab("map");
    } else if (activeTab === "map") {
      setActiveTab("album");
    }
  }, [panelMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab !== "album" && activeTab !== "personal") return;
    let cancelled = false;
    void fetch("/api/google-drive/status")
      .then((response) => response.json() as Promise<{ connected?: boolean }>)
      .then((status) => {
        if (!cancelled) setDriveConnected(Boolean(status.connected));
      })
      .catch(() => {
        if (!cancelled) setDriveConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (!initialFocusPlaceId) {
      focusPlaceConsumedRef.current = null;
      return;
    }
    if (focusPlaceConsumedRef.current === initialFocusPlaceId) return;

    const place = travelPlacesDb.places.find((p) => p.id === initialFocusPlaceId);
    if (!place) {
      // DB hydrate 전이면 다음 렌더에서 재시도
      if (travelPlacesDb.places.length === 0) return;
      focusPlaceConsumedRef.current = initialFocusPlaceId;
      onFocusPlaceConsumed?.();
      return;
    }

    focusPlaceConsumedRef.current = initialFocusPlaceId;
    const label = travelPlaceLabel(place);
    const domestic = isDomesticPlaceRecord(place);
    const hint = [place.city, place.country, place.name].filter(Boolean).join(", ");

    setActiveTab("map");
    setMapRouteMode("registered");
    setSelectedPlace(label);
    setSelectedPlaceId(place.id);
    setRoutePlaceIds((prev) => (prev.includes(place.id) ? prev : [...prev, place.id]));
    mapState.setMapRegion(domestic ? "domestic" : "overseas");
    if (hint.trim()) {
      mapState.updateConfigField("regionHint", hint.trim());
    }

    showPasteHint(`🗺️ 등록 여행지 「${label}」를 지도 시뮬레이션에 표시했습니다.`);
    window.setTimeout(() => {
      mapPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 120);

    onFocusPlaceConsumed?.();
  }, [
    initialFocusPlaceId,
    mapState.setMapRegion,
    mapState.updateConfigField,
    onFocusPlaceConsumed,
    showPasteHint,
    travelPlacesDb.places,
  ]);

  const albumPlanId = useMemo(() => {
    if (manualState.activeSource === "manual" && manualState.activeTripId) {
      return manualTripAlbumPlanId(manualState.activeTripId);
    }
    return activePlanId || "draft-plan";
  }, [manualState.activeSource, manualState.activeTripId, activePlanId]);

  const albumDayPlans = useMemo(() => {
    if (manualState.activeSource === "manual" && manualState.activeTrip) {
      return manualState.activeTrip.dayPlans;
    }
    return dayPlans;
  }, [manualState.activeSource, manualState.activeTrip, dayPlans]);

  const albumEnabled =
    forceAlbumEdit ||
    (manualState.activeSource === "manual"
      ? Boolean(manualState.activeTrip && manualState.activeTrip.dayPlans.length > 0)
      : isPlanConfirmed && dayPlans.length > 0);

  const uploadProgressNoteRef = useRef<string | undefined>(undefined);
  const archiveUploadRef = useRef<{ albumId?: string; required: boolean }>({ required: false });
  const editingForArchive = editingSavedAlbumId
    ? savedAlbums.albums.find((album) => album.id === editingSavedAlbumId)
    : undefined;
  archiveUploadRef.current = {
    albumId: editingForArchive?.id || albumPlanId,
    required: Boolean(
      editingForArchive?.photoArchive ||
        editingForArchive?.days.some((day) =>
          day.places.some((place) =>
            place.photos.some(
              (photo) => photoIsArchived(photo) || Boolean(photo.archived) || Boolean(photo.driveFileId),
            ),
          ),
        ),
    ),
  };
  const chapter3State = useTravelDiaryChapter3State({
    dayPlans: albumDayPlans,
    albumPlanId,
    showPasteHint,
    enabled: albumEnabled,
    manualMode: manualState.activeSource === "manual",
    uploadProgressNoteRef,
    archiveUploadRef,
  });
  const writingNewAlbum =
    Boolean(editingSourcePlanId && isFreshAlbumPlanId(editingSourcePlanId)) &&
    albumEditOrigin !== "confirmed" &&
    (photoUploadRounds > 0 ||
      chapter3State.albumDays.some((day) =>
        day.places.some((place) => place.photos.length > 0),
      ));
  uploadProgressNoteRef.current = writingNewAlbum
    ? "📝 현재 새 앨범 작성 중입니다."
    : undefined;

  useEffect(() => {
    setArchiveMigrationSkipAlbumId(editingSavedAlbumId);
    return () => setArchiveMigrationSkipAlbumId(null);
  }, [editingSavedAlbumId]);

  const kindAlbums = useMemo(
    () => filterAlbumsByKind(savedAlbums.albums, albumKind),
    [savedAlbums.albums, albumKind],
  );
  const kindDeletedAlbums = useMemo(
    () => filterAlbumsByKind(savedAlbums.deletedAlbums, albumKind),
    [savedAlbums.deletedAlbums, albumKind],
  );
  const savedAlbumList = useMemo(
    () => kindAlbums.filter((a) => a.status === "saved"),
    [kindAlbums],
  );
  const draftAlbumList = useMemo(
    () => kindAlbums.filter((a) => a.status === "draft"),
    [kindAlbums],
  );

  const defaultAlbumTitle = useMemo(() => {
    if (isPersonalAlbum) return "개인앨범";
    if (manualState.activeSource === "manual" && manualState.activeTrip?.title) {
      return manualState.activeTrip.title;
    }
    return planRequest.destinations?.trim() || "여행 앨범";
  }, [
    isPersonalAlbum,
    manualState.activeSource,
    manualState.activeTrip?.title,
    planRequest.destinations,
  ]);

  useEffect(() => {
    if (!editingSavedAlbumId) {
      setAlbumTitleDraft(defaultAlbumTitle);
    }
  }, [defaultAlbumTitle, editingSavedAlbumId]);

  const sourceLabel = useMemo(() => {
    if (manualState.activeSource === "manual") {
      const trip = manualState.activeTrip;
      const destinations = trip?.planRequest.destinations?.trim();
      const title = trip?.title?.trim();
      if (destinations && title) return `${title} · ${destinations}`;
      return destinations || title || "수동 입력";
    }
    return planRequest.destinations?.trim() || "2번 챕터 확정 계획";
  }, [
    manualState.activeSource,
    manualState.activeTrip?.title,
    manualState.activeTrip?.planRequest.destinations,
    planRequest.destinations,
  ]);

  const resolveEditingAlbumId = useCallback(() => {
    if (editingSavedAlbumId) {
      const stillExists = savedAlbums.albums.some(
        (a) => a.id === editingSavedAlbumId && albumKindOf(a) === albumKind,
      );
      if (stillExists) return editingSavedAlbumId;
    }
    const planKey =
      manualState.activeSource === "manual" && manualState.activeTripId
        ? manualTripAlbumPlanId(manualState.activeTripId)
        : editingSourcePlanId || albumPlanId;
    const byPlan = savedAlbums.albums.find(
      (a) =>
        a.status === "draft" &&
        a.sourcePlanId === planKey &&
        albumKindOf(a) === albumKind,
    );
    if (byPlan) return byPlan.id;
    if (manualState.activeSource === "manual" && manualState.activeTripId) {
      const byTrip = savedAlbums.albums.find(
        (a) =>
          albumKindOf(a) === albumKind &&
          parseManualTripIdFromPlanId(a.sourcePlanId || "") === manualState.activeTripId,
      );
      if (byTrip) return byTrip.id;
    }
    const session = readAlbumEditingSession();
    if (session?.editingSavedAlbumId) {
      const fromSession = savedAlbums.albums.find(
        (a) => a.id === session.editingSavedAlbumId && albumKindOf(a) === albumKind,
      );
      if (fromSession) return fromSession.id;
    }
    return undefined;
  }, [
    editingSavedAlbumId,
    editingSourcePlanId,
    savedAlbums.albums,
    albumPlanId,
    albumKind,
    manualState.activeSource,
    manualState.activeTripId,
  ]);

  const syncPlanContextFromAlbum = useCallback(
    (album: SavedTravelAlbum) => {
      const planKey = album.sourcePlanId?.trim();
      if (!planKey) return;
      const tripId = parseManualTripIdFromPlanId(planKey);
      if (tripId && manualState.trips.some((t) => t.id === tripId)) {
        manualState.setAlbumSource("manual");
        manualState.selectTrip(tripId);
        return;
      }
      manualState.setAlbumSource("chapter2");
    },
    [manualState],
  );

  const loadAlbumIntoEditor = useCallback(
    (album: SavedTravelAlbum, options?: { silent?: boolean }) => {
      const planKey = album.sourcePlanId || albumPlanId;
      const samePlan = editingSourcePlanId === planKey || albumPlanId === planKey;
      const days = preservePlaceDescriptions(
        album.days,
        samePlan ? chapter3State.albumDays : null,
        readChapter3Album(planKey),
      );
      writeChapter3Album(planKey, days);
      setForceAlbumEdit(true);
      setEditingSavedAlbumId(album.id);
      setEditingSourcePlanId(planKey);
      setAlbumTitleDraft(album.title);
      setAlbumView("create");
      syncPlanContextFromAlbum(album);
      chapter3State.setAlbumDays(days);
      setPhotoUploadRounds(0);
      if (!options?.silent) {
        showPasteHint(`📷 「${album.title}」 앨범을 불러왔습니다.`);
      }
    },
    [albumPlanId, chapter3State, editingSourcePlanId, showPasteHint, syncPlanContextFromAlbum],
  );

  const rebindAlbumForPlanId = useCallback(
    (planKey: string, options?: { silent?: boolean }) => {
      const samePlan = (album: SavedTravelAlbum) => {
        if (album.sourcePlanId === planKey) return true;
        const tripId = parseManualTripIdFromPlanId(planKey);
        if (!tripId) return false;
        return parseManualTripIdFromPlanId(album.sourcePlanId || "") === tripId;
      };
      // 임시본만 자동으로 이어쓰기 — 확정본은 「내 앨범 → 수정」으로만 연다
      const draft = savedAlbums.albums.find(
        (album) => album.status === "draft" && samePlan(album),
      );
      if (draft) {
        loadAlbumIntoEditor(draft, options);
        setAlbumEditOrigin(draft.originAlbumId ? "confirmed" : "draft");
        return;
      }
      if (!editingSavedAlbumId) {
        setEditingSourcePlanId(planKey);
        setAlbumTitleDraft(defaultAlbumTitle);
      }
    },
    [savedAlbums.albums, loadAlbumIntoEditor, editingSavedAlbumId, defaultAlbumTitle],
  );

  const resolveSaveSourcePlanId = useCallback(() => {
    if (editingSourcePlanId && isFreshAlbumPlanId(editingSourcePlanId)) {
      return editingSourcePlanId;
    }
    if (manualState.activeSource === "manual" && manualState.activeTripId) {
      return manualTripAlbumPlanId(manualState.activeTripId);
    }
    if (editingSavedAlbumId) {
      const editing = savedAlbums.albums.find((a) => a.id === editingSavedAlbumId);
      if (editing?.sourcePlanId) return editing.sourcePlanId;
    }
    return editingSourcePlanId || albumPlanId;
  }, [
    manualState.activeSource,
    manualState.activeTripId,
    editingSavedAlbumId,
    editingSourcePlanId,
    savedAlbums.albums,
    albumPlanId,
  ]);

  const handleSaveAlbum = useCallback(
    (status: "draft" | "saved", options?: { stay?: boolean }) => {
      const hasPhotos = chapter3State.albumDays.some((day) =>
        day.places.some((place) => place.photos.length > 0),
      );
      if (!albumEnabled || !hasPhotos) {
        showPasteHint("⚠️ 사진을 올린 뒤에 저장하거나 확정할 수 있습니다.");
        return;
      }
      const sourcePlanId = resolveSaveSourcePlanId();
      const current =
        (editingSavedAlbumId &&
          savedAlbums.albums.find((a) => a.id === editingSavedAlbumId)) ||
        undefined;
      const originAlbumId =
        current?.status === "saved" ? current.id : current?.originAlbumId;
      const albumId =
        status === "draft"
          ? current?.status === "draft"
            ? current.id
            : savedAlbums.findDraftForOrigin?.(originAlbumId || "")?.id
          : current?.originAlbumId || current?.id || resolveEditingAlbumId();

      const saved = savedAlbums.upsertAlbum({
        id: albumId,
        title: albumTitleDraft.trim() || defaultAlbumTitle,
        status,
        kind: albumKindOf(current) === "personal" || isPersonalAlbum ? "personal" : "travel",
        sourcePlanId: current?.sourcePlanId || sourcePlanId,
        sourceLabel,
        days: withResolvedPlaceDescriptions(chapter3State.albumDays),
        originAlbumId: status === "draft" ? originAlbumId : undefined,
      });
      setEditingSavedAlbumId(saved.id);
      setEditingSourcePlanId(saved.sourcePlanId);
      if (status === "draft") {
        showPasteHint(
          options?.stay
            ? "💾 작업 중으로 저장했습니다. 이어서 다음 회차 사진을 올릴 수 있습니다."
            : "💾 작업 중 목록에 저장했습니다. 확정 앨범은 그대로 유지됩니다.",
        );
        setAlbumEditOrigin("draft");
        if (!options?.stay) {
          setLibraryFilter("draft");
          setAlbumView("library");
        }
      } else {
        const completedNewAlbum =
          isFreshAlbumPlanId(saved.sourcePlanId) && albumEditOrigin !== "confirmed";
        showPasteHint(
          completedNewAlbum
            ? `✅ 「${saved.title}」 새 앨범을 완료했습니다. 확정 목록에 따로 저장했습니다.`
            : `✅ 「${saved.title}」 앨범을 완료했습니다.`,
        );
        setLibraryFilter("saved");
        setAlbumView("library");
        setAlbumEditOrigin(null);
        setForceAlbumEdit(false);
      }
    },
    [
      albumEnabled,
      chapter3State.albumDays,
      savedAlbums,
      resolveEditingAlbumId,
      resolveSaveSourcePlanId,
      editingSavedAlbumId,
      albumTitleDraft,
      defaultAlbumTitle,
      sourceLabel,
      showPasteHint,
      albumEditOrigin,
      isPersonalAlbum,
    ],
  );

  const handleEditSavedAlbum = useCallback(
    (album: SavedTravelAlbum) => {
      setActiveTab(albumKindOf(album) === "personal" ? "personal" : "album");
      setAlbumEditOrigin("confirmed");
      const existingDraft =
        savedAlbums.findDraftForOrigin?.(album.id) ||
        savedAlbums.albums.find(
          (item) =>
            item.status === "draft" &&
            albumKindOf(item) === albumKindOf(album) &&
            (item.originAlbumId === album.id ||
              (item.sourcePlanId && item.sourcePlanId === album.sourcePlanId)),
        );
      const draft =
        existingDraft ||
        savedAlbums.upsertAlbum({
          title: album.title,
          status: "draft",
          kind: albumKindOf(album),
          sourcePlanId: album.sourcePlanId,
          sourceLabel: album.sourceLabel,
          days: album.days,
          originAlbumId: album.id,
        });
      loadAlbumIntoEditor(draft, { silent: true });
      showPasteHint("✏️ 수정 내용은 작업 중으로 저장됩니다. 「확정에 반영」을 누르면 확정 앨범에 반영됩니다.");
    },
    [savedAlbums, loadAlbumIntoEditor, showPasteHint],
  );

  const handleResumeDraftAlbum = useCallback(
    (album: SavedTravelAlbum) => {
      setActiveTab(albumKindOf(album) === "personal" ? "personal" : "album");
      setAlbumEditOrigin("draft");
      loadAlbumIntoEditor(album, { silent: true });
      showPasteHint(`📷 「${album.title}」 작업 중 앨범을 이어서 편집합니다.`);
    },
    [loadAlbumIntoEditor, showPasteHint],
  );

  const startNewAlbum = useCallback(() => {
    const confirmed = savedAlbums.albums.filter((album) => album.status === "saved");
    setEditingSavedAlbumId(null);
    setEditingSourcePlanId(createFreshAlbumPlanId());
    setAlbumEditOrigin(null);
    setAlbumTitleDraft(defaultAlbumTitle);
    setForceAlbumEdit(true);
    chapter3State.setAlbumDays([]);
    setPhotoUploadRounds(0);
    setAlbumView("create");
    if (confirmed.length > 0) {
      const names = confirmed
        .slice(0, 2)
        .map((album) => album.title)
        .join(", ");
      const extra = confirmed.length > 2 ? ` 외 ${confirmed.length - 2}개` : "";
      showPasteHint(
        `📝 확정 앨범(${names}${extra})은 그대로 두고, 새 앨범을 따로 저장합니다. 사진은 1회 100장, 10회로 나눠 올리세요.`,
      );
      return;
    }
    showPasteHint("📝 새 앨범 만들기를 시작합니다. 사진은 1회 100장, 10회로 나눠 올리세요.");
  }, [savedAlbums.albums, defaultAlbumTitle, chapter3State, showPasteHint]);

  useEffect(() => {
    writeAlbumEditingSession({
      editingSavedAlbumId,
      editingSourcePlanId,
      albumView,
      libraryFilter,
      activeTab,
      albumEditOrigin,
    });
  }, [editingSavedAlbumId, editingSourcePlanId, albumView, libraryFilter, activeTab, albumEditOrigin]);

  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (!savedAlbums.hydrated || sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const session = readAlbumEditingSession();

    if (!session?.editingSavedAlbumId) {
      // 앨범이 있으면 내 앨범부터, 없으면 편집(새 앨범)부터
      if (savedAlbums.albums.length > 0) {
        setAlbumView("library");
        setLibraryFilter(
          savedAlbums.albums.some((a) => a.status === "saved") ? "saved" : "draft",
        );
      } else {
        setAlbumView("create");
      }
      return;
    }

    const album = savedAlbums.albums.find((a) => a.id === session.editingSavedAlbumId);
    if (!album) {
      clearAlbumEditingSession();
      if (savedAlbums.albums.length > 0) {
        setAlbumView("library");
        setLibraryFilter("saved");
      }
      return;
    }
    // 확정본을 수정 중이 아니었으면 편집 화면에 다시 올리지 않음
    const editingConfirmed =
      session.albumEditOrigin === "confirmed" || Boolean(album.originAlbumId);
    if (album.status === "saved" && !editingConfirmed) {
      clearAlbumEditingSession();
      setLibraryFilter(session.libraryFilter === "draft" ? "draft" : "saved");
      setAlbumView("library");
      return;
    }
    setEditingSavedAlbumId(album.id);
    setEditingSourcePlanId(album.sourcePlanId);
    setAlbumTitleDraft(album.title);
    setForceAlbumEdit(true);
    if (session.albumView) setAlbumView(session.albumView);
    if (session.libraryFilter) setLibraryFilter(session.libraryFilter);
    if (
      session.activeTab === "map" ||
      session.activeTab === "album" ||
      session.activeTab === "personal"
    ) {
      if (panelMode === "map") setActiveTab("map");
      else if (session.activeTab !== "map") setActiveTab(session.activeTab);
    }
    if (session.albumEditOrigin === "confirmed" || session.albumEditOrigin === "draft") {
      setAlbumEditOrigin(session.albumEditOrigin);
    } else if (album.originAlbumId) {
      setAlbumEditOrigin("confirmed");
    } else if (album.status === "draft") {
      setAlbumEditOrigin("draft");
    }
    const restoredDays = preservePlaceDescriptions(
      album.days,
      readChapter3Album(album.sourcePlanId),
    );
    writeChapter3Album(album.sourcePlanId, restoredDays);
    syncPlanContextFromAlbum(album);
    chapter3State.setAlbumDays(restoredDays);
  }, [savedAlbums.hydrated, savedAlbums.albums, syncPlanContextFromAlbum, chapter3State]);

  const resetAlbumEditor = useCallback(
    (options?: { clearPlanStorage?: string | null }) => {
      setEditingSavedAlbumId(null);
      setEditingSourcePlanId(null);
      setAlbumEditOrigin(null);
      setForceAlbumEdit(false);
      setAlbumTitleDraft(defaultAlbumTitle);
      chapter3State.setAlbumDays([]);
      if (options?.clearPlanStorage) {
        removeChapter3Album(options.clearPlanStorage);
      }
      clearAlbumEditingSession();
    },
    [chapter3State, defaultAlbumTitle],
  );

  useEffect(() => {
    if (!savedAlbums.hydrated || !editingSavedAlbumId) return;
    const stillExists = savedAlbums.albums.some((a) => a.id === editingSavedAlbumId);
    if (stillExists) return;
    resetAlbumEditor({ clearPlanStorage: editingSourcePlanId });
  }, [
    savedAlbums.hydrated,
    savedAlbums.albums,
    editingSavedAlbumId,
    editingSourcePlanId,
    resetAlbumEditor,
  ]);

  useEffect(() => {
    if (!savedAlbums.hydrated || albumView !== "create") return;
    if (editingSavedAlbumId) return;
    if (isFreshAlbumPlanId(editingSourcePlanId)) return;
    rebindAlbumForPlanId(albumPlanId, { silent: true });
  }, [
    albumPlanId,
    savedAlbums.hydrated,
    albumView,
    editingSavedAlbumId,
    editingSourcePlanId,
    rebindAlbumForPlanId,
  ]);

  // 확정본이 수정 의사 없이 만들기 화면에 올라와 있으면 편집기에서 내림
  useEffect(() => {
    if (!savedAlbums.hydrated || albumView !== "create") return;
    if (!editingSavedAlbumId || albumEditOrigin === "confirmed") return;
    const album = savedAlbums.albums.find((a) => a.id === editingSavedAlbumId);
    if (album?.status === "saved") {
      resetAlbumEditor();
    }
  }, [
    savedAlbums.hydrated,
    savedAlbums.albums,
    albumView,
    editingSavedAlbumId,
    albumEditOrigin,
    resetAlbumEditor,
  ]);

  // 편집 화면에서만, 이미 열린 「임시」앨범을 자동 저장 (확정본은 자동으로 임시로 내리지 않음)
  const autoSyncSkipRef = useRef(false);
  const lastAutoSyncKeyRef = useRef("");
  useEffect(() => {
    if (!savedAlbums.hydrated || !albumEnabled) return;
    if (albumView !== "create") return;
    if (!editingSavedAlbumId) return;

    const existing = savedAlbums.albums.find((a) => a.id === editingSavedAlbumId);
    if (!existing) return;
    // 확정본을 만들기 탭에 올려 둔 채 자동 임시저장되면 확정→임시로 보이는 버그 발생
    if (existing.status === "saved") return;
    if (existing.status !== "draft") return;

    const photoCount = chapter3State.albumDays.reduce(
      (sum, day) => sum + day.places.reduce((s, place) => s + place.photos.length, 0),
      0,
    );
    const descriptionKey = chapter3State.albumDays
      .map((day) => day.places.map((place) => place.description || "").join("\u0001"))
      .join("\u0002");
    const hasDescription = chapter3State.albumDays.some((day) =>
      day.places.some((place) => Boolean(place.description?.trim())),
    );
    if (photoCount === 0 && !hasDescription) return;

    const syncKey = `${editingSavedAlbumId}:${photoCount}:${descriptionKey}:${albumTitleDraft}`;
    if (syncKey === lastAutoSyncKeyRef.current) return;

    const timer = window.setTimeout(() => {
      if (autoSyncSkipRef.current) {
        autoSyncSkipRef.current = false;
        lastAutoSyncKeyRef.current = syncKey;
        return;
      }
      const current = savedAlbums.albums.find((a) => a.id === editingSavedAlbumId);
      if (!current || current.status !== "draft") return;
      const saved = savedAlbums.upsertAlbum({
        id: current.id,
        title: albumTitleDraft.trim() || current.title || defaultAlbumTitle,
        status: "draft",
        kind: albumKindOf(current),
        sourcePlanId: current.sourcePlanId || editingSourcePlanId || albumPlanId,
        sourceLabel: current.sourceLabel || sourceLabel,
        days: withResolvedPlaceDescriptions(chapter3State.albumDays),
        originAlbumId: current.originAlbumId,
      });
      if (saved.id !== editingSavedAlbumId) {
        setEditingSavedAlbumId(saved.id);
      }
      lastAutoSyncKeyRef.current = `${saved.id}:${photoCount}:${descriptionKey}:${albumTitleDraft}`;
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [
    savedAlbums.hydrated,
    savedAlbums.albums,
    savedAlbums.upsertAlbum,
    albumEnabled,
    albumView,
    chapter3State.albumDays,
    editingSavedAlbumId,
    editingSourcePlanId,
    albumTitleDraft,
    defaultAlbumTitle,
    albumPlanId,
    sourceLabel,
  ]);

  // PC에서 원격(아이폰) 임시저장 앨범을 편집기에 반영
  const lastRemoteMergeRef = useRef("");
  useEffect(() => {
    if (!savedAlbums.hydrated || !albumPlanId) return;
    if (albumView !== "create") return;
    const remote = savedAlbums.albums.find(
      (a) => a.sourcePlanId === albumPlanId && a.status === "draft",
    );
    if (!remote) return;

    const mergeKey = `${remote.id}:${remote.updatedAt}`;
    if (mergeKey === lastRemoteMergeRef.current) return;

    const localCount = chapter3State.albumDays.reduce(
      (sum, day) => sum + day.places.reduce((s, place) => s + place.photos.length, 0),
      0,
    );
    const remoteCount = remote.days.reduce(
      (sum, day) => sum + day.places.reduce((s, place) => s + place.photos.length, 0),
      0,
    );
    if (remoteCount === 0) return;
    if (remoteCount < localCount) {
      lastRemoteMergeRef.current = mergeKey;
      return;
    }

    if (localCount === 0 || remoteCount > localCount) {
      autoSyncSkipRef.current = true;
      lastRemoteMergeRef.current = mergeKey;
      chapter3State.setAlbumDays(
        preservePlaceDescriptions(remote.days, chapter3State.albumDays),
      );
      setEditingSavedAlbumId(remote.id);
      setEditingSourcePlanId(remote.sourcePlanId || albumPlanId);
      setAlbumTitleDraft(remote.title);
      setAlbumEditOrigin(remote.originAlbumId ? "confirmed" : "draft");
    } else {
      lastRemoteMergeRef.current = mergeKey;
    }
  }, [savedAlbums.hydrated, savedAlbums.albums, albumPlanId, albumView, chapter3State]);

  const { config, isDomestic } = mapState;
  const simDays = config.days;
  const travelPlaces = travelPlacesDb.places;
  const migratedLegacyRef = useRef(false);

  useEffect(() => {
    if (!travelPlacesDb.hydrated || migratedLegacyRef.current) return;
    const legacy = config.travelPlaces ?? [];
    if (legacy.length > 0) {
      travelPlacesDb.mergePlaces(
        legacy.map((p) => ({ name: p.name, address: p.address })),
      );
      migratedLegacyRef.current = true;
    }
  }, [travelPlacesDb.hydrated, config.travelPlaces, travelPlacesDb]);

  const currentSimDay = useMemo(
    () => simDays.find((d) => d.day === selectedDay) || simDays[0],
    [simDays, selectedDay],
  );

  const mapAddressLookup = useMemo(() => {
    const lookup = buildSimAddressLookup(config);
    for (const p of travelPlaces) {
      if (p.name?.trim() && p.address?.trim()) {
        lookup.set(p.name.trim().toLowerCase().replace(/\s+/g, ""), p.address.trim());
      }
    }
    return lookup;
  }, [config, travelPlaces]);

  const dayRoutePlaces = useMemo(() => {
    if (!currentSimDay) return [];
    return buildSimDayRoutePlaces(currentSimDay, config, simDays.length);
  }, [currentSimDay, config, simDays.length]);

  const travelRoutePlaces = useMemo(
    () =>
      travelPlaces
        .filter((p) => p.name?.trim() || p.address?.trim())
        .map((p) => travelPlaceMapQuery(p)),
    [travelPlaces],
  );

  const showRegisteredRoutes =
    mapRouteMode === "registered" && travelRoutePlaces.length > 0;

  const activeMapPlaces = useMemo(
    () => (showRegisteredRoutes ? travelRoutePlaces : dayRoutePlaces),
    [showRegisteredRoutes, travelRoutePlaces, dayRoutePlaces],
  );

  const selectedTravelPlace = useMemo(() => {
    if (selectedPlaceId) {
      return travelPlaces.find((p) => p.id === selectedPlaceId) ?? null;
    }
    if (selectedPlace) {
      return travelPlaces.find((p) => travelPlaceLabel(p) === selectedPlace) ?? null;
    }
    return null;
  }, [selectedPlaceId, selectedPlace, travelPlaces]);

  const mapIsDomestic = useMemo(() => {
    if (!showRegisteredRoutes) return isDomestic;
    if (routePlaceIds.length > 0) {
      const selected = routePlaceIds
        .map((id) => travelPlaces.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      if (selected.length > 0) {
        return selected.every((p) => isDomesticPlaceRecord(p));
      }
    }
    if (selectedTravelPlace) return isDomesticPlaceRecord(selectedTravelPlace);
    const saved = travelPlaces.filter((p) => p.name.trim() || p.address.trim());
    if (saved.length === 0) return isDomestic;
    return saved.every((p) => isDomesticPlaceRecord(p));
  }, [showRegisteredRoutes, routePlaceIds, selectedTravelPlace, travelPlaces, isDomestic]);

  const displayMapPlaces = useMemo(() => {
    if (showRegisteredRoutes) {
      if (routePlaceIds.length > 0) {
        return routePlaceIds
          .map((id) => travelPlaces.find((p) => p.id === id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p) => travelPlaceMapQuery(p));
      }
      return [];
    }
    if (selectedTravelPlace && selectedPlace) {
      return [travelPlaceMapQuery(selectedTravelPlace)];
    }
    return activeMapPlaces;
  }, [
    showRegisteredRoutes,
    routePlaceIds,
    travelPlaces,
    selectedTravelPlace,
    selectedPlace,
    activeMapPlaces,
  ]);

  const selectedRouteMapPlaces = useMemo(() => {
    if (!showRegisteredRoutes) return [];
    return routePlaceIds
      .map((id) => travelPlaces.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .filter((p) => p.name?.trim() || p.address?.trim())
      .map((p) => travelPlaceMapQuery(p));
  }, [showRegisteredRoutes, routePlaceIds, travelPlaces]);

  const toggleRoutePlace = useCallback((placeId: string, mapLabel: string) => {
    setSelectedPlace(mapLabel);
    setSelectedPlaceId(placeId);
    if (onToggleSimPlaceId) {
      onToggleSimPlaceId(placeId);
    } else {
      setRoutePlaceIds((prev) =>
        prev.includes(placeId) ? prev.filter((id) => id !== placeId) : [...prev, placeId],
      );
    }
    window.setTimeout(() => {
      mapPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  }, [onToggleSimPlaceId]);

  // 4번 챕터에서 체크한 여행지를 등록 여행지 시뮬레이션에 동기화
  useEffect(() => {
    if (!selectedSimPlaceIds) return;
    setRoutePlaceIds(selectedSimPlaceIds);
    if (selectedSimPlaceIds.length > 0) {
      setMapRouteMode("registered");
      const lastId = selectedSimPlaceIds[selectedSimPlaceIds.length - 1];
      const place = travelPlacesDb.places.find((p) => p.id === lastId);
      if (place) {
        setSelectedPlaceId(place.id);
        setSelectedPlace(travelPlaceLabel(place));
      }
    }
  }, [selectedSimPlaceIds, travelPlacesDb.places]);

  const travelMapItems = useMemo(
    (): Chapter3MapPlaceItem[] =>
      travelPlaces
        .filter((p) => p.name?.trim() || p.address?.trim())
        .map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          kind: "destination" as const,
          icon: "📍",
          label: "여행지",
          day: 0,
        })),
    [travelPlaces],
  );

  const dayMapPlaces = useMemo(
    () => (currentSimDay ? currentSimDay.places.map((p) => simPlaceToMapItem(p, currentSimDay.day)) : []),
    [currentSimDay],
  );

  const nearbyAttractions = useMemo(
    () => dayMapPlaces.filter((p) => p.kind === "attraction"),
    [dayMapPlaces],
  );

  const schedulePlaces = useMemo(
    () => dayMapPlaces.filter((p) => p.kind !== "attraction"),
    [dayMapPlaces],
  );

  const routeLegs = useMemo(
    () => (currentSimDay ? buildSimRouteLegs(currentSimDay) : []),
    [currentSimDay],
  );

  const getQuery = useCallback(
    (placeName: string) => {
      const candidates = buildGeocodeQueryCandidatesForMap(
        placeName,
        config.regionHint,
        mapAddressLookup,
      );
      return candidates[0] || placeName;
    },
    [mapAddressLookup, config.regionHint],
  );

  const resolveMapEmbedQuery = useCallback(
    (label: string) => {
      if (selectedTravelPlace) return travelPlaceMapQuery(selectedTravelPlace);
      return getQuery(label);
    },
    [selectedTravelPlace, getQuery],
  );

  const getNaverDirectionsUrl = (places: string[]) => {
    if (places.length === 0) return "";
    return `https://map.naver.com/index.html?menu=route&sname=${encodeURIComponent(places[0])}&ename=${encodeURIComponent(places[places.length - 1])}`;
  };

  useEffect(() => {
    if (simDays.length > 0 && !simDays.some((d) => d.day === selectedDay)) {
      setSelectedDay(simDays[0].day);
    }
  }, [simDays, selectedDay]);

  useEffect(() => {
    if (!isDomestic || routeLegs.length === 0) return;
    let cancelled = false;

    const computeLegDistances = async () => {
      const next: Record<string, number> = {};
      for (const leg of routeLegs) {
        const key = `${leg.from}→${leg.to}`;
        try {
          const res = await fetch("/api/naver-geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              places: [getQuery(leg.from), getQuery(leg.to)],
              regionHint: config.regionHint,
            }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            coords?: { lat: number; lng: number }[];
          };
          if (data.ok && data.coords && data.coords.length >= 2) {
            const [a, b] = data.coords;
            next[key] = haversineKm(a.lat, a.lng, b.lat, b.lng);
          }
        } catch {
          // ignore
        }
      }
      if (!cancelled) setLegDistances(next);
    };

    void computeLegDistances();
    return () => {
      cancelled = true;
    };
  }, [routeLegs, isDomestic, getQuery, config.regionHint]);

  const renderGoogleMap = () => {
    if (displayMapPlaces.length === 0) return null;

    let mapSrc = "";
    if (selectedPlace) {
      mapSrc = `https://maps.google.com/maps?q=${encodeURIComponent(resolveMapEmbedQuery(selectedPlace))}&t=&z=16&ie=UTF8&iwloc=&output=embed`;
    } else if (displayMapPlaces.length >= 2) {
      const origin = resolveMapEmbedQuery(displayMapPlaces[0]);
      const dest = resolveMapEmbedQuery(displayMapPlaces[displayMapPlaces.length - 1]);
      const waypoints = displayMapPlaces.slice(1, displayMapPlaces.length - 1);
      const daddrStr =
        encodeURIComponent(dest) +
        waypoints.map((w) => "+to:" + encodeURIComponent(resolveMapEmbedQuery(w))).join("");
      mapSrc = `https://maps.google.com/maps?saddr=${encodeURIComponent(origin)}&daddr=${daddrStr}&dirflg=d&t=&z=14&ie=UTF8&iwloc=&output=embed`;
    } else {
      mapSrc = `https://maps.google.com/maps?q=${encodeURIComponent(resolveMapEmbedQuery(displayMapPlaces[0]))}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
    }

    return (
      <iframe
        width="100%"
        height="100%"
        style={{ border: "none", display: "block", minHeight: DAY_MAP_HEIGHT }}
        loading="lazy"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        src={mapSrc}
        title="Google Maps"
      />
    );
  };

  const renderSimPlaceEditor = (day: Chapter3SimDay, place: Chapter3SimPlace) => {
    const matchedDbId = travelPlaces.find(
      (p) =>
        place.name.trim() &&
        p.name.trim().toLowerCase() === place.name.trim().toLowerCase(),
    )?.id;

    return (
    <div key={place.id} className="chapter3SimPlaceRow">
      <select
        className="chapter3SimSelect"
        value={place.kind}
        onChange={(e) =>
          mapState.updatePlace(day.day, place.id, { kind: e.target.value as Chapter3PlaceKind })
        }
      >
        <option value="destination">목적지</option>
        <option value="accommodation">숙소</option>
        <option value="restaurant">식당</option>
        <option value="attraction">관광지</option>
      </select>
      <div className="chapter3SimPlaceLookup">
        <TravelPlaceLookupFields
          layout="row"
          autoSave={false}
          showAddToDbButton
          requireCompletePlace
          showAddressHint
          recordId={matchedDbId ?? `ch3-sim-${place.id}`}
          name={place.name}
          address={place.address}
          regionHint={config.regionHint}
          onNameChange={(value) => mapState.updatePlace(day.day, place.id, { name: value })}
          onAddressChange={(value) => mapState.updatePlace(day.day, place.id, { address: value })}
          namePlaceholder="장소명 (주소록 자동완성)"
          addressPlaceholder="주소 — 도로명 권장"
          onSaved={(record) => {
            if (record.name.trim() && record.address.trim()) {
              showPasteHint(`💾 4번 챕터 DB에 추가: ${record.name}`);
            }
          }}
        />
      </div>
      {place.kind !== "attraction" && (
        <input
          className="chapter3SimInput"
          value={place.transport || ""}
          placeholder="이동 수단"
          onChange={(e) => mapState.updatePlace(day.day, place.id, { transport: e.target.value })}
        />
      )}
      <button
        type="button"
        className="smallActionButton danger"
        onClick={() => mapState.removePlace(day.day, place.id)}
      >
        삭제
      </button>
    </div>
    );
  };

  const renderMapTab = () => {
    if (!currentSimDay) return null;

    const routeDaySegments =
      showRegisteredRoutes
        ? selectedRouteMapPlaces.length >= 2
          ? [
              {
                day: 0,
                color: getPlanDayColor(1),
                places: selectedRouteMapPlaces,
              },
            ]
          : []
        : buildSimRouteDaySegments(currentSimDay, config);

    const directionsPlaces =
      showRegisteredRoutes && selectedRouteMapPlaces.length >= 2
        ? selectedRouteMapPlaces
        : displayMapPlaces;

    return (
      <div className="chapter3MapSection">
        <div className="chapter3SimConfigBar">
          <label>
            여행지(지역)
            <input
              className="chapter3SimInput"
              value={config.regionHint}
              placeholder="예: 전주, 도쿄, 파리"
              onChange={(e) => mapState.updateConfigField("regionHint", e.target.value)}
            />
          </label>
          <label>
            출발지
            <input
              className="chapter3SimInput"
              value={config.departure}
              placeholder="출발지 주소 (선택)"
              onChange={(e) => mapState.updateConfigField("departure", e.target.value)}
            />
          </label>
          <div className="chapter3MapRegionToggle" role="group" aria-label="지도 지역">
            <button
              type="button"
              className={`chapter3MapModeButton ${isDomestic ? "active" : ""}`}
              onClick={() => mapState.setMapRegion("domestic")}
            >
              국내 · 네이버
            </button>
            <button
              type="button"
              className={`chapter3MapModeButton ${!isDomestic ? "active" : ""}`}
              onClick={() => mapState.setMapRegion("overseas")}
            >
              해외 · 구글
            </button>
          </div>
          <div className="chapter3SimActions">
            {isPlanConfirmed && dayPlans.length > 0 && (
              <button
                type="button"
                className="secondaryButton"
                onClick={() =>
                  mapState.importFromPlan(
                    dayPlans,
                    planRequest.destinations,
                    effectiveDeparture,
                    additionalTravelInfo,
                  )
                }
              >
                2번 계획서 불러오기
              </button>
            )}
            <button type="button" className="secondaryButton" onClick={mapState.addDay}>
              + 일차
            </button>
            <button type="button" className="secondaryButton" onClick={mapState.resetSimMap}>
              초기화
            </button>
          </div>
        </div>

        <p className="chapter3SimNotice">
          시뮬레이션 전용 지도입니다. 여기서 수정한 내용은 2번 챕터 계획서에 반영되지 않습니다.
          여행지 DB 공유 등록은 4번 챕터에서 관리합니다.
        </p>

        <div className="chapter3SimSavePanel">
          <div className="chapter3SimSaveBar">
            <label className="chapter3FieldLabel">
              시뮬레이션 제목
              <input
                className="chapter3SimInput"
                value={simSaveTitle}
                onChange={(e) => setSimSaveTitle(e.target.value)}
                placeholder={defaultSimTitle}
              />
            </label>
            <button type="button" className="gradientButton" onClick={handleSaveSimulation}>
              {editingSimId ? "시뮬레이션 업데이트" : "시뮬레이션 저장"}
            </button>
            {editingSimId && (
              <button
                type="button"
                className="secondaryButton"
                onClick={() => {
                  setEditingSimId(null);
                  setSimSaveTitle("");
                  mapState.resetSimMap();
                }}
              >
                새 시뮬레이션
              </button>
            )}
          </div>
          {liveRouteStats && liveRouteStats.totalDistanceMeters > 0 && (
            <div className="chapter3SimRoutePreview">
              <strong>현재 동선</strong>
              <span>
                총 {formatDistanceMeters(liveRouteStats.totalDistanceMeters)} ·{" "}
                {formatDurationMs(liveRouteStats.totalDurationMs)}
                {liveRouteStats.legs.length > 1
                  ? ` · ${liveRouteStats.legs.length}구간`
                  : ""}
              </span>
              <ul>
                {liveRouteStats.legs.map((leg, index) => {
                  const cumDist = liveRouteStats.legs
                    .slice(0, index + 1)
                    .reduce((s, item) => s + item.distanceMeters, 0);
                  const cumDur = liveRouteStats.legs
                    .slice(0, index + 1)
                    .reduce((s, item) => s + item.durationMs, 0);
                  return (
                    <li key={`${leg.from}-${leg.to}-${index}`}>
                      <span>
                        {index + 1}. {leg.from} → {leg.to}
                      </span>
                      <span>
                        단계 {formatDistanceMeters(leg.distanceMeters)} ·{" "}
                        {formatDurationMs(leg.durationMs)}
                      </span>
                      <span>
                        누적 {formatDistanceMeters(cumDist)} · {formatDurationMs(cumDur)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {savedSims.length > 0 && (
            <div className="chapter3SimSavedList">
              <strong>저장된 여행 지도</strong>
              <ul>
                {savedSims.map((sim) => (
                  <li key={sim.id} className={editingSimId === sim.id ? "active" : ""}>
                    <div>
                      <p>{sim.title}</p>
                      <small>
                        {formatSimSavedAt(sim.updatedAt)} · {sim.config.days?.length || 0}일 ·{" "}
                        {countSimPlaces(sim.config)}곳
                        {sim.routeStats && sim.routeStats.totalDistanceMeters > 0
                          ? ` · ${formatDistanceMeters(sim.routeStats.totalDistanceMeters)} · ${formatDurationMs(sim.routeStats.totalDurationMs)}`
                          : ""}
                      </small>
                      {sim.routeStats && sim.routeStats.legs.length > 0 && (
                        <div className="chapter3SimSavedLegs">
                          {sim.routeStats.legs.map((leg, index) => {
                            const cumDist = sim.routeStats!.legs
                              .slice(0, index + 1)
                              .reduce((s, item) => s + item.distanceMeters, 0);
                            const cumDur = sim.routeStats!.legs
                              .slice(0, index + 1)
                              .reduce((s, item) => s + item.durationMs, 0);
                            return (
                              <small key={`${sim.id}-leg-${index}`}>
                                {index + 1}. {leg.from} → {leg.to}: 단계{" "}
                                {formatDistanceMeters(leg.distanceMeters)}/
                                {formatDurationMs(leg.durationMs)} · 누적{" "}
                                {formatDistanceMeters(cumDist)}/{formatDurationMs(cumDur)}
                              </small>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="chapter3SimSavedActions">
                      <button
                        type="button"
                        className="smallActionButton"
                        onClick={() => handleLoadSimulation(sim)}
                      >
                        불러오기
                      </button>
                      <button
                        type="button"
                        className="smallActionButton danger"
                        onClick={() => handleDeleteSimulation(sim.id, sim.title)}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {travelRoutePlaces.length > 0 && (
          <div className="chapter3MapModeToggle" role="group" aria-label="지도 표시 모드">
            <button
              type="button"
              className={`chapter3MapModeButton ${mapRouteMode === "day" ? "active" : ""}`}
              onClick={() => {
                setMapRouteMode("day");
                setSelectedPlace(null);
                setSelectedPlaceId(null);
                setRoutePlaceIds([]);
              }}
            >
              일차 동선
            </button>
            <button
              type="button"
              className={`chapter3MapModeButton ${mapRouteMode === "registered" ? "active" : ""}`}
              onClick={() => {
                setMapRouteMode("registered");
                setSelectedPlace(null);
                setSelectedPlaceId(null);
              }}
            >
              등록 여행지
            </button>
          </div>
        )}

        <div className="chapter3DayTabs">
          {simDays.map((dp) => (
            <button
              key={dp.day}
              type="button"
              className={`chapter3DayTab ${selectedDay === dp.day ? "active" : ""}`}
              style={
                selectedDay === dp.day
                  ? { borderColor: getPlanDayColor(dp.day), color: getPlanDayColor(dp.day) }
                  : undefined
              }
              onClick={() => {
                setSelectedDay(dp.day);
                setSelectedPlace(null);
                setSelectedPlaceId(null);
                setMapRouteMode("day");
              }}
            >
              <input
                className="chapter3DayTabLabel"
                value={dp.dateLabel}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => mapState.updateDayLabel(dp.day, e.target.value)}
              />
              {simDays.length > 1 && (
                <span
                  className="chapter3DayTabRemove"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    mapState.removeDay(dp.day);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && mapState.removeDay(dp.day)}
                >
                  ×
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="chapter3SimEditor">
          <div className="chapter3SimEditorHead">
            <strong>{currentSimDay.dateLabel} 장소 입력 (1곳 이상)</strong>
            <div className="chapter3SimAddButtons">
              <button
                type="button"
                className="smallActionButton"
                onClick={() => mapState.addPlace(currentSimDay.day, "destination")}
              >
                + 목적지
              </button>
              <button
                type="button"
                className="smallActionButton"
                onClick={() => mapState.addPlace(currentSimDay.day, "accommodation")}
              >
                + 숙소
              </button>
              <button
                type="button"
                className="smallActionButton"
                onClick={() => mapState.addPlace(currentSimDay.day, "restaurant")}
              >
                + 식당
              </button>
              <button
                type="button"
                className="smallActionButton"
                onClick={() => mapState.addPlace(currentSimDay.day, "attraction")}
              >
                + 관광지
              </button>
            </div>
          </div>

          <TravelPlaceDbSearch
            placeholder="주소록(4번 DB)에서 검색 후 선택 — 복수 추가 가능"
            onSelect={(place) => {
              const exists = currentSimDay.places.some(
                (p) =>
                  (p.name.trim() === place.name.trim() &&
                    p.address.trim() === place.address.trim()) ||
                  (p.name.trim() === place.name.trim() && place.address.trim() && !p.address.trim()),
              );
              if (exists) {
                // 이름만 있고 주소 비어 있으면 주소만 채움
                const emptyAddr = currentSimDay.places.find(
                  (p) =>
                    p.name.trim() === place.name.trim() &&
                    !p.address.trim() &&
                    place.address.trim(),
                );
                if (emptyAddr) {
                  mapState.updatePlace(currentSimDay.day, emptyAddr.id, {
                    name: place.name,
                    address: place.address,
                  });
                }
                return;
              }
              mapState.addFilledPlace(currentSimDay.day, "destination", {
                name: place.name,
                address: place.address,
              });
            }}
          />

          {currentSimDay.places.length === 0 ? (
            <p className="chapter3Muted">
              위에서 주소록을 선택하거나 + 목적지로 장소를 추가하세요. 여행지명과 주소를 입력하면
              4번 챕터 주소록에 자동 저장됩니다.
            </p>
          ) : (
            currentSimDay.places.map((place) => renderSimPlaceEditor(currentSimDay, place))
          )}
        </div>

        <div className="chapter3MapLayout">
          <aside className="chapter3MapSidebar">
            {showRegisteredRoutes && travelMapItems.length > 0 && (
              <>
                <h4>📍 등록 여행지</h4>
                <p className="chapter3Muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                  동선에 넣을 장소를 순서대로 선택하세요. (2곳 이상 → 도로 기준 경로)
                </p>
                {routePlaceIds.length > 0 && (
                  <div className="chapter3MapToolbarActions" style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="smallActionButton"
                      onClick={() => {
                        if (onClearSimPlaceIds) onClearSimPlaceIds();
                        else setRoutePlaceIds([]);
                        setSelectedPlace(null);
                        setSelectedPlaceId(null);
                      }}
                    >
                      동선 선택 초기화 ({routePlaceIds.length})
                    </button>
                  </div>
                )}
                <div className="chapter3PlaceList">
                  {travelMapItems.map((item) => {
                    const place = travelPlaces.find((p) => p.id === item.id);
                    if (!place) return null;
                    const mapLabel = travelPlaceLabel(place);
                    const routeOrder = routePlaceIds.indexOf(place.id);
                    return (
                      <PlaceListItem
                        key={item.id}
                        item={item}
                        selected={routeOrder >= 0}
                        routeOrder={routeOrder >= 0 ? routeOrder + 1 : undefined}
                        showCheckbox
                        onSelect={() => toggleRoutePlace(place.id, mapLabel)}
                      />
                    );
                  })}
                </div>
              </>
            )}

            {!showRegisteredRoutes && (
              <>
            <h4>📍 일차별 장소</h4>
            <div className="chapter3PlaceList">
              {schedulePlaces.map((item) => {
                const sim = currentSimDay.places.find((p) => p.id === item.id);
                const mapLabel = sim ? simPlaceMapLabel(sim) : item.name;
                return (
                  <PlaceListItem
                    key={item.id}
                    item={item}
                    selected={selectedPlace === mapLabel}
                    onSelect={() => sim && setSelectedPlace(simPlaceMapLabel(sim))}
                  />
                );
              })}
              {schedulePlaces.length === 0 && (
                <p className="chapter3Muted">위에서 장소를 입력하세요.</p>
              )}
            </div>
              </>
            )}

            {!showRegisteredRoutes && routeLegs.length > 0 && (
              <>
                <h4>🚗 이동 구간</h4>
                <ul className="chapter3LegList">
                  {routeLegs.map((leg, index) => {
                    const liveLeg = liveRouteStats?.legs[index];
                    const distanceKm =
                      liveLeg && liveLeg.distanceMeters > 0
                        ? liveLeg.distanceMeters / 1000
                        : legDistances[`${leg.from}→${leg.to}`];
                    const durationMs = liveLeg?.durationMs;
                    const cumulative =
                      liveRouteStats?.legs.slice(0, index + 1).reduce(
                        (acc, item) => ({
                          distanceMeters: acc.distanceMeters + item.distanceMeters,
                          durationMs: acc.durationMs + item.durationMs,
                        }),
                        { distanceMeters: 0, durationMs: 0 },
                      );
                    return (
                      <RouteLegItem
                        key={`${leg.from}-${leg.to}`}
                        leg={leg}
                        stepIndex={index + 1}
                        distanceKm={distanceKm}
                        durationMs={durationMs}
                        cumulativeDistanceMeters={cumulative?.distanceMeters}
                        cumulativeDurationMs={cumulative?.durationMs}
                      />
                    );
                  })}
                </ul>
                {liveRouteStats && liveRouteStats.totalDistanceMeters > 0 && (
                  <p className="chapter3RouteTotal">
                    누적 합계{" "}
                    <strong>{formatDistanceMeters(liveRouteStats.totalDistanceMeters)}</strong>
                    {" · "}
                    <strong>{formatDurationMs(liveRouteStats.totalDurationMs)}</strong>
                  </p>
                )}
              </>
            )}

            {showRegisteredRoutes && liveRouteStats && liveRouteStats.legs.length > 0 && (
              <>
                <h4>🚗 선택 동선 · 거리/시간</h4>
                <ul className="chapter3LegList">
                  {liveRouteStats.legs.map((leg, index) => {
                    const cumulative = liveRouteStats.legs.slice(0, index + 1).reduce(
                      (acc, item) => ({
                        distanceMeters: acc.distanceMeters + item.distanceMeters,
                        durationMs: acc.durationMs + item.durationMs,
                      }),
                      { distanceMeters: 0, durationMs: 0 },
                    );
                    return (
                      <RouteLegItem
                        key={`${leg.from}-${leg.to}-${index}`}
                        leg={{
                          from: leg.from,
                          to: leg.to,
                          transport: "자동차",
                          day: 0,
                        }}
                        stepIndex={index + 1}
                        distanceKm={leg.distanceMeters / 1000}
                        durationMs={leg.durationMs}
                        cumulativeDistanceMeters={cumulative.distanceMeters}
                        cumulativeDurationMs={cumulative.durationMs}
                      />
                    );
                  })}
                </ul>
                <p className="chapter3RouteTotal">
                  누적 합계{" "}
                  <strong>{formatDistanceMeters(liveRouteStats.totalDistanceMeters)}</strong>
                  {" · "}
                  <strong>{formatDurationMs(liveRouteStats.totalDurationMs)}</strong>
                </p>
              </>
            )}

            {!showRegisteredRoutes && nearbyAttractions.length > 0 && (
              <>
                <h4>🎯 주변 관광지</h4>
                <div className="chapter3PlaceList">
                  {nearbyAttractions.map((item) => {
                    const sim = currentSimDay.places.find((p) => p.id === item.id);
                    const mapLabel = sim ? simPlaceMapLabel(sim) : item.name;
                    return (
                      <PlaceListItem
                        key={item.id}
                        item={item}
                        selected={selectedPlace === mapLabel}
                        onSelect={() => sim && setSelectedPlace(simPlaceMapLabel(sim))}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </aside>

          <div className="chapter3MapPanel" ref={mapPanelRef}>
            <div className="chapter3MapToolbar">
              <strong>
                {showRegisteredRoutes
                  ? selectedRouteMapPlaces.length >= 2
                    ? `선택 ${selectedRouteMapPlaces.length}곳 도로 동선 — ${mapIsDomestic ? "네이버 지도" : "구글 지도"}`
                    : `등록 여행지 ${travelRoutePlaces.length}곳 — ${mapIsDomestic ? "네이버 지도" : "구글 지도"}`
                  : `${currentSimDay.dateLabel} — ${mapIsDomestic ? "네이버 지도" : "구글 지도"}`}
              </strong>
              <div className="chapter3MapToolbarActions">
                {(selectedPlace || routePlaceIds.length > 0) && (
                  <button
                    type="button"
                    className="smallActionButton"
                    onClick={() => {
                      setSelectedPlace(null);
                      setSelectedPlaceId(null);
                      setRoutePlaceIds([]);
                    }}
                  >
                    {showRegisteredRoutes ? "선택·동선 해제" : "전체 보기"}
                  </button>
                )}
                {mapIsDomestic && directionsPlaces.length >= 2 && (
                  <a
                    href={getNaverDirectionsUrl(directionsPlaces)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chapter3NaverLink"
                  >
                    네이버 길찾기 ↗
                  </a>
                )}
              </div>
            </div>
            {displayMapPlaces.length > 0 ? (
              mapIsDomestic ? (
                <NaverMap
                  places={displayMapPlaces}
                  selectedPlace={
                    selectedPlace
                      ? toMapPlaceKey(0, selectedPlace)
                      : null
                  }
                  day={showRegisteredRoutes ? 0 : currentSimDay.day}
                  height={DAY_MAP_HEIGHT}
                  regionHint={config.regionHint}
                  addressLookup={mapAddressLookup}
                  routeDaySegments={routeDaySegments}
                  markerVariant={showRegisteredRoutes ? "red-dot" : "numbered"}
                  drawRoutes={
                    showRegisteredRoutes
                      ? selectedRouteMapPlaces.length >= 2
                      : true
                  }
                  roadRoutesOnly={showRegisteredRoutes}
                  onRouteMetrics={handleRouteMetrics}
                  onSaveManualAddresses={mapState.saveManualAddresses}
                  onClearSelection={() => {
                    setSelectedPlace(null);
                    setSelectedPlaceId(null);
                    setLiveRouteMetrics(null);
                    if (onClearSimPlaceIds) onClearSimPlaceIds();
                    else setRoutePlaceIds([]);
                  }}
                />
              ) : showRegisteredRoutes ? (
                <OverseasPlacesMap
                  height={DAY_MAP_HEIGHT}
                  regionHint={config.regionHint}
                  selectedId={selectedPlaceId}
                  places={routePlaceIds
                    .map((id) => travelPlaces.find((p) => p.id === id))
                    .filter((p): p is NonNullable<typeof p> => Boolean(p))
                    .map((p) => ({
                      id: p.id,
                      label: travelPlaceLabel(p),
                      query: travelPlaceMapQuery(p),
                      address: p.address,
                    }))}
                />
              ) : (
                renderGoogleMap()
              )
            ) : (
              <EmptyState
                icon="📍"
                text={
                  showRegisteredRoutes
                    ? "체크한 여행지가 없습니다. 왼쪽에서 장소를 선택하면 빨간 원으로 표시됩니다."
                    : "여행지명과 주소를 입력하면 지도에 표시됩니다."
                }
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderAlbumContent = () => {
    const orderedDays = sortAlbumDaysByDate(chapter3State.albumDays);
    return (
    <div className="chapter3AlbumSection">
      <Chapter3AlbumExifUpload
        completedRounds={photoUploadRounds}
        canSave={chapter3State.albumDays.some((day) =>
          day.places.some((place) => place.photos.length > 0),
        )}
        onUploaded={async (files, reportProgress) => {
          const result = await chapter3State.addPhotosToPlace(0, "", files, {
            uploadBatch: { completedRounds: photoUploadRounds },
            onProgress: reportProgress,
          });
          if (result.status === "added") {
            setPhotoUploadRounds((current) => Math.min(ALBUM_UPLOAD_MAX_ROUNDS, current + 1));
          }
          return result;
        }}
        onSaveDraft={() => handleSaveAlbum("draft", { stay: true })}
        onConfirm={() => handleSaveAlbum("saved")}
      />
      <div className="chapter3AlbumDayToolbar">
        <p className="chapter3AlbumDayToolbarHint">
          사진은 촬영일별로 나뉩니다. 일차를 직접 추가하거나 날짜를 고칠 수도 있습니다.
        </p>
        <div className="chapter3DayTabs">
          {orderedDays.map((day) => (
              <button
                key={day.day}
                type="button"
                className={`chapter3DayTab ${
                  chapter3State.expandedDay === day.day ? "active" : ""
                }`}
                onClick={() => chapter3State.setExpandedDay(day.day)}
              >
                {formatDateSlash(resolveAlbumDayDateIso(day)) || day.dateLabel || `${day.day}일차`}
                {chapter3State.albumDays.length > 1 && (
                  <span
                    className="chapter3DayTabRemove"
                    role="button"
                    tabIndex={0}
                    aria-label={`${day.day}일차 삭제`}
                    onClick={(e) => {
                      e.stopPropagation();
                      chapter3State.removeAlbumDay(day.day);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        chapter3State.removeAlbumDay(day.day);
                      }
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          <button
            type="button"
            className="chapter3DayTab chapter3DayTabAdd"
            onClick={() => {
              chapter3State.addAlbumDay();
              const nextDay =
                chapter3State.albumDays.length > 0
                  ? Math.max(...chapter3State.albumDays.map((d) => d.day)) + 1
                  : 1;
              chapter3State.setExpandedDay(nextDay);
            }}
          >
            + 일차
          </button>
        </div>
      </div>

      {orderedDays.map((day) => (
        <section key={day.day} className="chapter3AlbumDay">
          <button
            type="button"
            className="chapter3AlbumDayHeader"
            onClick={() =>
              chapter3State.setExpandedDay(chapter3State.expandedDay === day.day ? null : day.day)
            }
          >
            <span className="chapter3AlbumDayTitle">
              {formatDateSlash(resolveAlbumDayDateIso(day)) || day.dateLabel}
            </span>
            <span className="chapter3AlbumDayMeta">
              {day.places.length}개 장소 ·{" "}
              {day.places.reduce((n, p) => n + p.photos.length, 0)}장 사진
            </span>
            <span>{chapter3State.expandedDay === day.day ? "▲" : "▼"}</span>
          </button>

          {chapter3State.expandedDay === day.day && (
            <div className="chapter3AlbumDayBody">
              <div className="chapter3AlbumDayDateRow">
                <label className="chapter3FieldLabel">
                  여행 일자
                  <input
                    type="date"
                    className="chapter3SimInput"
                    value={resolveAlbumDayDateIso(day)}
                    onChange={(e) => chapter3State.updateAlbumDayDate(day.day, e.target.value)}
                  />
                </label>
                {resolveAlbumDayDateIso(day) && (
                  <span className="chapter3DateSlashLabel">
                    {formatDateSlash(resolveAlbumDayDateIso(day))}
                  </span>
                )}
                {chapter3State.albumDays.length > 1 && (
                  <button
                    type="button"
                    className="smallDangerButton chapter3AlbumDayDeleteBtn"
                    onClick={() => chapter3State.removeAlbumDay(day.day)}
                  >
                    이 일차 삭제
                  </button>
                )}
              </div>
              {day.places.length === 0 ? (
                <p className="chapter3Muted">일정에 장소를 입력하면 앨범에 표시됩니다.</p>
              ) : (
                day.places.map((place) => {
                  const photoPlacePhotos = photosForPlaceDescription(place, day);
                  const photoPlaces = collectPhotoPlaceNames(photoPlacePhotos);
                  const extraMemo = isAutoPhotoPlaceDescription(
                    place.description,
                    photoPlacePhotos,
                  )
                    ? ""
                    : place.description || "";
                  return (
                  <article key={place.id} className="chapter3AlbumPlace">
                    <button
                      type="button"
                      className="chapter3AlbumPlaceHeader"
                      onClick={() =>
                        chapter3State.setExpandedPlaceId(
                          chapter3State.expandedPlaceId === place.id ? null : place.id,
                        )
                      }
                    >
                      <span>
                        {place.kind === "accommodation" ? "🏨" : place.kind === "restaurant" ? "🍽️" : "📍"}{" "}
                        {place.name}
                      </span>
                      <span className="chapter3AlbumPhotoCount">{place.photos.length}장</span>
                    </button>

                    {chapter3State.expandedPlaceId === place.id && (
                      <div className="chapter3AlbumPlaceBody">
                        {place.address && (
                          <p className="chapter3PlaceAddress">📫 {place.address}</p>
                        )}
                        <div className="chapter3FieldLabel">
                          장소 설명
                          {photoPlaces.length > 0 ? (
                            <div className="chapter3AlbumPhotoPlaces">
                              {photoPlaces.map((name) => (
                                <p key={name} className="chapter3AlbumPhotoPlaceItem">
                                  {name}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="chapter3Muted">
                              이 일자 사진의 촬영 위치(GPS·주소)가 여기에 표시됩니다.
                            </p>
                          )}
                        </div>
                        <label className="chapter3FieldLabel">
                          추가 메모
                          <textarea
                            className="chapter3Textarea"
                            value={extraMemo}
                            placeholder="이 장소에 대한 메모를 남길 수 있습니다. (선택)"
                            onChange={(e) =>
                              chapter3State.updatePlaceDescription(day.day, place.id, e.target.value)
                            }
                          />
                        </label>

                        <Chapter3PhotoAlbumPanel
                          day={day.day}
                          placeId={place.id}
                          placeName={place.name}
                          photos={place.photos}
                          albumState={chapter3State}
                          defaultOpen
                          regionHint={config.regionHint || planRequest.destinations}
                        />
                      </div>
                    )}
                  </article>
                  );
                })
              )}
              <Chapter3DayPhotoLocationMap
                photos={day.places.flatMap((p) => p.photos)}
                day={day.day}
                albumState={chapter3State}
              />
            </div>
          )}
        </section>
      ))}
    </div>
    );
  };

  const renderAlbumListHandlers = {
    onDelete: (id: string) => {
      const album = savedAlbums.albums.find((a) => a.id === id);
      const planKey = album?.sourcePlanId || null;
      savedAlbums.deleteAlbum(id);
      const remaining = savedAlbums.albums.filter((item) => item.id !== id);
      const planStillUsed = Boolean(
        planKey && remaining.some((item) => item.sourcePlanId === planKey),
      );
      if (editingSavedAlbumId === id) {
        resetAlbumEditor({ clearPlanStorage: planStillUsed ? null : planKey });
      } else if (planKey && !planStillUsed && album?.status === "saved") {
        removeChapter3Album(planKey);
      }
      if (album?.status === "draft" && !album.originAlbumId && !planStillUsed) {
        const tripId = parseManualTripIdFromPlanId(planKey || "");
        if (tripId && manualState.trips.some((t) => t.id === tripId)) {
          manualState.removeTrip(tripId, { silent: true });
        }
      }
      showPasteHint("🗑️ 앨범을 삭제했습니다. 확정 앨범 목록 아래에서 복원할 수 있습니다.");
    },
    onUpdateTitle: (id: string, title: string) => {
      savedAlbums.updateAlbumMeta(id, { title });
      if (editingSavedAlbumId === id) setAlbumTitleDraft(title);
      showPasteHint("✏️ 앨범 제목을 수정했습니다.");
    },
    onUpdatePhotoMemo: (albumId: string, photoId: string, memo: string) => {
      savedAlbums.updateAlbumPhotoMemo(albumId, photoId, memo);
    },
    onSaveFullBackup: async (
      album: SavedTravelAlbum,
      onProgress: (done: number, total: number) => void,
    ) => {
      try {
        const result = await saveAlbumFullBackup(album, onProgress);
        showPasteHint(
          `💾 「${album.title}」 PC 완전 백업 ${result.saved}장을 다운로드 폴더에 저장했습니다. zip을 지우지 마세요.`,
        );
      } catch (error) {
        console.error("album full backup failed", error);
        const message = error instanceof Error ? error.message : "";
        showPasteHint(message ? `⚠️ ${message}` : "⚠️ PC 완전 백업에 실패했습니다.");
      }
    },
    onSaveAllFullBackup: async (
      albums: SavedTravelAlbum[],
      onProgress: (done: number, total: number, albumTitle?: string) => void,
    ) => {
      try {
        const result = await saveAllAlbumsFullBackup(albums, (progress) => {
          onProgress(progress.done, progress.total, progress.albumTitle);
        });
        showPasteHint(
          `💾 전체 PC 백업: 앨범 ${result.albumCount}개·사진 ${result.photoCount}장. zip을 지우지 마세요.`,
        );
      } catch (error) {
        console.error("all albums full backup failed", error);
        const message = error instanceof Error ? error.message : "";
        showPasteHint(message ? `⚠️ ${message}` : "⚠️ 전체 PC 백업에 실패했습니다.");
      }
    },
    onSharePdf: async (album: SavedTravelAlbum) => {
      const ok = await openTravelAlbumPdfWindow(album);
      if (ok) {
        showPasteHint(
          "📄 PDF를 준비했습니다. 아이폰은 공유→굿노트, PC는 파일 저장 후 가져오세요.",
        );
      } else {
        showPasteHint("⚠️ PDF를 만들지 못했습니다. 팝업 차단·네트워크를 확인해 주세요.");
      }
    },
  };

  const appFileInputRef = useRef<HTMLInputElement>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const [backupImportBusy, setBackupImportBusy] = useState(false);

  const handleImportAppFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const album = prepareImportedAlbum(parseAlbumAppFile(await file.text()));
      savedAlbums.upsertAlbum({
        id: album.id,
        title: album.title,
        status: "saved",
        kind: albumKind,
        sourcePlanId: album.sourcePlanId,
        sourceLabel: album.sourceLabel,
        days: album.days,
      });
      setLibraryFilter("saved");
      setAlbumView("library");
      showPasteHint(`📂 「${album.title}」 앱파일을 불러와 확정 앨범에 넣었습니다.`);
    } catch (error) {
      console.error("album app file import failed", error);
      showPasteHint("⚠️ 여행 앨범 앱파일이 아닙니다. 저장한 파일을 다시 선택해 주세요.");
    }
  };

  const handleImportFullBackup = async (file: File | undefined) => {
    if (!file) return;
    setBackupImportBusy(true);
    try {
      const result = await importAlbumFullBackupZip(file, (done, total) => {
        showPasteHint(`📂 PC 백업 불러오는 중 ${done}/${total}…`);
      });
      for (const album of result.albums) {
        savedAlbums.upsertAlbum({
          id: album.id,
          title: album.title,
          status: "saved",
          kind: albumKindOf(album) === "personal" ? "personal" : albumKind,
          sourcePlanId: album.sourcePlanId,
          sourceLabel: album.sourceLabel,
          days: album.days,
        });
      }
      setLibraryFilter("saved");
      setAlbumView("library");
      const names = result.albums.map((album) => album.title).join(", ");
      const how =
        result.mode === "links"
          ? "기존 Drive 사진 링크로"
          : "zip 사진을 Drive에 다시 올려";
      const message = `✅ 「${names}」 ${result.photoCount}장을 ${how} 불러왔습니다.`;
      showPasteHint(message);
      window.alert(message);
    } catch (error) {
      console.error("album full backup import failed", error);
      const message = error instanceof Error ? error.message : "";
      const text = message
        ? `PC 백업 불러오기 실패: ${message}`
        : "PC 완전 백업을 불러오지 못했습니다. Drive 연결과 zip 파일을 확인해 주세요.";
      showPasteHint(`⚠️ ${text}`);
      window.alert(text);
    } finally {
      setBackupImportBusy(false);
    }
  };

  const handleRestoreAlbum = (id: string) => {
    const restored = savedAlbums.restoreAlbum(id);
    if (!restored) {
      showPasteHint("⚠️ 복원할 앨범을 찾지 못했습니다.");
      return;
    }
    showPasteHint(`✅ 「${restored.title}」 앨범을 복원했습니다. 사진은 저장된 링크로 다시 엽니다.`);
    setLibraryFilter(restored.status === "draft" ? "draft" : "saved");
    setAlbumView("library");
  };

  const handleRestoreAllDeletedAlbums = () => {
    const restored = savedAlbums.restoreAllDeletedAlbums();
    if (restored.length === 0) {
      showPasteHint("⚠️ 복원할 삭제 앨범이 없습니다.");
      return;
    }
    const names = restored.map((album) => `「${album.title}」`).join(", ");
    showPasteHint(`✅ 삭제 앨범 ${restored.length}개를 복원했습니다. ${names}`);
    setLibraryFilter("saved");
    setAlbumView("library");
  };

  const defaultSimTitle = useMemo(() => {
    const region = config.regionHint?.trim() || "여행";
    return `${region} 지도 시뮬레이션`;
  }, [config.regionHint]);

  const handleRouteMetrics = useCallback((metrics: NaverRouteMetrics | null) => {
    setLiveRouteMetrics(metrics);
  }, []);

  const liveRouteStats = useMemo((): SavedSimRouteStats | null => {
    if (!liveRouteMetrics || liveRouteMetrics.legs.length === 0) return null;
    const names = liveRouteMetrics.placeNames;
    const legs = liveRouteMetrics.legs.map((leg, index) => ({
      from: names[index] || `구간 ${index + 1} 출발`,
      to: names[index + 1] || `구간 ${index + 1} 도착`,
      distanceMeters: leg.distanceMeters,
      durationMs: leg.durationMs,
    }));
    return {
      legs,
      totalDistanceMeters: liveRouteMetrics.distanceMeters,
      totalDurationMs: liveRouteMetrics.durationMs,
      computedAt: new Date().toISOString(),
    };
  }, [liveRouteMetrics]);

  const handleSaveSimulation = useCallback(() => {
    const placeCount = countSimPlaces(config);
    if (placeCount === 0) {
      showPasteHint("⚠️ 장소를 1곳 이상 입력한 뒤 시뮬레이션을 저장해 주세요.");
      return;
    }
    const saved = upsertSavedSim({
      id: editingSimId || undefined,
      title: simSaveTitle.trim() || defaultSimTitle,
      config,
      routeStats: liveRouteStats,
    });
    setSavedSims(readSavedSims());
    setEditingSimId(saved.id);
    setSimSaveTitle(saved.title);
    const statsHint =
      saved.routeStats && saved.routeStats.totalDistanceMeters > 0
        ? ` · ${formatDistanceMeters(saved.routeStats.totalDistanceMeters)} · ${formatDurationMs(saved.routeStats.totalDurationMs)}`
        : "";
    showPasteHint(`💾 여행 지도에 시뮬레이션을 저장했습니다: ${saved.title}${statsHint}`);
  }, [config, editingSimId, simSaveTitle, defaultSimTitle, showPasteHint, liveRouteStats]);

  const handleLoadSimulation = useCallback(
    (sim: SavedSimMap) => {
      mapState.loadSimConfig(sim.config, `📋 「${sim.title}」 시뮬레이션을 불러왔습니다.`);
      setEditingSimId(sim.id);
      setSimSaveTitle(sim.title);
      const firstDay = sim.config.days?.[0]?.day ?? 1;
      setSelectedDay(firstDay);
      setMapRouteMode("day");
      setSelectedPlace(null);
      setSelectedPlaceId(null);
    },
    [mapState],
  );

  const handleDeleteSimulation = useCallback(
    (id: string, title: string) => {
      if (!window.confirm(`「${title}」 시뮬레이션을 삭제할까요?`)) return;
      deleteSavedSim(id);
      setSavedSims(readSavedSims());
      if (editingSimId === id) {
        setEditingSimId(null);
        setSimSaveTitle("");
      }
      showPasteHint("🗑️ 저장된 시뮬레이션을 삭제했습니다.");
    },
    [editingSimId, showPasteHint],
  );

  const editingAlbum = editingSavedAlbumId
    ? savedAlbums.albums.find((a) => a.id === editingSavedAlbumId)
    : null;
  const resolvedEditOrigin: AlbumEditOrigin | null =
    albumEditOrigin ||
    (editingAlbum?.originAlbumId
      ? "confirmed"
      : editingAlbum?.status === "draft"
        ? "draft"
        : null);
  const confirmedAlbumForPlan = useMemo(() => {
    if (forceAlbumEdit) return null;
    if (editingSavedAlbumId && resolvedEditOrigin) return null;
    const planKey = editingSourcePlanId || albumPlanId;
    if (!planKey) return null;
    const tripId = parseManualTripIdFromPlanId(planKey);
    return (
      savedAlbums.albums.find(
        (album) =>
          album.status === "saved" &&
          (album.sourcePlanId === planKey ||
            (tripId != null &&
              parseManualTripIdFromPlanId(album.sourcePlanId || "") === tripId)),
      ) || null
    );
  }, [
    forceAlbumEdit,
    editingSavedAlbumId,
    resolvedEditOrigin,
    editingSourcePlanId,
    albumPlanId,
    savedAlbums.albums,
  ]);
  const usePlaceAlbumEditor =
    Boolean(editingSavedAlbumId && chapter3State.albumDays.length > 0) ||
    (manualState.activeSource !== "manual" &&
      (isPlanConfirmed || forceAlbumEdit) &&
      chapter3State.albumDays.length > 0 &&
      !confirmedAlbumForPlan);

  const renderAlbumTab = () => (
    <div className="chapter3AlbumTab">
      <nav
        className="chapter3AlbumSourceNav"
        aria-label={isPersonalAlbum ? "개인 앨범 보기" : "여행 앨범 보기"}
      >
        <button
          type="button"
          className={albumView === "library" && libraryFilter === "saved" ? "active" : ""}
          onClick={() => {
            setLibraryFilter("saved");
            setAlbumView("library");
          }}
        >
          확정 ({savedAlbumList.length})
        </button>
        <button
          type="button"
          className={albumView === "library" && libraryFilter === "draft" ? "active" : ""}
          onClick={() => {
            setLibraryFilter("draft");
            setAlbumView("library");
          }}
        >
          작업 중 ({draftAlbumList.length})
        </button>
        <button
          type="button"
          className={albumView === "create" ? "active" : ""}
          onClick={() => {
            setAlbumView("create");
            if (!editingSavedAlbumId && !isFreshAlbumPlanId(editingSourcePlanId)) {
              rebindAlbumForPlanId(editingSourcePlanId || albumPlanId, { silent: true });
            }
          }}
        >
          {editingSavedAlbumId ? "편집" : "새 앨범"}
        </button>
      </nav>

      {/* 확정·새 앨범 어느 탭에서도 Drive 연결이 보이도록 (이전엔 library만) */}
      <div className="chapter3DriveBanner" role="status">
        {driveConnected ? (
          <p className="chapter3DriveBannerText">Google Drive 연결됨 — 압축 앨범을 Drive에서 엽니다.</p>
        ) : (
          <>
                <p className="chapter3DriveBannerText">
                  저장 공간이 부족하면 압축본을 Google Drive로 옮깁니다. 먼저 연결해 주세요.
                  Google 경고 화면에서는 큰 파란 버튼이 아니라 왼쪽 「계속」을 누른 뒤 「허용」하세요.
                  허용 후에도 이 버튼이 남으면 Google 계정 → 보안 → 제3자 액세스에서
                  「iphone-calendar-drive」를 삭제한 뒤 다시 연결하세요.
                </p>
            <button
              type="button"
              className="chapter3DriveBannerButton"
              onClick={() => {
                window.location.href = "/api/google-drive/start";
              }}
            >
              Google Drive 연결
            </button>
          </>
        )}
      </div>

      {albumView === "library" ? (
        <>
          <nav className="chapter3AlbumLibraryFilter" aria-label="앨범 상태 필터">
            <button
              type="button"
              className={libraryFilter === "saved" ? "active" : ""}
              onClick={() => setLibraryFilter("saved")}
            >
              확정 ({savedAlbumList.length})
            </button>
            <button
              type="button"
              className={libraryFilter === "draft" ? "active" : ""}
              onClick={() => setLibraryFilter("draft")}
            >
              작업 중 ({draftAlbumList.length})
            </button>
          </nav>

          <div className="chapter3AlbumCreateToolbar">
            <button type="button" className="gradientButton chapter3AlbumToolbarPrimary" onClick={startNewAlbum}>
              새 앨범
            </button>
            <button
              type="button"
              className="secondaryButton"
              onClick={() => appFileInputRef.current?.click()}
            >
              앱파일 불러오기
            </button>
            <button
              type="button"
              className="secondaryButton"
              disabled={backupImportBusy}
              title="PC에 저장한 .완전백업.zip을 불러와 Drive에 사진을 다시 올립니다."
              onClick={() => backupFileInputRef.current?.click()}
            >
              {backupImportBusy ? "백업 불러오는 중…" : "PC 백업 불러오기"}
            </button>
            <input
              ref={appFileInputRef}
              type="file"
              accept="application/json,.json,.traveldiary.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void handleImportAppFile(file);
              }}
            />
            <input
              ref={backupFileInputRef}
              type="file"
              accept="application/zip,.zip,.완전백업.zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void handleImportFullBackup(file);
              }}
            />
          </div>

          {libraryFilter === "saved" ? (
            <Chapter3SavedAlbumList
              variant="saved"
              albums={savedAlbumList}
              draftAlbums={draftAlbumList}
              deletedAlbums={kindDeletedAlbums}
              syncStatus={savedAlbums.syncStatus}
              enableGroupBy={isPersonalAlbum}
              emptyMessage={
                isPersonalAlbum
                  ? "확정된 개인앨범이 없습니다. 「새 앨범」에서 작성 후 「확정」을 눌러 주세요."
                  : undefined
              }
              onEdit={handleEditSavedAlbum}
              onRestore={handleRestoreAlbum}
              onRestoreAll={handleRestoreAllDeletedAlbums}
              {...renderAlbumListHandlers}
            />
          ) : (
            <Chapter3SavedAlbumList
              variant="draft"
              albums={draftAlbumList}
              syncStatus={savedAlbums.syncStatus}
              enableGroupBy={isPersonalAlbum}
              emptyMessage={
                isPersonalAlbum
                  ? "작업 중 개인앨범이 없습니다. 편집 중 「작업 중 저장」을 누르면 여기에 표시됩니다."
                  : undefined
              }
              onResume={handleResumeDraftAlbum}
              {...renderAlbumListHandlers}
            />
          )}
        </>
      ) : (
        <>
          {resolvedEditOrigin === "confirmed" && (
            <div
              className="chapter3AlbumEditingBanner chapter3AlbumEditingBannerConfirmed"
              role="status"
            >
              <strong>확정 앨범 수정 중</strong>
              <span>— {albumTitleDraft || defaultAlbumTitle} (작업 중으로 저장됩니다)</span>
            </div>
          )}
          {resolvedEditOrigin === "draft" && (
            <div
              className="chapter3AlbumEditingBanner chapter3AlbumEditingBannerDraft"
              role="status"
            >
              <strong>작업 중 앨범 편집</strong>
              <span>— {albumTitleDraft || defaultAlbumTitle}</span>
            </div>
          )}

          <div className="chapter3AlbumCreateToolbar">
            <button
              type="button"
              className="secondaryButton"
              onClick={() => {
                setLibraryFilter("saved");
                setAlbumView("library");
              }}
            >
              ← 확정 ({savedAlbumList.length})
            </button>
            <button type="button" className="secondaryButton" onClick={startNewAlbum}>
              새 앨범
            </button>
          </div>

          {!personalOnly && (
            <nav className="chapter3AlbumSourceNav" aria-label="앨범 계획서 출처">
              <button
                type="button"
                className={manualState.activeSource === "chapter2" ? "active" : ""}
                onClick={() => {
                  setForceAlbumEdit(false);
                  manualState.setAlbumSource("chapter2");
                }}
              >
                2번 챕터 확정 계획서
              </button>
              <button
                type="button"
                className={manualState.activeSource === "manual" ? "active" : ""}
                onClick={() => {
                  setForceAlbumEdit(false);
                  manualState.setAlbumSource("manual");
                  if (!manualState.activeTripId && manualState.trips.length === 0) {
                    manualState.addTrip();
                  }
                }}
              >
                수동 입력 (기존 여행)
              </button>
            </nav>
          )}

          {(albumEnabled || chapter3State.albumDays.length > 0) &&
            (resolvedEditOrigin || !confirmedAlbumForPlan) && (
            <div className="chapter3AlbumSaveBar">
              <label className="chapter3FieldLabel">
                앨범 제목
                <input
                  type="text"
                  value={albumTitleDraft}
                  onChange={(e) => setAlbumTitleDraft(e.target.value)}
                  placeholder={isPersonalAlbum ? "개인앨범 제목" : "여행 앨범 제목"}
                />
              </label>
              <div className="chapter3AlbumSaveActions">
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => handleSaveAlbum("draft", { stay: true })}
                >
                  작업 중 저장
                </button>
                <button
                  type="button"
                  className="gradientButton"
                  onClick={() => handleSaveAlbum("saved")}
                >
                  {resolvedEditOrigin === "confirmed" ? "확정에 반영" : "확정"}
                </button>
              </div>
              <p className="chapter3Muted">{savedAlbums.syncStatus}</p>
            </div>
          )}

          {forceAlbumEdit || usePlaceAlbumEditor || personalOnly ? (
            personalOnly && !forceAlbumEdit && chapter3State.albumDays.length === 0 && !resolvedEditOrigin ? (
              <div className="chapter3ManualEmpty">
                <EmptyState
                  icon="📷"
                  text="「새 앨범」을 누른 뒤 사진을 올리면 EXIF 일자·장소로 개인 앨범이 만들어집니다."
                />
                <button type="button" className="primaryButton" onClick={startNewAlbum}>
                  새 앨범 시작
                </button>
                <button
                  type="button"
                  className="secondaryButton"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setLibraryFilter("saved");
                    setAlbumView("library");
                  }}
                >
                  확정 보기
                </button>
              </div>
            ) : (
              renderAlbumContent()
            )
          ) : manualState.activeSource === "manual" ? (
            <Chapter3ManualPlanEditor
              manualState={manualState}
              albumState={chapter3State}
            />
          ) : !isPlanConfirmed || dayPlans.length === 0 ? (
            forceAlbumEdit && chapter3State.albumDays.length > 0 ? (
              renderAlbumContent()
            ) : (
              <div className="chapter3ManualEmpty">
                <EmptyState
                  icon="📷"
                  text="2번 챕터에서 여행계획을 확정하거나, 수동 입력으로 기존 여행 앨범을 만들 수 있습니다."
                />
                <button
                  type="button"
                  className="primaryButton"
                  onClick={() => {
                    manualState.setAlbumSource("manual");
                    if (manualState.trips.length === 0) manualState.addTrip();
                  }}
                >
                  수동으로 기존 여행 입력
                </button>
                <button
                  type="button"
                  className="secondaryButton"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setLibraryFilter("saved");
                    setAlbumView("library");
                  }}
                >
                  확정 보기
                </button>
                <button
                  type="button"
                  className="primaryButton"
                  style={{ marginTop: 10 }}
                  onClick={startNewAlbum}
                >
                  새 앨범
                </button>
              </div>
            )
          ) : confirmedAlbumForPlan && !resolvedEditOrigin ? (
            <div className="chapter3ManualEmpty">
              <EmptyState
                icon="📷"
                text="이 여행의 확정 앨범이 있습니다. 「확정」에서 「수정」하거나, 「새 앨범」으로 다른 앨범을 만드세요."
              />
              <button
                type="button"
                className="secondaryButton"
                onClick={() => {
                  setLibraryFilter("saved");
                  setAlbumView("library");
                }}
              >
                확정 ({savedAlbumList.length})
              </button>
              <button
                type="button"
                className="primaryButton"
                style={{ marginTop: 10 }}
                onClick={startNewAlbum}
              >
                새 앨범 ({draftAlbumList.length})
              </button>
            </div>
          ) : (
            renderAlbumContent()
          )}
        </>
      )}
    </div>
  );

  if (panelMode === "map") {
    return (
      <div className="layoutGrid chapterFullWidth">
        <section className="leftColumn">
          <div className="chapterTitleBox">
            <span>Chapter 4</span>
            <h2 className="chapterTitleMap">여행 지도</h2>
            <p>
              목적지·숙소·식당 주소를 직접 입력해 지도 동선·이동 거리를 시뮬레이션합니다. 2번
              챕터와 연동되지 않습니다.
            </p>
          </div>
          <Card
            number="1"
            title="여행 지도 (시뮬레이션)"
            subtitle="등록 여행지 또는 일차 동선으로 도로 거리·시간을 확인합니다."
          >
            {renderMapTab()}
          </Card>
        </section>
      </div>
    );
  }

  return (
    <div className="layoutGrid chapterFullWidth">
      <section className="leftColumn">
        {!personalOnly && (
        <div className="chapterTitleBox">
          <span>Chapter 3</span>
          <h2>
            여행 앨범 & <em className="navPersonal">개인 앨범</em>
          </h2>
          <p>
            여행 앨범은 2번 챕터 확정 계획서 또는 수동 입력한 기존 여행을 기준으로 사진을
            관리합니다. 개인 앨범은 동일 기능에 일자·년도·장소 구분을 제공합니다.
          </p>
        </div>
        )}

        {!personalOnly && (
        <nav className="chapter3SubNav" aria-label="3번 챕터 기능">
          <button
            type="button"
            className={`tabAlbum${activeTab === "album" ? " active" : ""}`}
            onClick={() => {
              setActiveTab("album");
              setAlbumView("library");
              setLibraryFilter("saved");
            }}
          >
            📷 여행 앨범
          </button>
          <button
            type="button"
            className={`tabPersonal${activeTab === "personal" ? " active" : ""}`}
            onClick={() => {
              setActiveTab("personal");
              setAlbumView("library");
              setLibraryFilter("saved");
            }}
          >
            🖼️ 개인 앨범
          </button>
        </nav>
        )}

        <Card
          number={activeTab === "personal" ? "2" : "1"}
          title={activeTab === "personal" ? "개인 앨범" : "여행 앨범"}
          subtitle={
            activeTab === "personal"
              ? "여행과 별도로 사진을 모으는 개인 앨범입니다. 구분 기준은 기본 일자이며, 년도별·장소별로 볼 수 있습니다."
              : "2번 챕터 확정 계획서 또는 수동 입력(기존 여행) 기준 일자별 사진 앨범입니다."
          }
        >
          {renderAlbumTab()}
        </Card>
      </section>
    </div>
  );
}

function PlaceListItem({
  item,
  selected,
  routeOrder,
  showCheckbox = false,
  onSelect,
}: {
  item: Chapter3MapPlaceItem;
  selected: boolean;
  routeOrder?: number;
  showCheckbox?: boolean;
  onSelect: () => void;
}) {
  const dayColor = getPlanDayColor(item.day);
  return (
    <button
      type="button"
      className={`chapter3PlaceItem ${selected ? "selected" : ""}`}
      style={
        selected
          ? { borderColor: dayColor, background: `${dayColor}18` }
          : { borderLeftColor: dayColor }
      }
      onClick={onSelect}
    >
      {showCheckbox ? (
        <span className={`chapter3PlaceCheck ${selected ? "checked" : ""}`} aria-hidden="true">
          {selected ? "✓" : ""}
        </span>
      ) : (
        <span className="chapter3PlaceItemIcon">
          {typeof routeOrder === "number" ? routeOrder : item.icon}
        </span>
      )}
      {showCheckbox && typeof routeOrder === "number" && (
        <span className="chapter3PlaceRouteOrder">{routeOrder}</span>
      )}
      <span className="chapter3PlaceItemLabel">{item.label}</span>
      <strong>{item.name}</strong>
      {item.address && <small>{item.address}</small>}
    </button>
  );
}

function RouteLegItem({
  leg,
  stepIndex,
  distanceKm,
  durationMs,
  cumulativeDistanceMeters,
  cumulativeDurationMs,
}: {
  leg: Chapter3RouteLeg;
  stepIndex?: number;
  distanceKm?: number;
  durationMs?: number;
  cumulativeDistanceMeters?: number;
  cumulativeDurationMs?: number;
}) {
  return (
    <li className="chapter3LegItem">
      <div>
        {typeof stepIndex === "number" && (
          <span className="chapter3LegStep">단계 {stepIndex}</span>
        )}
        <strong>{leg.from}</strong>
        <span> → </span>
        <strong>{leg.to}</strong>
      </div>
      <div className="chapter3LegMeta">
        <span>🚌 {leg.transport}</span>
        {typeof distanceKm === "number" && (
          <span>📏 단계 {formatDistanceKm(distanceKm)}</span>
        )}
        {typeof durationMs === "number" && durationMs > 0 && (
          <span>⏱ 단계 {formatDurationMs(durationMs)}</span>
        )}
        {typeof cumulativeDistanceMeters === "number" && cumulativeDistanceMeters > 0 && (
          <span>
            Σ 누적 {formatDistanceMeters(cumulativeDistanceMeters)}
            {typeof cumulativeDurationMs === "number" && cumulativeDurationMs > 0
              ? ` · ${formatDurationMs(cumulativeDurationMs)}`
              : ""}
          </span>
        )}
      </div>
    </li>
  );
}
