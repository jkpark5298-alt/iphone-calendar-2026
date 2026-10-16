"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import {
  formatDateSlash,
  formatExifDateSlash,
  resolveAlbumDayDateIso,
} from "../utils/albumDateUtils";
import { parsePhotoTakenAtMs, sortAlbumPhotos } from "../utils/albumPhotoOrderUtils";
import { photoDisplayUrl } from "../utils/chapter3AlbumSyncUtils";
import type { SavedTravelAlbum } from "../utils/chapter3SavedAlbumUtils";
import {
  consolidateManualAlbumDayPlaces,
  type Chapter3AlbumPhoto,
} from "../utils/chapter3Utils";
import {
  getPhotoExifPlaceName,
  isGpsCoordinateLabel,
  resolveExifPlaceName,
} from "../utils/exifUtils";
import { Chapter3PhotoRouteMap } from "./Chapter3PhotoRouteMap";

export type AlbumViewerSlide = {
  id: string;
  src: string;
  alt: string;
  location: string;
  hasGps: boolean;
  lat?: number;
  lng?: number;
  takenAt?: string;
  dayLabel: string;
  memo: string;
  year: string;
  sortMs: number;
};

type SortDir = "asc" | "desc";

function usableExifPlaceName(photo: { exifPlaceName?: string }): string {
  const name = getPhotoExifPlaceName(photo);
  if (!name || /사진 앨범$/.test(name)) return "";
  return name;
}

function yearFromPhoto(
  photo: Chapter3AlbumPhoto,
  dayLabel: string,
  dayIso: string,
): string {
  const takenIso = (() => {
    const ms = parsePhotoTakenAtMs(photo);
    if (ms == null) return "";
    const date = new Date(ms);
    return String(date.getFullYear());
  })();
  if (takenIso) return takenIso;
  const slash = formatExifDateSlash(photo.exifDateTime);
  if (slash.length >= 4) return slash.slice(0, 4);
  if (/^\d{4}/.test(dayIso)) return dayIso.slice(0, 4);
  const fromLabel = dayLabel.match(/(\d{4})/);
  return fromLabel?.[1] || "연도 미정";
}

/** 앨범 사진 전체 수집 (정렬·년도 필터는 뷰어에서) */
export function collectAlbumViewerSlides(album: SavedTravelAlbum): AlbumViewerSlide[] {
  const slides: AlbumViewerSlide[] = [];
  for (const day of album.days) {
    const places = consolidateManualAlbumDayPlaces(day.day, day.places);
    const dayIso = resolveAlbumDayDateIso(day) || "";
    const dayLabel = formatDateSlash(dayIso) || day.dateLabel || `${day.day}일차`;
    for (const place of places) {
      for (const photo of sortAlbumPhotos(place.photos)) {
        const src = photoDisplayUrl(photo);
        if (!src) continue;
        const named = usableExifPlaceName(photo);
        const label = photo.exifLocationLabel?.trim() || "";
        const hasGps =
          typeof photo.exifLat === "number" &&
          Number.isFinite(photo.exifLat) &&
          typeof photo.exifLng === "number" &&
          Number.isFinite(photo.exifLng);
        const sortMs = parsePhotoTakenAtMs(photo) ?? 0;
        slides.push({
          id: photo.id,
          src,
          alt: photo.fileName || place.name || "개인 사진",
          location: named || (label && !isGpsCoordinateLabel(label) ? label : ""),
          hasGps,
          lat: hasGps ? photo.exifLat : undefined,
          lng: hasGps ? photo.exifLng : undefined,
          takenAt: photo.exifDateTime,
          dayLabel,
          memo: photo.memo || "",
          year: yearFromPhoto(photo, dayLabel, dayIso),
          sortMs,
        });
      }
    }
  }
  return slides;
}

function orderViewerSlides(
  slides: AlbumViewerSlide[],
  sortDir: SortDir,
  yearFilter: string,
): AlbumViewerSlide[] {
  const filtered =
    yearFilter === "all" ? slides : slides.filter((slide) => slide.year === yearFilter);
  return [...filtered].sort((a, b) => {
    if (a.sortMs !== b.sortMs) {
      return sortDir === "asc" ? a.sortMs - b.sortMs : b.sortMs - a.sortMs;
    }
    return sortDir === "asc" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
  });
}

