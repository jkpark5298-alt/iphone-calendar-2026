"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAlbumCardsFromSources,
  buildPersonAlbumCards,
  nextRandomAlbumIndex,
  removePersonAlbumCards,
  PERSON_ALBUM_SLIDE_MS,
  PERSON_ALBUM_USER_PAUSE_MS,
  type PersonAlbumCard,
  type PhotobookPersonSource,
} from "../lib/photobook-person-album";
import {
  readPersonAlbumState,
  writePersonAlbumState,
} from "../lib/client-photobook-person-album";

function AlbumCardFace({
  card,
  selected,
  playing = false,
  onToggle,
  onOpen,
}: {
  card: PersonAlbumCard;
  selected: boolean;
  playing?: boolean;
  onToggle: () => void;
  onOpen?: () => void;
}) {
  return (
    <div
      className={`pbPersonCard ${selected ? "is-selected" : ""} ${playing ? "is-playing" : ""}`}
    >
      <button type="button" onClick={onToggle} className="pbPersonCardFace">
        <div className="pbPersonCardImgWrap">
          <img key={card.imagePath} src={card.imagePath} alt="" draggable={false} />
        </div>
        <span className={`pbPersonCardCheck ${selected ? "on" : ""}`}>
          {selected ? "✓" : ""}
        </span>
        {selected ? (
          <span className="pbPersonCardMeta">
            <span className="pbPersonCardMetaLabel">목록 제목</span>
            <span className="pbPersonCardMetaTitle">{card.memo}</span>
            {card.dateLabel ? (
              <span className="pbPersonCardMetaDate">{card.dateLabel}</span>
            ) : null}
          </span>
        ) : null}
      </button>
      {selected && onOpen ? (
        <button type="button" onClick={onOpen} className="pbPersonCardOpen">
          자료 열기
        </button>
      ) : null}
    </div>
  );
}

/** iPadOS 13+ reports as Macintosh; keep album swipe like iPhone. */
function isIPadDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

type GalleryProps = {
  items: PhotobookPersonSource[];
  /** When true, show all images (selected album); otherwise filter 인물/She + keeps. */
  mode?: "person" | "selection";
  onOpenItem?: (id: string) => void;
  embedded?: boolean;
  onPrint?: () => void;
};

