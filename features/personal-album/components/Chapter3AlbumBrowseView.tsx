"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALBUM_GROUP_BY_OPTIONS,
  buildAlbumBrowseSections,
} from "../utils/albumGroupByUtils";
import { formatExifDateSlash } from "../utils/albumDateUtils";
import { photoDisplayUrl } from "../utils/chapter3AlbumSyncUtils";
import type { AlbumGroupBy, SavedTravelAlbum } from "../utils/chapter3SavedAlbumUtils";
import {
  consolidateManualAlbumDayPlaces,
  type Chapter3AlbumPhoto,
} from "../utils/chapter3Utils";
import {
  getPhotoExifPlaceName,
  isGpsCoordinateLabel,
  resolveExifPlaceName,
} from "../utils/exifUtils";
import { Chapter3AlbumDayMap } from "./Chapter3AlbumDayMap";
import { Chapter3PhotoRouteMap } from "./Chapter3PhotoRouteMap";

function hasGps(photo: Chapter3AlbumPhoto): boolean {
  return (
    typeof photo.exifLat === "number" &&
    Number.isFinite(photo.exifLat) &&
    typeof photo.exifLng === "number" &&
    Number.isFinite(photo.exifLng)
  );
}

function storedExifPlace(photo: Chapter3AlbumPhoto): string {
  const name = getPhotoExifPlaceName(photo);
  if (name && !/사진 앨범$/.test(name)) return name;
  const label = photo.exifLocationLabel?.trim() || "";
  if (label && !isGpsCoordinateLabel(label) && !/사진 앨범$/.test(label)) return label;
  return "";
}

type GeocodeJob = {
  lat: number;
  lng: number;
  resolve: (name: string | undefined) => void;
};

const geocodeQueue: GeocodeJob[] = [];
let geocodeActive = 0;

function pumpExifGeocode() {
  while (geocodeActive < 3 && geocodeQueue.length > 0) {
    const job = geocodeQueue.shift();
    if (!job) return;
    geocodeActive += 1;
    void resolveExifPlaceName(job.lat, job.lng)
      .then((name) => job.resolve(name))
      .catch(() => job.resolve(undefined))
      .finally(() => {
        geocodeActive -= 1;
        pumpExifGeocode();
      });
  }
}

function requestExifPlaceName(lat: number, lng: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    geocodeQueue.push({ lat, lng, resolve });
    pumpExifGeocode();
  });
}

function BrowsePhotoPlace({ photo }: { photo: Chapter3AlbumPhoto }) {
  const stored = storedExifPlace(photo);
  const gps = hasGps(photo);
  const [resolved, setResolved] = useState("");
  const [pending, setPending] = useState(!stored && gps);

  useEffect(() => {
    if (stored || !gps) {
      setResolved("");
      setPending(false);
      return;
    }
    let cancelled = false;
    setResolved("");
    setPending(true);
    void requestExifPlaceName(photo.exifLat!, photo.exifLng!).then((name) => {
      if (cancelled) return;
      setPending(false);
      if (name) setResolved(name);
    });
    return () => {
      cancelled = true;
    };
  }, [photo.id, stored, gps, photo.exifLat, photo.exifLng]);

  const placeName = stored || resolved;
  const placeText =
    placeName ||
    (gps ? (pending ? "위치 확인 중…" : "위치 미확인") : "");
  const dateText = formatExifDateSlash(photo.exifDateTime);
  if (!placeText && !dateText) return null;
  const label = [placeText, dateText].filter(Boolean).join(" · ");
  const coordFallback =
    !placeName && !pending && gps
      ? `${photo.exifLat!.toFixed(5)}, ${photo.exifLng!.toFixed(5)}`
      : "";

  return (
    <span
      className={`chapter3AlbumBrowsePhotoPlace${placeText === "위치 확인 중…" ? " pending" : ""}`}
      title={coordFallback || label}
    >
      {label}
    </span>
  );
}

