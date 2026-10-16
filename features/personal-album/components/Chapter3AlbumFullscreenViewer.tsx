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
import { sortAlbumPhotos } from "../utils/albumPhotoOrderUtils";
import { photoDisplayUrl } from "../utils/chapter3AlbumSyncUtils";
import type { SavedTravelAlbum } from "../utils/chapter3SavedAlbumUtils";
import { consolidateManualAlbumDayPlaces } from "../utils/chapter3Utils";
import {
  getPhotoExifPlaceName,
  isGpsCoordinateLabel,
  resolveExifPlaceName,
} from "../utils/exifUtils";

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
};

function usableExifPlaceName(photo: { exifPlaceName?: string }): string {
  const name = getPhotoExifPlaceName(photo);
  if (!name || /사진 앨범$/.test(name)) return "";
  return name;
}

/** 앨범 사진 전체 — 일자 순, 일자 안에서는 촬영 시각 순 */
export function collectAlbumViewerSlides(album: SavedTravelAlbum): AlbumViewerSlide[] {
  const slides: AlbumViewerSlide[] = [];
  for (const day of album.days) {
    const places = consolidateManualAlbumDayPlaces(day.day, day.places);
    const dayLabel =
      formatDateSlash(resolveAlbumDayDateIso(day)) || day.dateLabel || `${day.day}일차`;
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
        slides.push({
          id: photo.id,
          src,
          alt: photo.fileName || place.name || "여행 사진",
          location: named || (label && !isGpsCoordinateLabel(label) ? label : ""),
          hasGps,
          lat: hasGps ? photo.exifLat : undefined,
          lng: hasGps ? photo.exifLng : undefined,
          takenAt: photo.exifDateTime,
          dayLabel,
          memo: photo.memo || "",
        });
      }
    }
  }
  return slides;
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
}: {
  album: SavedTravelAlbum;
  onClose: () => void;
  onUpdateMemo?: (photoId: string, memo: string) => void;
  /** 지정하면 그 사진부터 열고 자동 재생은 꺼 둡니다. */
  startPhotoId?: string;
}) {
  const slides = useMemo(() => collectAlbumViewerSlides(album), [album]);
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
  const playing = autoPlay && !paused;
  safeIndexRef.current = safeIndex;

  useEffect(() => {
    onUpdateMemoRef.current = onUpdateMemo;
  }, [onUpdateMemo]);

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

  const scheduleMemo = useCallback(
    (photoId: string, value: string) => {
      setMemoDrafts((prev) => ({ ...prev, [photoId]: value }));
      pendingMemoRef.current = { id: photoId, value };
      if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
      memoTimerRef.current = window.setTimeout(() => {
        memoTimerRef.current = null;
        pendingMemoRef.current = null;
        persistMemo(photoId, value);
      }, 350);
    },
    [persistMemo],
  );

  const flushMemo = useCallback(
    (photoId: string, value: string) => {
      if (memoTimerRef.current != null) {
        window.clearTimeout(memoTimerRef.current);
        memoTimerRef.current = null;
      }
      pendingMemoRef.current = null;
      persistMemo(photoId, value);
    },
    [persistMemo],
  );

  useEffect(() => {
    return () => {
      if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
      const pending = pendingMemoRef.current;
      if (pending) onUpdateMemoRef.current?.(pending.id, pending.value);
    };
  }, []);

  useEffect(() => {
    if (!playing || slides.length < 2 || safeIndex >= slides.length - 1) return;
    const timer = window.setTimeout(() => go(1), 3000);
    return () => window.clearTimeout(timer);
  }, [playing, safeIndex, slides.length, go]);

  useEffect(() => {
    if (indexSourceRef.current === "strip") {
      indexSourceRef.current = "nav";
      return;
    }
    const strip = stripRef.current;
    const thumb = thumbRefs.current[safeIndex];
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
    const nextLeft = Math.max(0, left);
    if (Math.abs(strip.scrollLeft - nextLeft) < 2) return;
    programmaticScrollRef.current = true;
    strip.scrollTo({ left: nextLeft, behavior: "smooth" });
    const release = () => {
      programmaticScrollRef.current = false;
    };
    strip.addEventListener("scrollend", release, { once: true });
    const timer = window.setTimeout(release, 500);
    return () => {
      programmaticScrollRef.current = false;
      strip.removeEventListener("scrollend", release);
      window.clearTimeout(timer);
    };
  }, [safeIndex, slides.length]);

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
  }, [go, onClose]);

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

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
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
    const tapped = Math.abs(dx) < 48 && Math.abs(dy) < 48;
    if (tapped) return;
    ignoreClickRef.current = true;
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
    if (paused || atEnd) return;
    go(1);
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
  };

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
          className={`secondaryButton chapter3AlbumViewerAuto${autoPlay ? " on" : ""}`}
          aria-pressed={autoPlay}
          onClick={() => {
            setPaused(false);
            setAutoPlay((value) => !value);
          }}
        >
          {autoPlay ? "자동 끄기" : "자동 켜기"}
        </button>
        {paused && (
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
        <button type="button" className="secondaryButton" onClick={onClose}>
          닫기
        </button>
      </header>

      {slide ? (
        <>
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
