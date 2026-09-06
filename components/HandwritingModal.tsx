"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** builder HandwritingModal 이식 */
export function HandwritingModal({
  onCancel,
  onInsert,
}: {
  onCancel: () => void;
  onInsert: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState("#1a2430");
  const [size, setSize] = useState(3);

  const pos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  }, []);

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="collectModalOverlay">
      <div className="collectModalPanel">
        <div className="collectModalHeader">
          <p>손글씨 (굿노트 스타일)</p>
          <button type="button" onClick={onCancel} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        <div className="collectModalBody">
          <div className="collectHandwritingTools">
            {["#1a2430", "#b91c1c", "#1d4ed8", "#15803d"].map((c) => (
              <button
                key={c}
                type="button"
                className={`collectHandwritingColor ${color === c ? "active" : ""}`}
                onClick={() => setColor(c)}
                style={{ background: c }}
                title={c}
              />
            ))}
            <label className="collectHandwritingSize">
              굵기
              <input
                type="range"
                min={1}
                max={12}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
            </label>
            <button type="button" className="collectModalSecondaryBtn" onClick={clear}>
              지우기
            </button>
          </div>
          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            className="collectHandwritingCanvas"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
          <div className="collectModalActions">
            <button type="button" className="collectModalSecondaryBtn" onClick={onCancel}>
              취소
            </button>
            <button
              type="button"
              className="collectModalPrimaryBtn"
              onClick={() => {
                const url = canvasRef.current?.toDataURL("image/png");
                if (url) onInsert(url);
              }}
            >
              본문에 넣기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