export function Chapter3AlbumBrowseView({
  album,
  onClose,
  onUpdateMemo,
  enableGroupBy = false,
  initialGroupBy = "day",
}: {
  album: SavedTravelAlbum;
  onClose: () => void;
  onUpdateMemo?: (photoId: string, memo: string) => void;
  /** 개인 앨범 — 일자/년도별/장소별 구분 */
  enableGroupBy?: boolean;
  initialGroupBy?: AlbumGroupBy;
}) {
  const [groupBy, setGroupBy] = useState<AlbumGroupBy>(initialGroupBy);
  const sections = useMemo(
    () => buildAlbumBrowseSections(album.days, enableGroupBy ? groupBy : "day"),
    [album.days, enableGroupBy, groupBy],
  );
  const [sectionKey, setSectionKey] = useState(sections[0]?.key ?? "");
  const section =
    sections.find((item) => item.key === sectionKey) ?? sections[0] ?? null;
  const photos = section?.photos ?? [];
  const day = section?.day ?? null;
  const gpsPhotos = useMemo(() => photos.filter(hasGps), [photos]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const photoButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [mapHeight, setMapHeight] = useState(320);
  const memoTimerRef = useRef<number | null>(null);
  const pendingMemoRef = useRef<{ id: string; value: string } | null>(null);
  const onUpdateMemoRef = useRef(onUpdateMemo);
  const memoDraftsRef = useRef(memoDrafts);
  const selectedIdRef = useRef(selectedId);
  onUpdateMemoRef.current = onUpdateMemo;
  memoDraftsRef.current = memoDrafts;
  selectedIdRef.current = selectedId;

  const selectedPhoto = photos.find((photo) => photo.id === selectedId) ?? null;
  const memoDraft = selectedPhoto ? (memoDrafts[selectedPhoto.id] ?? selectedPhoto.memo ?? "") : "";

  useEffect(() => {
    if (!sections.some((item) => item.key === sectionKey)) {
      setSectionKey(sections[0]?.key ?? "");
    }
  }, [sections, sectionKey]);

  const flushMemo = useCallback((photoId: string, value: string) => {
    if (memoTimerRef.current != null) {
      window.clearTimeout(memoTimerRef.current);
      memoTimerRef.current = null;
    }
    pendingMemoRef.current = null;
    onUpdateMemoRef.current?.(photoId, value);
  }, []);

  const scheduleMemo = useCallback(
    (photoId: string, value: string) => {
      setMemoDrafts((prev) => ({ ...prev, [photoId]: value }));
      pendingMemoRef.current = { id: photoId, value };
      if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
      memoTimerRef.current = window.setTimeout(() => {
        memoTimerRef.current = null;
        pendingMemoRef.current = null;
        onUpdateMemoRef.current?.(photoId, value);
      }, 350);
    },
    [],
  );

  const selectPhoto = useCallback(
    (photoId: string) => {
      const current = selectedIdRef.current;
      if (current && current !== photoId) {
        const previous = photos.find((photo) => photo.id === current);
        const value = memoDraftsRef.current[current] ?? previous?.memo ?? "";
        flushMemo(current, value);
      }
      setSelectedId(photoId);
    },
    [flushMemo, photos],
  );

  useEffect(() => {
    return () => {
      if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
      const pending = pendingMemoRef.current;
      if (pending) onUpdateMemoRef.current?.(pending.id, pending.value);
    };
  }, []);

  useEffect(() => {
    const current = selectedIdRef.current;
    const drafted = current ? memoDraftsRef.current[current] : undefined;
    if (current && drafted != null) flushMemo(current, drafted);
    setSelectedId(null);
  }, [section?.key, flushMemo]);

  useEffect(() => {
    if (!selectedId) return;
    photoButtonRefs.current[selectedId]?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedId]);

  useEffect(() => {
    const pane = mapPaneRef.current;
    if (!pane) return;
    const apply = () => setMapHeight(Math.max(220, Math.floor(pane.clientHeight)));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [section?.key, gpsPhotos.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        target.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sectionAriaLabel =
    groupBy === "year" ? "년도" : groupBy === "place" ? "장소" : "여행 날짜";
  const emptySectionText =
    groupBy === "year"
      ? "표시할 년도가 없습니다."
      : groupBy === "place"
        ? "표시할 장소가 없습니다."
        : "표시할 날짜가 없습니다.";
  const emptyPhotosText =
    groupBy === "year"
      ? "이 년도의 사진이 없습니다."
      : groupBy === "place"
        ? "이 장소의 사진이 없습니다."
        : "이 날짜의 사진이 없습니다.";

  return (
    <div className="chapter3AlbumBrowse" role="dialog" aria-modal="true" aria-label={`${album.title} 보기`}>
      <header className="chapter3AlbumBrowseHeader">
        <div className="chapter3AlbumBrowseHeaderTop">
          <h2 className="chapter3AlbumBrowseTitle">{album.title}</h2>
          <button type="button" className="secondaryButton" onClick={onClose}>
            닫기
          </button>
        </div>
        {enableGroupBy && (
          <div className="chapter3AlbumGroupBy" role="group" aria-label="구분 기준">
            <span className="chapter3AlbumGroupByLabel">구분 기준</span>
            {ALBUM_GROUP_BY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chapter3AlbumGroupByBtn${groupBy === option.value ? " on" : ""}`}
                onClick={() => setGroupBy(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className="chapter3AlbumBrowseDays" role="tablist" aria-label={sectionAriaLabel}>
          {sections.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              className={`chapter3AlbumBrowseDay${item.key === section?.key ? " on" : ""}`}
              aria-selected={item.key === section?.key}
              onClick={() => setSectionKey(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {!section ? (
        <p className="chapter3AlbumBrowseEmpty">{emptySectionText}</p>
      ) : (
        <div className="chapter3AlbumBrowseBody">
          <div className="chapter3AlbumBrowseMap" ref={mapPaneRef}>
            {gpsPhotos.length > 0 ? (
              <Chapter3PhotoRouteMap
                photos={gpsPhotos}
                selectedPhotoId={selectedId}
                onPhotoSelect={selectPhoto}
                height={mapHeight}
                distancePlacement="overlay"
                dimOthers
              />
            ) : day ? (
              <Chapter3AlbumDayMap
                day={{ ...day, places: consolidateManualAlbumDayPlaces(day.day, day.places) }}
                showPhotoMap={false}
                allowGoogleEmbed={false}
              />
            ) : (
              <div className="chapter3AlbumBrowseMapEmpty">
                <p>GPS가 있는 사진이 없어 지도를 표시할 수 없습니다.</p>
              </div>
            )}
          </div>
          <div className="chapter3AlbumBrowsePhotosPane">
            {selectedPhoto && (
              <label className="chapter3AlbumBrowseMemo">
                <span className="chapter3AlbumBrowseMemoLabel">메모</span>
                <input
                  className="chapter3AlbumBrowseMemoInput"
                  type="text"
                  value={memoDraft}
                  placeholder="사진 메모 (예: 공항 도착)"
                  onChange={(event) => scheduleMemo(selectedPhoto.id, event.target.value)}
                  onBlur={(event) => flushMemo(selectedPhoto.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </label>
            )}
            <div className="chapter3AlbumBrowsePhotos" aria-label="사진">
              {photos.length === 0 ? (
                <p className="chapter3AlbumBrowseEmpty">{emptyPhotosText}</p>
              ) : (
                photos.map((photo) => {
                  const src = photoDisplayUrl(photo);
                  if (!src) return null;
                  const selected = photo.id === selectedId;
                  const memoText = (
                    selected ? memoDraft : memoDrafts[photo.id] ?? photo.memo ?? ""
                  ).trim();
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      ref={(node) => {
                        photoButtonRefs.current[photo.id] = node;
                      }}
                      className={`chapter3AlbumBrowsePhoto${selected ? " on" : ""}`}
                      onClick={() => selectPhoto(photo.id)}
                    >
                      <img src={src} alt={photo.fileName || "개인 사진"} draggable={false} />
                      <BrowsePhotoPlace photo={photo} />
                      {memoText ? (
                        <span className="chapter3AlbumBrowseMemoChip" title={memoText}>
                          {memoText}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