function collectGpsPhotos(album: SavedTravelAlbum): Chapter3AlbumPhoto[] {
  const photos: Chapter3AlbumPhoto[] = [];
  for (const day of album.days) {
    for (const place of consolidateManualAlbumDayPlaces(day.day, day.places)) {
      for (const photo of place.photos) {
        if (
          typeof photo.exifLat === "number" &&
          Number.isFinite(photo.exifLat) &&
          typeof photo.exifLng === "number" &&
          Number.isFinite(photo.exifLng) &&
          photoDisplayUrl(photo)
        ) {
          photos.push(photo);
        }
      }
    }
  }
  return sortAlbumPhotos(photos);
}

function AlbumViewerLocation({
  slide,
  style,
}: {
  slide: AlbumViewerSlide;
  style?: { top: number; left: number; maxWidth: number };
}) {
  const [resolved, setResolved] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (slide.location || !slide.hasGps || slide.lat == null || slide.lng == null) {
      setResolved("");
      setPending(false);
      return;
    }
    let cancelled = false;
    setResolved("");
    setPending(true);
    void resolveExifPlaceName(slide.lat, slide.lng).then((name) => {
      if (cancelled) return;
      setPending(false);
      if (name) setResolved(name);
    });
    return () => {
      cancelled = true;
    };
  }, [slide.id, slide.location, slide.hasGps, slide.lat, slide.lng]);

  const placeName = slide.location || resolved;
  const placeText =
    placeName ||
    (slide.hasGps
      ? pending
        ? "위치 확인 중…"
        : "위치 미확인"
      : "위치 정보 없음");
  const missing = !placeName || placeText === "위치 확인 중…" || placeText === "위치 미확인";
  const dateText = formatExifDateSlash(slide.takenAt) || slide.dayLabel || "";
  const coordFallback =
    !placeName &&
    !pending &&
    slide.hasGps &&
    slide.lat != null &&
    slide.lng != null
      ? `${slide.lat.toFixed(5)}, ${slide.lng.toFixed(5)}`
      : "";

  return (
    <span
      className={`chapter3AlbumViewerCaption${missing ? " missing" : ""}`}
      style={
        style
          ? { top: style.top, left: style.left, maxWidth: style.maxWidth }
          : undefined
      }
    >
      <span className="chapter3AlbumViewerCaptionPlace">
        {placeText}
        {dateText ? ` · ${dateText}` : ""}
      </span>
      {coordFallback ? (
        <span className="chapter3AlbumViewerCaptionDetail">{coordFallback}</span>
      ) : null}
    </span>
  );
}

function stripIndexAtCenter(
  strip: HTMLDivElement,
  thumbs: Array<HTMLButtonElement | null>,
): number | null {
  const mid = strip.scrollLeft + strip.clientWidth / 2;
  let best = -1;
  let bestDist = Infinity;
  thumbs.forEach((thumb, thumbIndex) => {
    if (!thumb) return;
    const center = thumb.offsetLeft + thumb.offsetWidth / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = thumbIndex;
    }
  });
  return best >= 0 ? best : null;
}

