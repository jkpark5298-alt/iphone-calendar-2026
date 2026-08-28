"use client";

import React from "react";

const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"] as const;

const DEFAULT_TEXT_COLORS = [
  { id: "default", color: "#e2e8f0", label: "기본" },
  { id: "brown", color: "#b45309", label: "갈" },
  { id: "blue", color: "#2563eb", label: "파랑" },
  { id: "red", color: "#dc2626", label: "빨강" },
  { id: "green", color: "#15803d", label: "초록" },
] as const;

const DEFAULT_HIGHLIGHT_COLORS = [
  { id: "yellow", bg: "#fef08a", label: "노랑" },
  { id: "sky", bg: "#bae6fd", label: "하늘" },
  { id: "pink", bg: "#fbcfe8", label: "분홍" },
  { id: "mint", bg: "#bbf7d0", label: "연두" },
] as const;

export type MobileFormatSwatch = { id: string; color: string; label: string };
export type MobileFormatHighlight = { id: string; bg: string; label: string };

/**
 * 아이폰: 키보드 바로 위에 고정되는 서식 바 (본문 위를 떠다니지 않음)
 */
export function GeneralInfoMobileFormatBubble({
  active,
  editorRef,
  onCommand,
  onInsertChar,
  textColors = DEFAULT_TEXT_COLORS,
  highlightColors = DEFAULT_HIGHLIGHT_COLORS,
  onImage,
}: {
  active: boolean;
  editorRef: React.RefObject<HTMLElement | null>;
  onCommand: (command: string, value?: string) => void;
  onInsertChar: (ch: string) => void;
  textColors?: readonly MobileFormatSwatch[];
  highlightColors?: readonly MobileFormatHighlight[];
  onImage?: () => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  const [keyboardBottom, setKeyboardBottom] = React.useState(0);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const stripRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const syncScrollHints = React.useCallback(() => {
    const el = stripRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(max - el.scrollLeft > 2);
  }, []);

  // 키보드(visualViewport) 바로 위에 붙이기
  React.useEffect(() => {
    if (!active || !isMobile) {
      setKeyboardBottom(0);
      return;
    }

    const updateDock = () => {
      const vv = window.visualViewport;
      if (!vv) {
        setKeyboardBottom(0);
        return;
      }
      // 레이아웃 하단과 보이는 영역 하단 차이 = 키보드 높이
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setKeyboardBottom(inset);
    };

    updateDock();
    window.visualViewport?.addEventListener("resize", updateDock);
    window.visualViewport?.addEventListener("scroll", updateDock);
    window.addEventListener("resize", updateDock);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateDock);
      window.visualViewport?.removeEventListener("scroll", updateDock);
      window.removeEventListener("resize", updateDock);
    };
  }, [active, isMobile]);

  // 에디터 포커스일 때만 표시
  React.useEffect(() => {
    if (!active || !isMobile) {
      setVisible(false);
      document.documentElement.style.removeProperty("--gi-mobile-format-bar-h");
      return;
    }

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const update = () => {
      const editor = editorRef.current;
      if (!editor) {
        setVisible(false);
        return;
      }
      const focused =
        document.activeElement === editor || editor.contains(document.activeElement);
      if (!focused) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          const still =
            document.activeElement === editor || editor.contains(document.activeElement);
          if (!still) {
            setVisible(false);
            document.documentElement.style.removeProperty("--gi-mobile-format-bar-h");
          }
        }, 320);
        return;
      }
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      setVisible(true);
      document.documentElement.style.setProperty("--gi-mobile-format-bar-h", "56px");
      requestAnimationFrame(syncScrollHints);
    };

    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    document.addEventListener("selectionchange", update);
    document.addEventListener("touchend", update, { passive: true });

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("touchend", update);
      document.documentElement.style.removeProperty("--gi-mobile-format-bar-h");
    };
  }, [active, isMobile, editorRef, syncScrollHints]);

  const keep = (e: React.SyntheticEvent) => {
    e.preventDefault();
  };

  const scrollByDir = (dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: "smooth" });
    window.setTimeout(syncScrollHints, 220);
  };

  if (!active || !isMobile || !visible) return null;

  return (
    <div
      className="generalInfoMobileFormatBubble generalInfoMobileFormatDock"
      style={{ bottom: keyboardBottom }}
      onMouseDown={keep}
      onTouchStart={keep}
      role="toolbar"
      aria-label="AI 보고서 서식 도구"
    >
      <button
        type="button"
        className="generalInfoMobileFormatNav"
        aria-label="서식 왼쪽으로"
        disabled={!canScrollLeft}
        onMouseDown={keep}
        onTouchStart={keep}
        onClick={() => scrollByDir(-1)}
      >
        ‹
      </button>

      <div className="generalInfoMobileFormatStrip" ref={stripRef} onScroll={syncScrollHints}>
        <button
          type="button"
          className="generalInfoMobileFormatBtn"
          title="굵게"
          onMouseDown={keep}
          onTouchStart={keep}
          onClick={() => onCommand("bold")}
        >
          <span className="generalInfoMobileFormatB">B</span>
        </button>
        <button
          type="button"
          className="generalInfoMobileFormatBtn"
          title="밑줄"
          onMouseDown={keep}
          onTouchStart={keep}
          onClick={() => onCommand("underline")}
        >
          <span className="generalInfoMobileFormatU">U</span>
        </button>
        <button
          type="button"
          className="generalInfoMobileFormatBtn"
          title="글자 작게"
          onMouseDown={keep}
          onTouchStart={keep}
          onClick={() => onCommand("fontSizeStep", "-1")}
        >
          −
        </button>
        <button
          type="button"
          className="generalInfoMobileFormatBtn"
          title="글자 크게"
          onMouseDown={keep}
          onTouchStart={keep}
          onClick={() => onCommand("fontSizeStep", "1")}
        >
          +
        </button>

        <span className="generalInfoMobileFormatSep" aria-hidden />

        {CIRCLED_NUMBERS.map((ch) => (
          <button
            key={ch}
            type="button"
            className="generalInfoMobileFormatNum"
            title={`${ch} 삽입`}
            onMouseDown={keep}
            onTouchStart={keep}
            onClick={() => onInsertChar(ch)}
          >
            {ch}
          </button>
        ))}

        <span className="generalInfoMobileFormatSep" aria-hidden />

        {textColors.map((c) => (
          <button
            key={c.id}
            type="button"
            className="generalInfoMobileFormatSwatch"
            title={c.label}
            onMouseDown={keep}
            onTouchStart={keep}
            onClick={() => onCommand("foreColor", c.id === "default" ? "" : c.color)}
            style={{ background: c.color }}
          />
        ))}

        <span className="generalInfoMobileFormatSep" aria-hidden />

        {highlightColors.map((c) => (
          <button
            key={c.id}
            type="button"
            className="generalInfoMobileFormatHighlight"
            title={`${c.label} 형광`}
            onMouseDown={keep}
            onTouchStart={keep}
            onClick={() => onCommand("hiliteColor", c.bg)}
            style={{ background: c.bg }}
          />
        ))}

        {onImage && (
          <>
            <span className="generalInfoMobileFormatSep" aria-hidden />
            <button
              type="button"
              className="generalInfoMobileFormatBtn"
              title="이미지 추가"
              onMouseDown={keep}
              onTouchStart={keep}
              onClick={onImage}
            >
              이미지
            </button>
          </>
        )}

        <button
          type="button"
          className="generalInfoMobileFormatClear"
          title="서식 지우기"
          onMouseDown={keep}
          onTouchStart={keep}
          onClick={() => onCommand("removeFormat")}
        >
          지우기
        </button>
      </div>

      <button
        type="button"
        className="generalInfoMobileFormatNav"
        aria-label="서식 오른쪽으로"
        disabled={!canScrollRight}
        onMouseDown={keep}
        onTouchStart={keep}
        onClick={() => scrollByDir(1)}
      >
        ›
      </button>
    </div>
  );
}
