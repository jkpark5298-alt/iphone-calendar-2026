"use client";

import { useMemo, useState } from "react";
import { Type, X } from "lucide-react";
import { renderTextToImageDataUrl } from "../lib/collectTextToImage";

const BG_PRESETS = [
  { id: "white", label: "흰 배경", bg: "#ffffff", fg: "#1a2430" },
  { id: "cream", label: "크림", bg: "#f8f4ec", fg: "#1a2430" },
  { id: "ink", label: "다크", bg: "#1a2430", fg: "#f8fafc" },
  { id: "accent", label: "강조", bg: "#fff7ed", fg: "#9a3412" },
] as const;

/** builder TextToImageModal 핵심 기능 이식 */
export function TextToImageModal({
  onCancel,
  onInsert,
  initialText = "",
}: {
  onCancel: () => void;
  onInsert: (dataUrl: string) => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const [fontSize, setFontSize] = useState(28);
  const [preset, setPreset] = useState<(typeof BG_PRESETS)[number]["id"]>("white");
  const [align, setAlign] = useState<"left" | "center">("left");
  const [busy, setBusy] = useState(false);

  const colors = useMemo(
    () => BG_PRESETS.find((p) => p.id === preset) ?? BG_PRESETS[0],
    [preset],
  );

  const previewUrl = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return renderTextToImageDataUrl(text, {
        fontSize,
        backgroundColor: colors.bg,
        textColor: colors.fg,
        align,
        maxWidth: 640,
      });
    } catch {
      return null;
    }
  }, [text, fontSize, colors, align]);

  async function insert() {
    if (!text.trim()) {
      alert("텍스트를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const url = renderTextToImageDataUrl(text, {
        fontSize,
        backgroundColor: colors.bg,
        textColor: colors.fg,
        align,
        maxWidth: 900,
      });
      onInsert(url);
    } catch {
      alert("이미지 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="collectModalOverlay">
      <div className="collectModalPanel collectModalPanelTall">
        <div className="collectModalHeader">
          <p>
            <Type size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            텍스트 → 이미지
          </p>
          <button type="button" onClick={onCancel} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        <div className="collectModalBody">
          <label className="collectModalField">
            텍스트 입력
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="이미지로 넣을 문장을 입력하세요…"
            />
          </label>
          <div className="collectTextImageOptions">
            <label>
              크기
              <input
                type="range"
                min={16}
                max={48}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
              <span>{fontSize}px</span>
            </label>
            <div className="collectTextImagePresets">
              {BG_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={preset === p.id ? "active" : ""}
                  onClick={() => setPreset(p.id)}
                  style={{ background: p.bg, color: p.fg }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="collectTextImageAlign">
              <button
                type="button"
                className={align === "left" ? "active" : ""}
                onClick={() => setAlign("left")}
              >
                왼쪽
              </button>
              <button
                type="button"
                className={align === "center" ? "active" : ""}
                onClick={() => setAlign("center")}
              >
                가운데
              </button>
            </div>
          </div>
          {previewUrl && (
            <div className="collectTextImagePreview">
              <img src={previewUrl} alt="미리보기" />
            </div>
          )}
          <div className="collectModalActions">
            <button type="button" className="collectModalSecondaryBtn" onClick={onCancel}>
              취소
            </button>
            <button
              type="button"
              className="collectModalPrimaryBtn"
              onClick={() => void insert()}
              disabled={busy}
            >
              {busy ? "생성 중…" : "본문에 넣기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
