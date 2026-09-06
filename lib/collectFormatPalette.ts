/** builder report-editor-utils 팔레트 (서식 툴바용) */

export const COLLECT_TEXT_COLORS = [
  { id: "black", label: "검정", color: "#1a2430" },
  { id: "yellow", label: "노랑", color: "#b45309" },
  { id: "blue", label: "파랑", color: "#1d4ed8" },
  { id: "red", label: "빨강", color: "#b91c1c" },
  { id: "green", label: "녹색", color: "#15803d" },
] as const;

export const COLLECT_HIGHLIGHT_COLORS = [
  { id: "yellow", label: "노랑", bg: "#fef08a" },
  { id: "blue", label: "파랑", bg: "#bfdbfe" },
  { id: "red", label: "빨강", bg: "#fecaca" },
  { id: "green", label: "녹색", bg: "#bbf7d0" },
] as const;

export const COLLECT_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28] as const;

export const COLLECT_CIRCLED_NUMBERS = [
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

export function stepCollectFontSize(current: number, delta: number): number {
  const sizes = [...COLLECT_FONT_SIZES];
  let idx = sizes.findIndex((s) => s >= current);
  if (idx === -1) idx = sizes.length - 1;
  const next = Math.min(sizes.length - 1, Math.max(0, idx + delta));
  return sizes[next]!;
}
