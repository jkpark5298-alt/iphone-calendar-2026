/** 일정 알림(푸시) 시각 계산. 서버(dispatch)에서 쓰고, 시간대는 한국 시간(KST) 기준이다. */
import { occurrenceStartsOn, ymdToTime } from "./scheduleOccurrence";

export const REMIND_OPTIONS = [
  { value: "", label: "없음" },
  { value: "at", label: "정시" },
  { value: "10m", label: "10분 전" },
  { value: "1h", label: "1시간 전" },
  { value: "1d", label: "전날 저녁 8시" },
];

export function remindLabel(value?: string) {
  return REMIND_OPTIONS.find((option) => option.value === (value || ""))?.label || "";
}

export type RemindRow = {
  schedule_id: string;
  title: string;
  start_date: string;
  start_time?: string | null;
  repeat?: string | null;
  remind?: string | null;
};

export type DueReminder = {
  scheduleId: string;
  /** 알림을 보낸 일정 날짜(YYYY-MM-DD). 반복 일정은 날짜마다 따로 센다. */
  occurrence: string;
  remind: string;
  title: string;
  body: string;
  fireMs: number;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** 시간이 없는(종일) 일정은 이 시각을 기준으로 알린다. */
const ALL_DAY_HOUR = 9;
const EVENING_HOUR = 20;

const pad2 = (n: number) => String(n).padStart(2, "0");

function parseHm(value?: string | null): { hour: number; minute: number } | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** KST 달력 날짜(년·월·일)와 시각으로 실제 시각(ms)을 만든다. */
function kstWallToMs(year: number, month: number, day: number, hour: number, minute: number) {
  return Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
}

export function dueReminders(rows: RemindRow[], nowMs: number, graceMs = 40 * MINUTE_MS): DueReminder[] {
  const kstNow = new Date(nowMs + KST_OFFSET_MS);
  const results: DueReminder[] = [];

  // 어제~모레 사이에 시작하는 일정만 본다(전날 저녁 알림은 하루 전 날짜가 기준).
  for (let offset = -1; offset <= 2; offset++) {
    const day = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + offset));
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const date = day.getUTCDate();
    const occurrence = `${year}-${pad2(month)}-${pad2(date)}`;
    const targetTime = ymdToTime(occurrence);
    if (targetTime === null) continue;

    for (const row of rows) {
      const remind = row.remind || "";
      if (!remind) continue;
      const startTime = ymdToTime(row.start_date);
      if (startTime === null || !occurrenceStartsOn(startTime, row.repeat || "없음", targetTime)) continue;

      const hm = parseHm(row.start_time);
      const hour = hm ? hm.hour : ALL_DAY_HOUR;
      const minute = hm ? hm.minute : 0;
      const timeLabel = hm ? `${pad2(hm.hour)}:${pad2(hm.minute)}` : "종일";

      let fireMs: number;
      let body: string;
      if (remind === "at") {
        fireMs = kstWallToMs(year, month, date, hour, minute);
        body = hm ? `지금 시작 · ${timeLabel}` : "오늘 종일 일정";
      } else if (remind === "10m" || remind === "1h") {
        const minutesBefore = remind === "10m" ? 10 : 60;
        fireMs = kstWallToMs(year, month, date, hour, minute) - minutesBefore * MINUTE_MS;
        body = `${remind === "10m" ? "10분" : "1시간"} 후 · ${timeLabel}`;
      } else if (remind === "1d") {
        fireMs = kstWallToMs(year, month, date - 1, EVENING_HOUR, 0);
        body = `내일 ${timeLabel}`;
      } else {
        continue;
      }

      if (fireMs <= nowMs && fireMs > nowMs - graceMs) {
        results.push({ scheduleId: row.schedule_id, occurrence, remind, title: row.title, body, fireMs });
      }
    }
  }
  return results;
}
