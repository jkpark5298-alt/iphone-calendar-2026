/** 음력 날짜 표기. 아이폰 기본 캘린더처럼 음력 1일·10일·20일에만 "음 10.1" 형태로 돌려준다. */

let formatter: Intl.DateTimeFormat | null | undefined;

function getFormatter() {
  if (formatter !== undefined) return formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-u-ca-chinese-nu-latn", { month: "numeric", day: "numeric" });
  } catch {
    formatter = null;
  }
  return formatter;
}

/** 날짜의 음력 월·일. 윤달이면 leap=true. 계산할 수 없으면 null. */
export function lunarParts(date: Date): { month: number; day: number; leap: boolean } | null {
  const format = getFormatter();
  if (!format) return null;
  try {
    const parts = format.formatToParts(date);
    const monthText = parts.find((part) => part.type === "month")?.value || "";
    const day = Number(parts.find((part) => part.type === "day")?.value);
    const matched = /^(\d+)(bis)?$/.exec(monthText);
    if (!matched || !Number.isFinite(day)) return null;
    return { month: Number(matched[1]), day, leap: Boolean(matched[2]) };
  } catch {
    return null;
  }
}

const SHOWN_LUNAR_DAYS = new Set([1, 10, 20]);

export function lunarLabel(year: number, month: number, day: number): string {
  const format = getFormatter();
  if (!format) return "";
  try {
    const parts = format.formatToParts(new Date(year, month - 1, day, 12));
    const monthText = parts.find((part) => part.type === "month")?.value || "";
    const lunarDay = Number(parts.find((part) => part.type === "day")?.value);
    if (!SHOWN_LUNAR_DAYS.has(lunarDay)) return "";
    const matched = /^(\d+)(bis)?$/.exec(monthText);
    if (!matched) return "";
    return `음 ${matched[2] ? "윤" : ""}${Number(matched[1])}.${lunarDay}`;
  } catch {
    return "";
  }
}