export function PhotobookPersonAlbumGallery({
  items,
  mode = "person",
  onOpenItem,
  embedded = false,
  onPrint,
}: GalleryProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pauseUntilRef = useRef(0);
  const selectedCountRef = useRef(0);
  const scrollSourceRef = useRef<"auto" | "user">("auto");
  const ignoreScrollRef = useRef(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ipadSwipe, setIpadSwipe] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [busyDelete, setBusyDelete] = useState(false);
  const [albumTick, setAlbumTick] = useState(0);

  const albumState = useMemo(() => {
    void albumTick;
    return readPersonAlbumState();
  }, [albumTick]);

  const keeps = albumState.keeps;
  const hidden = albumState.hidden;

  const liveIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const cards = useMemo(() => {
    if (mode === "selection") return buildAlbumCardsFromSources(items);
    return buildPersonAlbumCards(items, keeps, hidden);
  }, [items, keeps, hidden, mode]);

  const currentCard = cards[activeIndex] ?? cards[0];
  selectedCountRef.current = selectedKeys.size;

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pauseAutoplay = () => {
    pauseUntilRef.current = Date.now() + PERSON_ALBUM_USER_PAUSE_MS;
  };

  const toggleAutoPlay = () => {
    setAutoPlay((on) => {
      if (on) return false;
      pauseUntilRef.current = 0;
      return true;
    });
  };

  const handleDeleteSelected = () => {
    if (mode !== "person") return;
    const selected = cards.filter((card) => selectedKeys.has(card.key));
    if (selected.length === 0) return;
    const ok = window.confirm(
      `선택한 ${selected.length}장을 人 앨범에서 삭제할까요?\n목록에 글이 남아 있어도 이 앨범에서는 더 이상 보이지 않습니다.`,
    );
    if (!ok) return;
    setBusyDelete(true);
    try {
      const current = readPersonAlbumState();
      const next = removePersonAlbumCards(current, selected);
      writePersonAlbumState(next);
      setAlbumTick((n) => n + 1);
      setSelectedKeys(new Set());
    } finally {
      setBusyDelete(false);
    }
  };

  useEffect(() => {
    setIpadSwipe(isIPadDevice());
  }, []);

  useEffect(() => {
    if (activeIndex < cards.length) return;
    setActiveIndex(0);
  }, [activeIndex, cards.length]);

  useEffect(() => {
    if (!autoPlay || cards.length < 2) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (selectedCountRef.current > 0) return;
      if (Date.now() < pauseUntilRef.current) return;
      scrollSourceRef.current = "auto";
      setActiveIndex((current) => nextRandomAlbumIndex(cards.length, current));
    };
    const id = window.setInterval(tick, PERSON_ALBUM_SLIDE_MS);
    return () => window.clearInterval(id);
  }, [autoPlay, cards.length]);

  useEffect(() => {
    if (!autoPlay) return;
    if (scrollSourceRef.current === "user") return;
    const el = scrollerRef.current;
    if (!el || cards.length === 0) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    const target = activeIndex * width;
    if (Math.abs(el.scrollLeft - target) < 8) return;
    ignoreScrollRef.current = true;
    el.scrollTo({ left: target, behavior: "auto" });
    const id = window.setTimeout(() => {
      ignoreScrollRef.current = false;
    }, 80);
    return () => window.clearTimeout(id);
  }, [autoPlay, activeIndex, cards.length]);

  const syncActiveFromScroll = () => {
    if (ignoreScrollRef.current) return;
    const el = scrollerRef.current;
    if (!el || cards.length === 0) return;
    const width = el.clientWidth;
    if (width <= 0) return;
    const index = Math.round(el.scrollLeft / width);
    scrollSourceRef.current = "user";
    setActiveIndex(Math.max(0, Math.min(cards.length - 1, index)));
  };

  const cardFace = (card: PersonAlbumCard, index: number) => (
    <AlbumCardFace
      card={card}
      selected={selectedKeys.has(card.key)}
      playing={autoPlay && index === activeIndex}
      onToggle={() => {
        if (autoPlay) {
          pauseAutoplay();
          scrollSourceRef.current = "auto";
          setActiveIndex(index);
        }
        toggleSelected(card.key);
      }}
      onOpen={
        onOpenItem && liveIds.has(card.itemId)
          ? () => onOpenItem(card.itemId)
          : undefined
      }
    />
  );

  return (
    <div className="pbPersonAlbum">
      <div className="pbPersonAlbumHeader">
        {!embedded ? (
          <p className="pbPersonAlbumHint">
            {mode === "person" ? (
              <>
                분류가 <b>인물</b>/<b>She</b>인 포토북 사진은 자동으로 이 앨범에 모입니다.
                목록에서 카드를 지워도 사진은 여기에 남습니다. 사진을 고른 뒤 삭제할 수 있습니다.
              </>
            ) : (
              <>선택한 포토북 항목의 사진을 앨범으로 봅니다. 자동 재생·좌우 넘기기를 지원합니다.</>
            )}
            {autoPlay ? " 지금은 3초마다 무작위 사진으로 바뀝니다." : ""}
          </p>
        ) : (
          <p className="pbPersonAlbumHint">
            {mode === "person" ? "인물 사진" : "선택 사진"} {cards.length}장
            {mode === "person" ? " · 삭제해도 앨범에 남음 · 선택 후 삭제" : ""}
            {autoPlay ? " · 3초마다 무작위 재생" : ""}
          </p>
        )}
        <div className="pbPersonAlbumActions">
          {mode === "person" && selectedKeys.size > 0 ? (
            <button
              type="button"
              disabled={busyDelete}
              onClick={handleDeleteSelected}
              className="pbPersonAlbumBtn danger"
            >
              선택 삭제 ({selectedKeys.size})
            </button>
          ) : null}
          {onPrint ? (
            <button type="button" onClick={onPrint} className="pbPersonAlbumBtn">
              PDF / 인쇄
            </button>
          ) : null}
          {cards.length >= 2 ? (
            <button
              type="button"
              aria-pressed={autoPlay}
              onClick={toggleAutoPlay}
              className={`pbPersonAlbumBtn ${autoPlay ? "active" : ""}`}
            >
              {autoPlay ? "자동 끄기" : "자동"}
            </button>
          ) : null}
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="pbPersonAlbumEmpty">
          {mode === "person" ? "인물/She로 분류된 사진이 없습니다." : "표시할 사진이 없습니다."}
        </div>
      ) : (
        <>
          <div className={ipadSwipe ? undefined : "pbPersonAlbumMobileOnly"}>
            <div
              ref={scrollerRef}
              onScroll={syncActiveFromScroll}
              onPointerDown={autoPlay ? pauseAutoplay : undefined}
              className="pbPersonAlbumScroller"
            >
              {cards.map((card, index) => (
                <div key={card.key} className="pbPersonAlbumSlide">
                  {cardFace(card, index)}
                </div>
              ))}
            </div>
            <p className="pbPersonAlbumCounter" aria-live="polite">
              {activeIndex + 1} / {cards.length}
              {autoPlay ? " · 3초마다 무작위" : ""} · 좌우로 밀어 넘기기
            </p>
          </div>

          <div className={ipadSwipe ? "pbPersonAlbumHidden" : "pbPersonAlbumDesktopOnly"}>
            {autoPlay && currentCard ? (
              <>
                <div className="pbPersonAlbumSpotlight">{cardFace(currentCard, activeIndex)}</div>
                <p className="pbPersonAlbumCounter" aria-live="polite">
                  3초마다 무작위 사진 · {activeIndex + 1} / {cards.length}
                </p>
              </>
            ) : null}
            <div className="pbPersonAlbumGrid">
              {cards.map((card, index) => (
                <div key={card.key}>{cardFace(card, index)}</div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type ScreenProps = {
  items: PhotobookPersonSource[];
  onOpenItem?: (id: string) => void;
};

export function PhotobookPersonAlbumScreen({ items, onOpenItem }: ScreenProps) {
  const cards = useMemo(() => {
    const state = readPersonAlbumState();
    return buildPersonAlbumCards(items, state.keeps, state.hidden);
  }, [items]);

  return (
    <section className="pbPersonAlbumScreen">
      <div className="pbPersonAlbumScreenTitle">
        <h2>人 앨범</h2>
        <span>{cards.length}장</span>
      </div>
      <PhotobookPersonAlbumGallery items={items} mode="person" onOpenItem={onOpenItem} />
    </section>
  );
}
