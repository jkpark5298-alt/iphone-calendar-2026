"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function PhotoZoomModal({
  src,
  alt = "사진",
  open,
  onClose,
}: {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  useEffect(() => {
    if (!open) setScale(1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const clampScale = (v: number) => Math.min(4, Math.max(0.5, v));

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => clampScale(prev + (e.deltaY < 0 ? 0.12 : -0.12)));
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { dist, scale };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ratio = dist / pinchRef.current.dist;
    setScale(clampScale(pinchRef.current.scale * ratio));
  }, []);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  if (!open) return null;

  return (
    <div
      className="photoZoomBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="사진 확대"
      onClick={onClose}
    >
      <div className="photoZoomToolbar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="secondaryButton" onClick={() => setScale((s) => clampScale(s - 0.25))}>
          −
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" className="secondaryButton" onClick={() => setScale((s) => clampScale(s + 0.25))}>
          +
        </button>
        <button type="button" className="secondaryButton" onClick={onClose}>
          닫기
        </button>
      </div>
      <div
        className="photoZoomStage"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={src}
          alt={alt}
          className="photoZoomImage"
          style={{ transform: `scale(${scale})` }}
          draggable={false}
        />
      </div>
    </div>
  );
}
