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