export function Chapter3AlbumFullscreenViewer({
  album,
  onClose,
  onUpdateMemo,
  startPhotoId,
  enableYearFilter = false,
}: {
  album: SavedTravelAlbum;
  onClose: () => void;
  onUpdateMemo?: (photoId: string, memo: string) => void;
  /** 지정하면 그 사진부터 열고 자동 재생은 꺼 둡니다. */
  startPhotoId?: string;
  /** 개인 앨범 — 년도별 필터 */
  enableYearFilter?: boolean;
}) {
  const allSlides = useMemo(() => collectAlbumViewerSlides(album), [album]);
  const yearOptions = useMemo(() => {
    const years = Array.from(
      new Set(allSlides.map((slide) => slide.year).filter((year) => year && year !== "연도 미정")),
    ).sort((a, b) => b.localeCompare(a));
    const hasUnknown = allSlides.some((slide) => slide.year === "연도 미정");
    return hasUnknown ? [...years, "연도 미정"] : years;
  }, [allSlides]);

  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [mapOpen, setMapOpen] = useState(false);
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const [mapHeight, setMapHeight] = useState(280);

  const slides = useMemo(
    () => orderViewerSlides(allSlides, sortDir, yearFilter),
    [allSlides, sortDir, yearFilter],
  );

  const startIndex = useMemo(() => {
    if (!startPhotoId) return 0;
    const found = slides.findIndex((slide) => slide.id === startPhotoId);
    return found >= 0 ? found : 0;
  }, [slides, startPhotoId]);

  const [index, setIndex] = useState(startIndex);
  const [autoPlay, setAutoPlay] = useState(!startPhotoId);
  const [paused, setPaused] = useState(false);
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const ignoreClickRef = useRef(false);
  const photoButtonRef = useRef<HTMLButtonElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const programmaticScrollRef = useRef(false);
  const indexSourceRef = useRef<"nav" | "strip">("nav");
  const safeIndexRef = useRef(0);
  const memoTimerRef = useRef<number | null>(null);
  const pendingMemoRef = useRef<{ id: string; value: string } | null>(null);
  const onUpdateMemoRef = useRef(onUpdateMemo);
  const [captionBox, setCaptionBox] = useState({ top: 10, left: 10, maxWidth: 280 });

  const safeIndex = slides.length === 0 ? 0 : Math.min(index, slides.length - 1);
  const slide = slides[safeIndex];
  const atEnd = slides.length === 0 || safeIndex >= slides.length - 1;
  const memoDraft = slide ? (memoDrafts[slide.id] ?? slide.memo) : "";
  const playing = autoPlay && !paused && !mapOpen;
  safeIndexRef.current = safeIndex;

  const gpsPhotos = useMemo(() => collectGpsPhotos(album), [album]);
  const mapPhotos = useMemo(() => {
    if (!slide?.hasGps) return gpsPhotos;
    const current = gpsPhotos.find((photo) => photo.id === slide.id);
    if (!current) return gpsPhotos;
    // 현재 사진 + 같은 필터 구간의 GPS만 (너무 많으면 현재만)
    const filteredIds = new Set(slides.filter((item) => item.hasGps).map((item) => item.id));
    const inView = gpsPhotos.filter((photo) => filteredIds.has(photo.id));
    return inView.length > 0 ? inView : [current];
  }, [album, gpsPhotos, slide, slides]);

  useEffect(() => {
    onUpdateMemoRef.current = onUpdateMemo;
  }, [onUpdateMemo]);

  const pendingKeepIdRef = useRef<string | null>(null);

  useEffect(() => {
    const keepId = pendingKeepIdRef.current;
    if (keepId == null) return;
    pendingKeepIdRef.current = null;
    const found = slides.findIndex((item) => item.id === keepId);
    setIndex(found >= 0 ? found : 0);
  }, [sortDir, yearFilter, slides]);

  const changeSortDir = (next: SortDir) => {
    pendingKeepIdRef.current = slides[safeIndex]?.id ?? null;
    setSortDir(next);
  };

  const changeYearFilter = (next: string) => {
    pendingKeepIdRef.current = slides[safeIndex]?.id ?? null;
    setYearFilter(next);
  };

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => {
        const base = slides.length === 0 ? 0 : Math.min(current, slides.length - 1);
        return Math.min(slides.length - 1, Math.max(0, base + delta));
      });
    },
    [slides.length],
  );

  useLayoutEffect(() => {
    const img = photoRef.current;
    const button = photoButtonRef.current;
    if (!img || !button) return;
    const place = () => {
      const imgBox = img.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      if (imgBox.width < 8 || imgBox.height < 8) return;
      setCaptionBox({
        top: Math.max(8, imgBox.top - buttonBox.top + 8),
        left: Math.max(8, imgBox.left - buttonBox.left + 8),
        maxWidth: Math.max(80, imgBox.width - 16),
      });
    };
    place();
    img.addEventListener("load", place);
    window.addEventListener("resize", place);
    return () => {
      img.removeEventListener("load", place);
      window.removeEventListener("resize", place);
    };
  }, [slide?.src]);

  const persistMemo = useCallback((photoId: string, value: string) => {
    onUpdateMemoRef.current?.(photoId, value);
  }, []);

  const flushMemo = useCallback((photoId: string, value: string) => {
    if (memoTimerRef.current != null) {
      window.clearTimeout(memoTimerRef.current);
      memoTimerRef.current = null;
    }
    pendingMemoRef.current = null;
    persistMemo(photoId, value);
  }, [persistMemo]);

  const scheduleMemo = useCallback((photoId: string, value: string) => {
    setMemoDrafts((prev) => ({ ...prev, [photoId]: value }));
    pendingMemoRef.current = { id: photoId, value };
    if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
    memoTimerRef.current = window.setTimeout(() => {
      memoTimerRef.current = null;
      pendingMemoRef.current = null;
      persistMemo(photoId, value);
    }, 350);
  }, [persistMemo]);

  useEffect(() => {
    return () => {
      if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
      const pending = pendingMemoRef.current;
      if (pending) onUpdateMemoRef.current?.(pending.id, pending.value);
    };
  }, []);

  useEffect(() => {
    if (!playing || slides.length === 0) return;
    const timer = window.setTimeout(() => {
      setIndex((current) => {
        const base = Math.min(current, slides.length - 1);
        if (base >= slides.length - 1) {
          setPaused(true);
          return base;
        }
        return base + 1;
      });
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [playing, safeIndex, slides.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "Escape") {
        if (typing) {
          (target as HTMLElement).blur();
          return;
        }
        if (mapOpen) {
          setMapOpen(false);
          return;
        }
        onClose();
      }
      if (typing) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, mapOpen, onClose]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      programmaticScrollRef.current = false;
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [slides.length]);

  useEffect(() => {
    const strip = stripRef.current;
    const thumb = thumbRefs.current[safeIndex];
    if (!strip || !thumb) return;
    if (indexSourceRef.current === "strip") {
      indexSourceRef.current = "nav";
      return;
    }
    programmaticScrollRef.current = true;
    const left = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    const clear = window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 400);
    return () => window.clearTimeout(clear);
  }, [safeIndex, slides.length]);

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    ignoreClickRef.current = true;
    if (autoPlay) setPaused(true);
    go(dx < 0 ? 1 : -1);
  };

  const onPhotoClick = () => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    if (playing) {
      setPaused(true);
      return;
    }
    if (!atEnd) go(1);
  };

  const onStripScroll = () => {
    if (programmaticScrollRef.current) return;
    const strip = stripRef.current;
    if (!strip) return;
    const next = stripIndexAtCenter(strip, thumbRefs.current.slice(0, slides.length));
    if (next == null || next === safeIndexRef.current) return;
    indexSourceRef.current = "strip";
    if (autoPlay) setPaused(true);
    setIndex(next);
  };

  const showSlide = (next: number) => {
    if (autoPlay) setPaused(true);
    setIndex(next);
  };

  const resume = () => {
    if (atEnd) setIndex(0);
    setPaused(false);
    setMapOpen(false);
  };

  const openMap = () => {
    if (!slide?.hasGps) {
      window.alert("이 사진에는 위치(GPS) 정보가 없습니다.");
      return;
    }
    setAutoPlay(false);
    setPaused(true);
    setMapOpen(true);
  };

  useEffect(() => {
    if (!mapOpen) return;
    const pane = mapPaneRef.current;
    if (!pane) return;
    const apply = () => setMapHeight(Math.max(180, Math.floor(pane.clientHeight)));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [mapOpen, slide?.id]);

  return (
    <div
      className="chapter3AlbumViewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${album.title} 앨범`}
    >
      <header className="chapter3AlbumViewerHeader">
        <h2 className="chapter3AlbumViewerTitle">{album.title}</h2>
        <span className="chapter3AlbumViewerCount">
          {slides.length === 0 ? "0 / 0" : `${safeIndex + 1} / ${slides.length}`}
        </span>
        <button
          type="button"
          className={`secondaryButton${sortDir === "asc" ? " on" : ""}`}
          aria-pressed={sortDir === "asc"}
          onClick={() => changeSortDir("asc")}
        >
          오래된순
        </button>
        <button
          type="button"
          className={`secondaryButton${sortDir === "desc" ? " on" : ""}`}
          aria-pressed={sortDir === "desc"}
          onClick={() => changeSortDir("desc")}
        >
          최신순
        </button>
        <button
          type="button"
          className={`secondaryButton chapter3AlbumViewerAuto${autoPlay ? " on" : ""}`}
          aria-pressed={autoPlay}
          onClick={() => {
            setMapOpen(false);
            setPaused(false);
            setAutoPlay((value) => !value);
          }}
        >
          {autoPlay ? "자동 끄기" : "자동 켜기"}
        </button>
        {paused && !mapOpen && (
          <button type="button" className="secondaryButton" onClick={resume}>
            재생
          </button>
        )}
        <button
          type="button"
          className="secondaryButton"
          onClick={() => go(-1)}
          disabled={safeIndex <= 0}
        >
          이전
        </button>
        <button
          type="button"
          className="secondaryButton"
          onClick={() => go(1)}
          disabled={atEnd}
        >
          다음
        </button>
        <button
          type="button"
          className={`secondaryButton${mapOpen ? " on" : ""}`}
          disabled={!slide}
          onClick={() => (mapOpen ? setMapOpen(false) : openMap())}
        >
          {mapOpen ? "지도 닫기" : "지도 보여주기"}
        </button>
        <button type="button" className="secondaryButton" onClick={onClose}>
          닫기
        </button>
      </header>

      {enableYearFilter && (
        <div className="chapter3AlbumViewerYears" role="tablist" aria-label="년도별">
          <button
            type="button"
            role="tab"
            className={`chapter3AlbumViewerYear${yearFilter === "all" ? " on" : ""}`}
            aria-selected={yearFilter === "all"}
            onClick={() => changeYearFilter("all")}
          >
            전체
          </button>
          {yearOptions.map((year) => (
            <button
              key={year}
              type="button"
              role="tab"
              className={`chapter3AlbumViewerYear${yearFilter === year ? " on" : ""}`}
              aria-selected={yearFilter === year}
              onClick={() => changeYearFilter(year)}
            >
              {year === "연도 미정" ? year : `${year}년`}
            </button>
          ))}
        </div>
      )}

      {slide ? (
        <>
          <div className={`chapter3AlbumViewerMain${mapOpen ? " withMap" : ""}`}>
            {mapOpen && (
              <div className="chapter3AlbumViewerMapPane" ref={mapPaneRef}>
                {mapPhotos.length > 0 ? (
                  <Chapter3PhotoRouteMap
                    key={`viewer-map-${yearFilter}-${sortDir}`}
                    photos={mapPhotos}
                    selectedPhotoId={slide.id}
                    onPhotoSelect={(photoId) => {
                      const found = slides.findIndex((item) => item.id === photoId);
                      if (found >= 0) {
                        setPaused(true);
                        setIndex(found);
                      }
                    }}
                    height={mapHeight}
                    distancePlacement="overlay"
                    dimOthers
                  />
                ) : (
                  <p className="chapter3AlbumViewerEmpty">지도에 표시할 GPS 사진이 없습니다.</p>
                )}
              </div>
            )}
            <div
              className="chapter3AlbumViewerStage"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              <div className="chapter3AlbumViewerPhoto">
                <button
                  ref={photoButtonRef}
                  type="button"
                  className="chapter3AlbumViewerPhotoButton"
                  onClick={onPhotoClick}
                  aria-label={playing ? "일시정지하고 메모 입력" : paused ? "사진" : "다음 사진"}
                >
                  <img ref={photoRef} src={slide.src} alt={slide.alt} draggable={false} />
                  <AlbumViewerLocation slide={slide} style={captionBox} />
                  {memoDraft.trim() ? (
                    <span className="chapter3AlbumViewerMemoChip" title={memoDraft}>
                      {memoDraft.trim()}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
          </div>
          <label className="chapter3AlbumViewerMemo">
            <span className="chapter3AlbumViewerMemoLabel">메모</span>
            <input
              className="chapter3AlbumViewerMemoInput"
              type="text"
              value={memoDraft}
              placeholder="사진 메모 (예: 공항 도착)"
              onChange={(event) => scheduleMemo(slide.id, event.target.value)}
              onFocus={() => {
                setAutoPlay(false);
                setPaused(true);
              }}
              onBlur={() => flushMemo(slide.id, memoDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.target as HTMLInputElement).blur();
                }
              }}
            />
          </label>
          {slides.length > 0 && (
            <div
              ref={stripRef}
              className="chapter3AlbumViewerStrip"
              onScroll={onStripScroll}
              aria-label="앨범 사진 순서. 스크롤하면 보는 사진만 바뀝니다."
            >
              {slides.map((item, itemIndex) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    thumbRefs.current[itemIndex] = node;
                  }}
                  type="button"
                  className={`chapter3AlbumViewerThumb${itemIndex === safeIndex ? " on" : ""}`}
                  aria-label={`${itemIndex + 1}번째 사진`}
                  aria-current={itemIndex === safeIndex ? "true" : undefined}
                  onClick={() => showSlide(itemIndex)}
                >
                  <img src={item.src} alt="" draggable={false} />
                  <span className="chapter3AlbumViewerThumbIndex">{itemIndex + 1}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="chapter3AlbumViewerEmpty">표시할 사진이 없습니다.</p>
      )}
    </div>
  );
}
