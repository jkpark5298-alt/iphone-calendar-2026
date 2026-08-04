import { NextResponse } from "next/server";
import { getMockNewsItems } from "../../../lib/newsMock";
import type { NewsFeedResponse } from "../../../types/news";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = getMockNewsItems().slice(0, 5);
    const body: NewsFeedResponse = {
      ok: true,
      items,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    const body: NewsFeedResponse = {
      ok: false,
      items: [],
      fetchedAt: new Date().toISOString(),
      message: "뉴스를 불러오지 못했습니다.",
    };
    return NextResponse.json(body, { status: 500 });
  }
}
