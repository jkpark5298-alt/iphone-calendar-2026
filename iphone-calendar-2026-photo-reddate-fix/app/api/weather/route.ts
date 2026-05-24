import { NextResponse } from "next/server";

const KMA_ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";

function getKstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function getBaseDateTime() {
  const now = getKstNow();
  let hour = now.getUTCHours();
  const minute = now.getUTCMinutes();

  if (minute < 40) hour -= 1;

  const base = new Date(now);
  if (hour < 0) {
    base.setUTCDate(base.getUTCDate() - 1);
    hour = 23;
  }

  const yyyy = base.getUTCFullYear();
  const mm = pad(base.getUTCMonth() + 1);
  const dd = pad(base.getUTCDate());

  return {
    baseDate: `${yyyy}${mm}${dd}`,
    baseTime: `${pad(hour)}00`,
    observedAt: `${yyyy}. ${Number(mm)}. ${Number(dd)}. ${pad(hour)}:00`,
  };
}

function ptyToWeather(value?: string) {
  switch (value) {
    case "0": return "강수없음";
    case "1": return "비";
    case "2": return "비/눈";
    case "3": return "눈";
    case "5": return "빗방울";
    case "6": return "빗방울/눈날림";
    case "7": return "눈날림";
    default: return "확인 필요";
  }
}

export async function GET() {
  const serviceKey = process.env.KMA_SERVICE_KEY;

  if (!serviceKey) {
    return NextResponse.json(
      { ok: false, message: "KMA_SERVICE_KEY 환경변수가 필요합니다." },
      { status: 500 }
    );
  }

  const { baseDate, baseTime, observedAt } = getBaseDateTime();

  const params = new URLSearchParams({
    serviceKey,
    pageNo: "1",
    numOfRows: "100",
    dataType: "JSON",
    base_date: baseDate,
    base_time: baseTime,
    nx: "56",
    ny: "130",
  });

  const response = await fetch(`${KMA_ENDPOINT}?${params.toString()}`, {
    next: { revalidate: 600 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { ok: false, message: "기상청 응답 오류" },
      { status: 502 }
    );
  }

  const data = await response.json();
  const items = data?.response?.body?.items?.item || [];

  const temperature = items.find((item: any) => item.category === "T1H")?.obsrValue;
  const precipitationType = items.find((item: any) => item.category === "PTY")?.obsrValue;

  return NextResponse.json({
    ok: true,
    location: "집",
    weather: ptyToWeather(precipitationType),
    temperature,
    observedAt,
    baseDate,
    baseTime,
  });
}
