/**
 * 근무표 캘린더(excel-schedule-calendar) ICS / JSON → 현재 앱 근무 표시 변환
 * - SUMMARY의 본인 근무(myShift)만 사용
 * - 검정색 블록(relatedCoworkers / 익일 타인)은 DESCRIPTION에만 있어 무시
 */

export type ImportedWorkMarkType = "C" | "A" | "당" | "休" | "심야" | "노조";

export type ImportedWorkDayMark = {
  year: number;
  month: number;
  day: number;
  type: ImportedWorkMarkType;
  plus: boolean;
  sourceTitle: string;
};

export type WorkScheduleImportResult = {
  ok: boolean;
  message: string;
  targetName?: string;
  year?: number;
  month?: number;
  marks: ImportedWorkDayMark[];
  skipped: number;
};

const REST_ALIASES = new Set(["休", "휴", "전", "X", "주", "연", "오프", "휴무"]);

function unfoldIcs(text: string) {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unescapeIcs(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseIcsDate(value: string): { year: number; month: number; day: number } | null {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** SUMMARY 예: "박종규 C근무", "박종규 당근무", "박종규 休(휴무)", "박종규 B7(11:00~20:00) 리더" */
export function extractShiftFromSummary(summary: string): string {
  let s = String(summary || "").trim();
  s = s.replace(/\s*리더\s*$/u, "").replace(/^👍\s*/u, "").trim();

  // "이름 + 근무코드..." 형태면 이름 제거
  const named = s.match(/^[가-힣A-Za-z0-9]+?\s+(.+)$/u);
  if (named?.[1]) s = named[1].trim();

  s = s
    .replace(/근무\s*$/u, "")
    .replace(/\(휴무\)\s*$/u, "")
    .replace(/\([^)]*\)\s*$/u, "")
    .trim();

  // "C/김우석" → C
  const slash = s.match(/^([^/\s]+)\s*\//u);
  if (slash?.[1]) return slash[1].trim();

  return s;
}

export function mapShiftToMarkType(rawShift: string): ImportedWorkMarkType | null {
  const shift = String(rawShift || "").trim();
  if (!shift) return null;

  if (REST_ALIASES.has(shift) || /休|휴무/.test(shift)) return "休";
  if (shift === "C" || /^C$/i.test(shift)) return "C";
  if (shift === "A" || /^A$/i.test(shift)) return "A";
  if (shift === "당" || shift === "당직") return "당";
  if (shift === "심야" || shift === "N") return "심야";
  if (shift === "노조") return "노조";

  // 승무 코드 등은 현재 근무 표시에 없음 → 스킵(안전)
  return null;
}

function parseIcsEvents(text: string) {
  const lines = unfoldIcs(text);
  const events: Array<{ summary: string; description: string; start: string }> = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.DTSTART) {
        events.push({
          summary: unescapeIcs(current.SUMMARY || ""),
          description: unescapeIcs(current.DESCRIPTION || ""),
          start: current.DTSTART,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).split(";")[0];
    if (["SUMMARY", "DESCRIPTION", "DTSTART", "DTEND"].includes(key)) {
      current[key] = line.slice(sep + 1);
    }
  }

  return events;
}

/** ICS DESCRIPTION의 검정(relatedCoworkers) 줄은 무시하고 SUMMARY만 사용 */
export function importWorkScheduleFromIcs(icsText: string): WorkScheduleImportResult {
  const events = parseIcsEvents(icsText);
  if (!events.length) {
    return { ok: false, message: "ICS에서 일정을 찾지 못했습니다.", marks: [], skipped: 0 };
  }

  const marks: ImportedWorkDayMark[] = [];
  let skipped = 0;
  let targetName = "";
  const monthCounter = new Map<string, number>();

  for (const event of events) {
    const date = parseIcsDate(event.start);
    if (!date) {
      skipped += 1;
      continue;
    }

    // SUMMARY: "박종규 C근무" → 이름 추출
    const nameMatch = String(event.summary || "").trim().match(/^([가-힣A-Za-z0-9]+)\s+/u);
    if (nameMatch?.[1] && !targetName) targetName = nameMatch[1];

    const rawShift = extractShiftFromSummary(event.summary);
    const type = mapShiftToMarkType(rawShift);
    if (!type) {
      skipped += 1;
      continue;
    }

    marks.push({
      year: date.year,
      month: date.month,
      day: date.day,
      type,
      plus: false,
      sourceTitle: event.summary,
    });

    const mk = `${date.year}-${date.month}`;
    monthCounter.set(mk, (monthCounter.get(mk) || 0) + 1);
  }

  if (!marks.length) {
    return {
      ok: false,
      message: "가져올 수 있는 근무 코드(C/A/당/休/심야/노조)가 없습니다. 검정(타인) 정보는 제외됩니다.",
      marks: [],
      skipped,
      targetName,
    };
  }

  // 가장 많은 월을 대표 월로
  let year = marks[0].year;
  let month = marks[0].month;
  let best = 0;
  for (const [k, count] of monthCounter) {
    if (count > best) {
      best = count;
      const [y, m] = k.split("-").map(Number);
      year = y;
      month = m;
    }
  }

  return {
    ok: true,
    message: `${targetName || "근무표"} ${year}년 ${month}월 ${marks.length}건 준비됨 (타인/익일 검정 제외)`,
    targetName,
    year,
    month,
    marks,
    skipped,
  };
}

type ExcelScheduleDay = {
  date?: number;
  myShift?: string;
  isLeader?: boolean;
  relatedCoworkers?: { label?: string; type?: string; names?: string[] } | null;
};

type ExcelScheduleMonth = {
  targetName?: string;
  year?: number;
  month?: number;
  days?: ExcelScheduleDay[];
};

/**
 * excel-schedule-calendar "PC 저장" JSON도 지원
 * relatedCoworkers(검정)는 읽고 버림, myShift만 반영
 */
export function importWorkScheduleFromJson(raw: unknown): WorkScheduleImportResult {
  let schedule: ExcelScheduleMonth | null = null;

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.days) && obj.year && obj.month) {
      schedule = obj as ExcelScheduleMonth;
    } else if (obj.schedules && typeof obj.schedules === "object") {
      const schedules = obj.schedules as Record<string, ExcelScheduleMonth>;
      const values = Object.values(schedules).filter(Boolean);
      // 가장 최근/첫 월
      schedule = values.sort((a, b) => {
        const ay = Number(a.year || 0) * 100 + Number(a.month || 0);
        const by = Number(b.year || 0) * 100 + Number(b.month || 0);
        return by - ay;
      })[0] || null;
      if (schedule && !schedule.targetName && typeof obj.targetName === "string") {
        schedule = { ...schedule, targetName: obj.targetName };
      }
    }
  }

  if (!schedule?.days?.length || !schedule.year || !schedule.month) {
    return { ok: false, message: "JSON에서 월간 근무표(days)를 찾지 못했습니다.", marks: [], skipped: 0 };
  }

  const marks: ImportedWorkDayMark[] = [];
  let skipped = 0;
  const year = Number(schedule.year);
  const month = Number(schedule.month);

  for (const day of schedule.days) {
    const d = Number(day.date);
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      skipped += 1;
      continue;
    }
    // relatedCoworkers는 의도적으로 무시 (검정색 타인/익일)
    const type = mapShiftToMarkType(String(day.myShift || ""));
    if (!type) {
      skipped += 1;
      continue;
    }
    marks.push({
      year,
      month,
      day: d,
      type,
      plus: false,
      sourceTitle: `${schedule.targetName || ""} ${day.myShift}`.trim(),
    });
  }

  if (!marks.length) {
    return {
      ok: false,
      message: "JSON에 반영 가능한 본인 근무(myShift)가 없습니다.",
      marks: [],
      skipped,
      targetName: schedule.targetName,
      year,
      month,
    };
  }

  return {
    ok: true,
    message: `${schedule.targetName || "근무표"} ${year}년 ${month}월 ${marks.length}건 준비됨 (검정/타인 제외)`,
    targetName: schedule.targetName,
    year,
    month,
    marks,
    skipped,
  };
}

export async function importWorkScheduleFromFile(file: File): Promise<WorkScheduleImportResult> {
  const name = String(file.name || "").toLowerCase();
  const text = await file.text();

  if (name.endsWith(".ics") || /BEGIN:VCALENDAR/i.test(text)) {
    return importWorkScheduleFromIcs(text);
  }

  if (name.endsWith(".json") || text.trimStart().startsWith("{")) {
    try {
      return importWorkScheduleFromJson(JSON.parse(text));
    } catch {
      return { ok: false, message: "JSON 파싱에 실패했습니다.", marks: [], skipped: 0 };
    }
  }

  // 내용으로 재시도
  if (/BEGIN:VCALENDAR/i.test(text)) return importWorkScheduleFromIcs(text);
  try {
    return importWorkScheduleFromJson(JSON.parse(text));
  } catch {
    return {
      ok: false,
      message: "지원 형식: 근무표 ICS(.ics) 또는 PC 저장 JSON(.json)",
      marks: [],
      skipped: 0,
    };
  }
}
