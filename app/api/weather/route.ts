import { NextResponse } from "next/server";

const KMA_ENDPOINT =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";

type KmaItem = {
  category: string;
  obsrValue: string;
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

  // 기상청 초단기실황은 자료 반영 시간이 조금 늦을 수 있어
  // 40분 이전이면 이전 시간 자료를 조회합니다.
  if (minute < 40) {
    hour -= 1;
  }

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
    case "0":
      return "강수 없음";
    case "1":
      return "비";
    case "2":
      return "비/눈";
    case "3":
      return "눈";
    case "5":
      return "빗방울";
    case "6":
      return "빗방울/눈날림";
    case "7":
      return "눈날림";
    default:
      return "확인 필요";
  }
}

function buildKmaUrl() {
  const serviceKey = process.env.KMA_SERVICE_KEY;

  if (!serviceKey) {
    throw new Error("KMA_SERVICE_KEY가 설정되지 않았습니다.");
  }

  const { baseDate, baseTime } = getBaseDateTime();

  const params = new URLSearchParams({
    pageNo: "1",
    numOfRows: "100",
    dataType: "JSON",
    base_date: baseDate,
    base_time: baseTime,
    nx: "56",
    ny: "130",
  });

  /*
    공공데이터포털 서비스키는 두 종류가 있습니다.

    1. Encoding 인증키
       - 보통 %2F, %2B 같은 문자가 포함됨
       - 이미 인코딩된 상태이므로 다시 encodeURIComponent 처리하면 오류가 날 수 있음

    2. Decoding 인증키
       - 일반 문자열 형태
       - URL에 넣을 때 encodeURIComponent 처리 필요

    그래서 % 문자가 포함되어 있으면 이미 인코딩된 키로 보고 그대로 사용합니다.
  */
  const safeServiceKey = serviceKey.includes("%")
    ? serviceKey
    : encodeURIComponent(serviceKey);

  return `${KMA_ENDPOINT}?serviceKey=${safeServiceKey}&${params.toString()}`;
}

export async function GET() {
  try {
    const { baseDate, baseTime, observedAt } = getBaseDateTime();
    const url = buildKmaUrl();

    const response = await fetch(url, {
      next: { revalidate: 600 },
    });

    const rawText = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "기상청 응답 오류",
          status: response.status,
          detail: rawText.slice(0, 500),
          baseDate,
          baseTime,
        },
        { status: 502 }
      );
    }

    let data: any;

    try {
      data = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          message: "기상청 응답이 JSON 형식이 아닙니다.",
          detail: rawText.slice(0, 500),
          baseDate,
          baseTime,
        },
        { status: 502 }
      );
    }

    const header = data?.response?.header;
    const resultCode = header?.resultCode;
    const resultMsg = header?.resultMsg;

    if (resultCode && resultCode !== "00") {
      return NextResponse.json(
        {
          ok: false,
          message: "기상청 API 오류",
          resultCode,
          resultMsg,
          baseDate,
          baseTime,
        },
        { status: 502 }
      );
    }

    const items: KmaItem[] = data?.response?.body?.items?.item || [];

    if (!items.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "기상청 데이터가 없습니다.",
          baseDate,
          baseTime,
        },
        { status: 502 }
      );
    }

    const temperature = items.find((item) => item.category === "T1H")?.obsrValue;
    const precipitationType = items.find((item) => item.category === "PTY")?.obsrValue;
    const humidity = items.find((item) => item.category === "REH")?.obsrValue;
    const windSpeed = items.find((item) => item.category === "WSD")?.obsrValue;

    return NextResponse.json({
      ok: true,
      location: "집",
      weather: ptyToWeather(precipitationType),
      temperature: temperature ? `${temperature}℃` : "확인 필요",
      humidity: humidity ? `${humidity}%` : undefined,
      windSpeed: windSpeed ? `${windSpeed}m/s` : undefined,
      observedAt,
      baseDate,
      baseTime,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 }
    );
  }
}