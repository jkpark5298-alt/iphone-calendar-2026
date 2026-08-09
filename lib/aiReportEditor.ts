/** 다크 배경(#020617)용 글자색 — 밝은 팔레트 */
export const AI_REPORT_TEXT_COLORS = [
  { id: "white", label: "흰색", color: "#f8fafc" },
  { id: "gray", label: "회색", color: "#94a3b8" },
  { id: "cyan", label: "시안", color: "#38bdf8" },
  { id: "amber", label: "노랑", color: "#fef08a" },
  { id: "rose", label: "장미", color: "#fb7185" },
  { id: "mint", label: "민트", color: "#4ade80" },
] as const;

export const AI_REPORT_HIGHLIGHT_COLORS = [
  { id: "yellow", label: "노랑", bg: "#fef08a" },
  { id: "blue", label: "파랑", bg: "#bfdbfe" },
  { id: "pink", label: "분홍", bg: "#fecaca" },
  { id: "green", label: "녹색", bg: "#bbf7d0" },
] as const;

export const AI_REPORT_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28] as const;

export const AI_REPORT_CIRCLED_NUMBERS = [
  "①",
  "②",
  "③",
  "④",
  "⑤",
  "⑥",
  "⑦",
  "⑧",
  "⑨",
  "⑩",
] as const;

export function stepAiReportFontSize(current: number, delta: number): number {
  const sizes = [...AI_REPORT_FONT_SIZES];
  let idx = sizes.findIndex((s) => s >= current);
  if (idx === -1) idx = sizes.length - 1;
  const next = Math.min(sizes.length - 1, Math.max(0, idx + delta));
  return sizes[next]!;
}

function parseCssColorToRgb(value: string): [number, number, number] | null {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (v === "black") return [0, 0, 0];
  if (v === "white") return [255, 255, 255];
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** 다크 배경에서 읽기 어려운 어두운 글자색인지 */
export function isAiReportColorTooDark(color: string): boolean {
  const rgb = parseCssColorToRgb(color);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance < 0.38;
}

/** 인라인 color가 너무 어두우면 밝은 기본색으로 교체 (border-color 등은 제외) */
export function rewriteDarkAiReportTextColors(html: string): string {
  return String(html || "").replace(
    /(^|[;\s"'])color\s*:\s*([^;"'!]+)/gi,
    (full, prefix: string, raw: string) => {
      const value = String(raw || "").trim();
      if (!value || !isAiReportColorTooDark(value)) return full;
      return `${prefix}color: #e2e8f0`;
    },
  );
}

export function normalizeAiReportEditorHtml(html: string): string {
  const trimmed = String(html || "").trim();
  if (!trimmed || trimmed === "<p><br></p>" || trimmed === "<p></p>" || trimmed === "<br>") {
    return "<p></p>";
  }
  return rewriteDarkAiReportTextColors(trimmed);
}
