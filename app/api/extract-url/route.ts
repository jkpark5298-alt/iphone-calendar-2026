import { NextRequest, NextResponse } from "next/server";

type ExtractUrlRequest = {
  url?: string;
};

// 네이버 블로그 URL 변환 함수
const transformNaverBlogUrl = (url: string): string => {
  try {
    const naverBlogRegex = /https?:\/\/(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9_-]+)\/([0-9]+)/i;
    const match = url.match(naverBlogRegex);
    if (match) {
      const blogId = match[1];
      const logNo = match[2];
      return `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`;
    }
  } catch (e) {
    console.error("Naver blog URL transform error", e);
  }
  return url;
};

const getMetaContent = (html: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
    }
  }

  return "";
};

const stripHtmlToText = (html: string) => {
  // 대용량 HTML 처리를 위해 필요한 부분만 잘라낸 뒤 태그 제거
  const bodyStart = html.indexOf("<body");
  const targetHtml = bodyStart !== -1 ? html.slice(bodyStart, bodyStart + 50000) : html.slice(0, 30000);

  return targetHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
};

const toAbsoluteUrl = (baseUrl: string, value: string) => {
  if (!value) return "";

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
};

const normalizeCharset = (value: string) => {
  const charset = value.toLowerCase().replace(/["']/g, "").trim();

  if (!charset) return "utf-8";
  if (charset.includes("euc-kr")) return "euc-kr";
  if (charset.includes("ks_c_5601")) return "euc-kr";
  if (charset.includes("ks_c_5601-1987")) return "euc-kr";
  if (charset.includes("cp949")) return "euc-kr";
  if (charset.includes("x-windows-949")) return "euc-kr";
  if (charset.includes("windows-949")) return "euc-kr";
  if (charset.includes("utf-8")) return "utf-8";

  return charset;
};

const detectCharsetFromHtml = (htmlHead: string, contentType: string) => {
  const headerMatch = contentType.match(/charset=([^;]+)/i);

  if (headerMatch?.[1]) {
    return normalizeCharset(headerMatch[1]);
  }

  const metaCharsetMatch = htmlHead.match(/<meta[^>]+charset=["']?([^\s"'/>]+)/i);

  if (metaCharsetMatch?.[1]) {
    return normalizeCharset(metaCharsetMatch[1]);
  }

  const metaHttpEquivMatch = htmlHead.match(
    /<meta[^>]+content=["'][^"']*charset=([^"';\s]+)[^"']*["'][^>]*>/i,
  );

  if (metaHttpEquivMatch?.[1]) {
    return normalizeCharset(metaHttpEquivMatch[1]);
  }

  return "utf-8";
};

const decodeHtmlResponse = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 헤더 감지를 위해 앞의 일부만 디코딩
  const utf8Preview = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, Math.min(bytes.length, 8192)),
  );

  const charset = detectCharsetFromHtml(utf8Preview, contentType);

  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ExtractUrlRequest;
    let url = body.url?.trim();

    if (!url) {
      return NextResponse.json(
        { ok: false, error: "유효한 URL이 필요합니다." },
        { status: 400 },
      );
    }

    // 스키마가 없는 경우 https:// 자동 추가
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    // 네이버 블로그 URL 전처리 변환
    url = transformNaverBlogUrl(url);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "URL 내용을 가져오지 못했습니다.",
          status: response.status,
        },
        { status: 500 },
      );
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return NextResponse.json(
        {
          ok: false,
          error: "HTML 페이지가 아닙니다.",
          contentType,
        },
        { status: 400 },
      );
    }

    const html = await decodeHtmlResponse(response);

    // ReDoS 방지 및 파싱 성능 향상을 위해 head 부분만 슬라이스해서 메타태그 매칭
    const headEndIndex = html.indexOf("</head>");
    const headHtml = headEndIndex !== -1 ? html.slice(0, headEndIndex + 7) : html.slice(0, 1024 * 64);

    const title =
      getMetaContent(headHtml, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
        /<title[^>]*>([\s\S]*?)<\/title>/i,
      ]) || url;

    const description = getMetaContent(headHtml, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
    ]);

    const image = toAbsoluteUrl(
      url,
      getMetaContent(headHtml, [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
      ]),
    );

    const siteName = getMetaContent(headHtml, [
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["'][^>]*>/i,
    ]);

    const plainText = stripHtmlToText(html).slice(0, 1200);

    return NextResponse.json({
      ok: true,
      result: {
        url,
        title,
        description,
        image,
        siteName,
        text: [description, plainText].filter(Boolean).join("\n\n").slice(0, 1600),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "URL 자동 추출 중 오류가 발생했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

