import { NextResponse } from "next/server";

type ParsedEvent = {
  title: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  startDateKey?: string;
};

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

function parseTime(value: string) {
  const match = value.match(/T(\d{2})(\d{2})/);
  if (!match) return undefined;
  return `${match[1]}:${match[2]}`;
}

function toDateKey(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseIcs(text: string, targetDate: string) {
  const lines = unfoldIcs(text);
  const events: ParsedEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (current) {
        const rawStart = current.DTSTART || "";
        const dateKey = toDateKey(rawStart);
        if (dateKey === targetDate) {
          const allDay = !rawStart.includes("T");
          events.push({
            title: unescapeIcs(current.SUMMARY || "제목 없는 일정"),
            start: parseTime(rawStart),
            end: parseTime(current.DTEND || ""),
            allDay,
            startDateKey: dateKey,
          });
        }
      }
      current = null;
      continue;
    }

    if (!current) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) continue;

    const keyPart = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    const key = keyPart.split(";")[0];

    if (["SUMMARY", "DTSTART", "DTEND"].includes(key)) {
      current[key] = value;
    }
  }

  return events.sort((a, b) => String(a.start || "00:00").localeCompare(String(b.start || "00:00")));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || "";
  const calendarUrl = process.env.GOOGLE_CALENDAR_ICS_URL;

  if (!/^2026-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, message: "date 값이 필요합니다." }, { status: 400 });
  }

  if (!calendarUrl) {
    return NextResponse.json({ ok: true, items: [], message: "GOOGLE_CALENDAR_ICS_URL이 설정되지 않았습니다." });
  }

  try {
    const response = await fetch(calendarUrl, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, message: "구글 캘린더 ICS 응답 오류", status: response.status },
        { status: 502 }
      );
    }

    const text = await response.text();
    const items = parseIcs(text, date).map(({ startDateKey, ...item }) => item);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "구글 일정 조회 오류";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
