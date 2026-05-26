import { NextResponse } from "next/server";

const KMA_NCST_ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
const KMA_FCST_ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst";

// 집 기준 격자값. 필요하면 여기만 바꾸면 됩니다.
const DEFAULT_NX = "56";
const DEFAULT_NY = "130";

type KmaItem = {
  category?: string;
  obsrValue?: string;
  fcstValue?: string;
  fcstTime?: string;
};

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

  // 초단기실황/초단기예보는 보통 매시 40분 이후 자료가 안정적입니다.
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

function skyToText(value?: string) {
  switch (String(value || "")) {
    case "1": return "맑음";
    case "3": return "구름 많음";
    case "4": return "흐림";
    default: return "";
  }
}

function ptyToText(value?: string) {
  switch (String(value || "")) {
    case "0": return "강수 없음";
    case "1": return "비";
    case "2": return "비/눈";
    case "3": return "눈";
    case "5": return "빗방울";
    case "6": return "빗방울/눈날림";
    case "7": return "눈날림";
    default: return "";
  }
}

function weatherIcon(weather: string) {
  if (weather.includes("눈")) return "❄️";
  if (weather.includes("비/눈") || weather.includes("빗방울/눈")) return "🌨️";
  if (weather.includes("비") || weather.includes("빗방울")) return "🌧️";
  if (weather.includes("소나기")) return "🌦️";
  if (weather.includes("흐림")) return "☁️";
  if (weather.includes("구름")) return "⛅";
  if (weather.includes("맑음")) return "☀️";
  return "🌤️";
}

async function fetchKmaItems(endpoint: string, serviceKey: string, baseDate: string, baseTime: string) {
  const params = new URLSearchParams({
    serviceKey,
    pageNo: "1",
    numOfRows: "1000",
    dataType: "JSON",
    base_date: baseDate,
    base_time: baseTime,
    nx: DEFAULT_NX,
    ny: DEFAULT_NY,
  });

  const response = await fetch(`${endpoint}?${params.toString()}`, {
    next: { revalidate: 600 },
  });

  if (!response.ok) {
    throw new Error("기상청 응답 오류");
  }

  const data = await response.json();
  return data?.response?.body?.items?.item || [];
}

function getNearestForecastValue(items: KmaItem[], category: string) {
  const matched = items
    .filter(item => item.category === category)
    .sort((a, b) => String(a.fcstTime || "").localeCompare(String(b.fcstTime || "")));

  return matched[0]?.fcstValue;
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

  try {
    const [ncstItems, fcstItems] = await Promise.all([
      fetchKmaItems(KMA_NCST_ENDPOINT, serviceKey, baseDate, baseTime),
      fetchKmaItems(KMA_FCST_ENDPOINT, serviceKey, baseDate, baseTime).catch(() => []),
    ]);

    const temperature =
      ncstItems.find((item: KmaItem) => item.category === "T1H")?.obsrValue ||
      getNearestForecastValue(fcstItems, "T1H") ||
      "-";

    const precipitationType =
      ncstItems.find((item: KmaItem) => item.category === "PTY")?.obsrValue ||
      getNearestForecastValue(fcstItems, "PTY") ||
      "0";

    const skyValue = getNearestForecastValue(fcstItems, "SKY");

    const skyText = skyToText(skyValue);
    const precipitationText = ptyToText(precipitationType) || "확인 필요";

    const weather =
      precipitationText === "강수 없음"
        ? skyText
          ? `${skyText} · 강수 없음`
          : "강수 없음"
        : skyText
          ? `${skyText} · ${precipitationText}`
          : precipitationText;

    return NextResponse.json({
      ok: true,
      location: "집",
      weather,
      icon: weatherIcon(weather),
      sky: skyText,
      precipitation: precipitationText,
      temperature,
      observedAt,
      baseDate,
      baseTime,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "기상청 조회 오류",
      },
      { status: 502 }
    );
  }
}
