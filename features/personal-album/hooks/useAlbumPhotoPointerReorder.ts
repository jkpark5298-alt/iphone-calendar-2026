"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { movePhotoIndex } from "../utils/albumPhotoOrderUtils";

const LONG_PRESS_MS = 380;
const MOVE_CANCEL_PX = 12;
const DRAG_START_PX = 6;

type PointerState = {
  pointerId: number;
  pointerType: string;
  id: string;
  fromIndex: number;
  startX: number;
  startY: number;
  dragging: boolean;
  immediate: boolean;
};

export function useAlbumPhotoPointerReorder({
  itemIds,
  canReorderId,
  onReorder,
  itemAttr = "data-album-photo-id",
}: {
  itemIds: string[];
  canReorderId: (id: string) => boolean;
  onReorder: (orderedIds: string[]) => void;
  itemAttr?: string;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const stateRef = useRef<PointerState | null>(null);
  const overIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const skipClickRef = useRef(false);
  const itemIdsRef = useRef(itemIds);
  itemIdsRef.current = itemIds;
  const itemAttrRef = useRef(itemAttr);
  itemAttrRef.current = itemAttr;
  const canReorderIdRef = useRef(canReorderId);
  canReorderIdRef.current = canReorderId;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const updateOverId = useCallback((id: string | null) => {
    overIdRef.current = id;
    setOverId(id);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const endDrag = useCallback(() => {
    clearLongPress();
    stateRef.current = null;
    overIdRef.current = null;
    setDraggingId(null);
    setOverId(null);
    setGhost(null);
  }, [clearLongPress]);

  const findIdAtPoint = useCallback((x: number, y: number): string | null => {
    const nodes = document.elementsFromPoint(x, y);
    for (const el of nodes) {
      if (!(el instanceof Element)) continue;
      // 고스트·버튼 레이어를 건너뛰고 타일만 잡음
      if (el.closest(".chapter3PhotoDragGhost")) continue;
      const host = el.closest(`[${itemAttrRef.current}]`) as HTMLElement | null;
      const id = host?.getAttribute(itemAttrRef.current);
      if (id) return id;
    }
    return null;
  }, []);

  const commitMove = useCallback((fromId: string, toId: string | null) => {
    const ids = itemIdsRef.current;
    const fromIndex = ids.indexOf(fromId);
    const toIndex = toId ? ids.indexOf(toId) : -1;
    if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
      onReorderRef.current(movePhotoIndex(ids, fromIndex, toIndex));
    }
  }, []);

  const startDragging = useCallback(
    (state: PointerState, x: number, y: number, target?: HTMLElement | null) => {
      state.dragging = true;
      skipClickRef.current = true;
      setDraggingId(state.id);
      updateOverId(state.id);
      setGhost({ x, y });
      if (target) {
        try {
          target.setPointerCapture(state.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (state.pointerType === "touch") {
        try {
          navigator.vibrate?.(10);
        } catch {
          /* ignore */
        }
      }
    },
    [updateOverId],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const state = stateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      const dist = Math.hypot(dx, dy);

      if (!state.dragging) {
        if (state.pointerType === "touch" || state.pointerType === "pen") {
          if (!state.immediate && dist > MOVE_CANCEL_PX) clearLongPress();
          return;
        }
        // 마우스: 핸들이 아니면 약간 움직인 뒤 드래그 시작
        if (!state.immediate && dist < DRAG_START_PX) return;
        const el = document.elementFromPoint(state.startX, state.startY) as HTMLElement | null;
        startDragging(state, event.clientX, event.clientY, el?.closest(`[${itemAttrRef.current}]`) as HTMLElement | null);
      }

      if (!stateRef.current?.dragging) return;
      event.preventDefault();
      setGhost({ x: event.clientX, y: event.clientY });
      const nextOver = findIdAtPoint(event.clientX, event.clientY);
      if (nextOver) updateOverId(nextOver);
    };

    const onUp = (event: PointerEvent) => {
      const state = stateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      const wasDragging = state.dragging;
      const dropId = wasDragging
        ? overIdRef.current || findIdAtPoint(event.clientX, event.clientY)
        : null;
      const fromId = state.id;
      endDrag();

      if (wasDragging) {
        event.preventDefault();
        commitMove(fromId, dropId);
        window.setTimeout(() => {
          skipClickRef.current = false;
        }, 50);
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!stateRef.current?.dragging) return;
      event.preventDefault();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove, true);
    };
  }, [clearLongPress, commitMove, endDrag, findIdAtPoint, startDragging, updateOverId]);

  const beginPointer = useCallback(
    (event: React.PointerEvent<HTMLElement>, id: string, immediate: boolean) => {
      if (event.button !== 0) return;
      if (!canReorderIdRef.current(id)) return;

      // 입력 필드에서는 드래그 시작하지 않음
      const targetEl = event.target as HTMLElement;
      if (targetEl.closest("input, textarea, .chapter3PhotoZoomBtn, .chapter3PhotoTileDelete, .chapter3PhotoTileMapBtn")) {
        return;
      }

      const fromIndex = itemIdsRef.current.indexOf(id);
      if (fromIndex < 0) return;

      const state: PointerState = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        id,
        fromIndex,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        immediate,
      };
      stateRef.current = state;
      skipClickRef.current = false;
      clearLongPress();

      if (immediate) {
        event.preventDefault();
        event.stopPropagation();
        startDragging(state, event.clientX, event.clientY, event.currentTarget);
        return;
      }

      if (event.pointerType === "touch" || event.pointerType === "pen") {
        longPressTimerRef.current = window.setTimeout(() => {
          const current = stateRef.current;
          if (!current || current.pointerId !== state.pointerId || current.dragging) return;
          startDragging(current, current.startX, current.startY, event.currentTarget);
        }, LONG_PRESS_MS);
        return;
      }

      // 마우스: pointermove에서 임계값 넘으면 시작
    },
    [clearLongPress, startDragging],
  );

  const shouldIgnoreClick = useCallback(() => skipClickRef.current, []);

  const getItemProps = useCallback(
    (id: string) => {
      const reorderable = canReorderId(id);
      return {
        [itemAttr]: id,
        onPointerDown: reorderable
          ? (event: React.PointerEvent<HTMLElement>) => beginPointer(event, id, false)
          : undefined,
      };
    },
    [beginPointer, canReorderId, itemAttr],
  );

  const getHandleProps = useCallback(
    (id: string) => {
      const reorderable = canReorderId(id);
      return {
        onPointerDown: reorderable
          ? (event: React.PointerEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
              beginPointer(event, id, true);
            }
          : undefined,
      };
    },
    [beginPointer, canReorderId],
  );

  return {
    draggingId,
    overId,
    ghost,
    html5Drag: false,
    getItemProps,
    getHandleProps,
    shouldIgnoreClick,
  };
}
