import { NextRequest, NextResponse } from "next/server";
import {
  BUILDER_APP_URL,
  IFL_APP_URL,
  NEWSFLASH_APP_URL,
  buildIndexItem,
  extractLibraryItemsFromHtml,
  parseIflLibraryPayload,
  type InfoIndexItem,
} from "../../../lib/infoIndex";

export const dynamic = "force-dynamic";

const FETCH_MS = 12000;

async function fetchText(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json, text/html",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "ko-KR,en;q=0.8",
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    return { text, status: response.status, ok: response.ok };
  } catch (error) {
    return {
      text: "",
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIflLibraryItems(requestToken: string) {
  const token =
    requestToken.trim() ||
    process.env.IFL_API_TOKEN ||
    process.env.IFL_API_SECRET ||
    "";
  if (!token) {
    return {
      items: [] as InfoIndexItem[],
      status: 0,
      error: "no-token",
    };
  }

  const result = await fetchText(`${IFL_APP_URL.replace(/\/$/, "")}/api/items?ts=${Date.now()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.ok) {
    return {
      items: [] as InfoIndexItem[],
      status: result.status,
      error: result.error || `ifl-http-${result.status}`,
    };
  }
  try {
    const payload = JSON.parse(result.text) as unknown;
    return {
      items: parseIflLibraryPayload(payload),
      status: result.status,
      error: "",
    };
  } catch {
    return {
      items: [] as InfoIndexItem[],
      status: result.status,
      error: "ifl-json",
    };
  }
}

type NewsClipIndexRow = {
  id?: string;
  title?: string;
  createdAt?: string;
  deleted?: boolean;
};

async function fetchNewsflashItems() {
  const base = NEWSFLASH_APP_URL.replace(/\/$/, "");
  const result = await fetchText(`${base}/api/news-clip-index?ts=${Date.now()}`);
  if (!result.ok) {
    return {
      items: [] as InfoIndexItem[],
      status: result.status,
      error: result.error || `news-http-${result.status}`,
    };
  }
  try {
    const payload = JSON.parse(result.text) as { items?: NewsClipIndexRow[] };
    const rows = Array.isArray(payload.items) ? payload.items : [];
    const items = rows
      .filter((item) => item && item.id && item.createdAt)
      .map((item) =>
        buildIndexItem({
          id: `newsflash:${item.id}`,
          title: item.title || "제목 없음",
          createdAt: String(item.createdAt),
          categoryRaw: "",
          tags: ["뉴스"],
          source: "newsflash",
          detailUrl: `${base}/?clip=${encodeURIComponent(String(item.id))}`,
          saveStatus: item.deleted ? "삭제됨" : undefined,
        }),
      );
    return { items, status: result.status, error: "" };
  } catch {
    return {
      items: [] as InfoIndexItem[],
      status: result.status,
      error: "news-json",
    };
  }
}

export async function GET(request: NextRequest) {
  const iflToken = request.headers.get("x-ifl-token") || "";
  const [builder, iflCloud, newsflash] = await Promise.all([
    fetchText(BUILDER_APP_URL),
    fetchIflLibraryItems(iflToken),
    fetchNewsflashItems(),
  ]);

  const builderItems: InfoIndexItem[] = extractLibraryItemsFromHtml(builder.text).map((item) =>
    buildIndexItem({
      id: `builder:${item.id}`,
      title: item.title,
      createdAt: item.createdAt,
      tags: item.tags,
      source: "builder-zeta-eight",
      detailUrl: `${BUILDER_APP_URL.replace(/\/$/, "")}/videos/${encodeURIComponent(item.id)}`,
    }),
  );

  return NextResponse.json({
    ok: true,
    items: [...builderItems, ...iflCloud.items, ...newsflash.items],
    sources: {
      builder: {
        count: builderItems.length,
        status: builder.status,
        error: builder.error || "",
      },
      ifl: {
        count: iflCloud.items.length,
        status: iflCloud.status,
        error: iflCloud.error || "",
      },
      news: {
        count: newsflash.items.length,
        status: newsflash.status,
        error: newsflash.error || "",
      },
    },
  });
}
