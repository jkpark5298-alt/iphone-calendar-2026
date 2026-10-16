import { NextRequest, NextResponse } from "next/server";

import {

  geocodePlaceForMap,

  getNaverGeocodeCredentials,

} from "../../../features/personal-album/utils/naverGeocodeUtils";



type GeocodeRequest = {

  places?: string[];

  regionHint?: string;

};



export async function POST(request: NextRequest) {

  try {

    const body = (await request.json()) as GeocodeRequest;

    const places = Array.isArray(body.places) ? body.places.filter(Boolean) : [];

    const regionHint = body.regionHint?.trim() || undefined;



    if (places.length === 0) {

      return NextResponse.json({ ok: false, error: "places_required" }, { status: 400 });

    }



    const credentials = getNaverGeocodeCredentials();

    if (!credentials) {

      return NextResponse.json({

        ok: false,

        error: "MISSING_SERVER_KEYS",

        useClientFallback: true,

        hint: ".env.local에 NAVER_MAP_CLIENT_SECRET을 추가하세요 (NCP 콘솔 Client Secret).",

      });

    }



    const diagnostics: {

      endpoint: string;

      query: string;

      status: number;

      error?: string;

    }[] = [];



    const results = await Promise.all(

      places.map((place) =>

        geocodePlaceForMap(

          place,

          regionHint,

          credentials.keyId,

          credentials.keySecret,

          diagnostics,

        ),

      ),

    );



    const coords = places

      .map((place, index) => {

        const hit = results[index];

        return hit ? { name: place, lat: hit.lat, lng: hit.lng } : null;

      })

      .filter((c): c is { name: string; lat: number; lng: number } => c !== null);



    const responseBody: Record<string, unknown> = {

      ok: true,

      coords,

      partial: coords.length > 0 && coords.length < places.length,

      failed: places.length - coords.length,

    };



    if (coords.length === 0 && process.env.NODE_ENV === "development") {

      responseBody.diagnostics = diagnostics.slice(0, 8);

      const primary = diagnostics.filter((d) => d.endpoint.includes("maps.apigw"));

      responseBody.hint =

        primary.some((d) => d.status === 401 || d.status === 403)

          ? "NCP 인증 실패: Client ID/Secret 또는 Geocoding API 권한을 확인하세요."

          : primary.some((d) => d.status === 429)

            ? "NCP 호출 한도 초과입니다."

            : "Geocoding API는 주소 검색용입니다. 장소명만 있으면 좌표를 찾지 못합니다. 도로명/지번 주소를 입력하세요.";

    }



    return NextResponse.json(responseBody);

  } catch (error) {

    return NextResponse.json(

      {

        ok: false,

        error: "geocode_failed",

        detail: error instanceof Error ? error.message : String(error),

        useClientFallback: true,

      },

      { status: 500 },

    );

  }

}


