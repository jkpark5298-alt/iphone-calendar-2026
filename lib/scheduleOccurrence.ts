/** 일정이 특정 날짜에 보이는지 계산한다(시작일~종료일 범위 + 반복). */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SPAN_DAYS = 366;

export function ymdToTime(value?: string): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day).getTime();
}

export function timeToYmd(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 날짜(YYYY-MM-DD)에 일수를 더한다. 형식이 잘못되면 그대로 돌려준다. */
export function addDaysToYmd(value: string, days: number): string {
  const time = ymdToTime(value);
  if (time === null) return value;
  const date = new Date(time);
  date.setDate(date.getDate() + days);
  return timeToYmd(date.getTime());
}

export function daysBetweenYmd(from?: string, to?: string): number {
  const a = ymdToTime(from);
  const b = ymdToTime(to);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / DAY_MS);
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** 반복 규칙에 따라 occurrence(날짜)가 시작일(start)의 반복 날짜인지. */
function repeatMatches(start: Date, occurrence: Date, repeat: string): boolean {
  switch (repeat) {
    case "매일":
      return true;
    case "매주":
      return Math.round((occurrence.getTime() - start.getTime()) / DAY_MS) % 7 === 0;
    case "매월":
      // 31일 같은 날짜가 없는 달은 그 달의 마지막 날에 표시한다.
      return occurrence.getDate() === Math.min(start.getDate(), daysInMonth(occurrence.getFullYear(), occurrence.getMonth()));
    case "매년":
      return (
        occurrence.getMonth() === start.getMonth() &&
        occurrence.getDate() === Math.min(start.getDate(), daysInMonth(occurrence.getFullYear(), occurrence.getMonth()))
      );
    default:
      return false;
  }
}

/**
 * @param startTime 시작일(자정, ms)
 * @param endTime 종료일(자정, ms). 시작일보다 앞서면 서로 바꿔 처리한다.
 * @param repeat 없음 | 매일 | 매주 | 매월 | 매년
 * @param targetTime 보려는 날짜(자정, ms)
 */
export function scheduleOccursOn(startTime: number, endTime: number, repeat: string | undefined, targetTime: number): boolean {
  const first = Math.min(startTime, endTime);
  const last = Math.max(startTime, endTime);
  if (!repeat || repeat === "없음") return targetTime >= first && targetTime <= last;
  if (targetTime < first) return false;

  const span = Math.min(Math.round((last - first) / DAY_MS), MAX_SPAN_DAYS);
  const start = new Date(first);
  for (let back = 0; back <= span; back++) {
    const occurrence = new Date(targetTime);
    occurrence.setDate(occurrence.getDate() - back);
    if (occurrence.getTime() < first) break;
    if (repeatMatches(start, occurrence, repeat)) return true;
  }
  return false;
}
