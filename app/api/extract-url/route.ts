import { NextRequest, NextResponse } from "next/server";
import {
  assertAppApiAccess,
  assertRateLimit,
  assertSafePublicHttpUrl,
  clientIpFromRequest,
} from "../../../lib/apiSecurity";

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

const stripHtmlToText = (html: string, title?: string) => {
  const bodyStart = html.indexOf("<body");
  let targetHtml = bodyStart !== -1 ? html.slice(bodyStart) : html;

  // 제목(상품명)이 본문에 있는 경우 그 위치부터 슬라이싱하여 헤더/네비게이션 메뉴 영역을 완전히 배제
  let contentStart = -1;
  let secondTitlePos = -1;

  if (title && !title.includes("http") && title !== "셰에라자드") {
    contentStart = targetHtml.indexOf(title);
    if (contentStart === -1 && title.length > 8) {
      contentStart = targetHtml.indexOf(title.slice(0, 8));
    }

    if (contentStart !== -1) {
      // 본문 하단에 모바일 레이아웃이나 푸터 등으로 인해 제품명 정보가 중복 노출되는 경우를 확인하여 제거
      secondTitlePos = targetHtml.indexOf(title, contentStart + title.length);
      if (secondTitlePos === -1 && title.length > 8) {
        secondTitlePos = targetHtml.indexOf(title.slice(0, 8), contentStart + title.length);
      }
    }
  }

  if (contentStart !== -1) {
    if (secondTitlePos !== -1 && secondTitlePos > contentStart) {
      // 첫 번째 제품명 노출 지점부터 두 번째 중복 노출 지점 직전까지만 슬라이싱하여 완벽한 본문만 추출 (모바일 반복 레이아웃 원천 차단)
      targetHtml = targetHtml.slice(contentStart, secondTitlePos);
    } else {
      targetHtml = targetHtml.slice(contentStart, contentStart + 250000);
    }
  } else {
    targetHtml = targetHtml.slice(0, 200000);
  }

  // 스크립트, 스타일, 노스크립트 영역 제거
  targetHtml = targetHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  // 블록 레벨 태그를 줄바꿈(\n)으로 치환하여 레이아웃/구조 보존 (단, 테이블 셀 td는 가로 공백 처리)
  targetHtml = targetHtml
    .replace(/<(?:br|p|div|tr|li|h1|h2|h3|h4|h5|h6)[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<(?:td)[^>]*>/gi, " ")
    .replace(/<\/(?:td)>/gi, " ");

  // 남아있는 모든 HTML 태그 제거
  targetHtml = targetHtml.replace(/<[^>]+>/g, " ");

  // HTML 엔티티 치환
  targetHtml = targetHtml
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 줄바꿈 및 공백 가독성 정리
  targetHtml = targetHtml.replace(/\r/g, "\n");
  targetHtml = targetHtml.replace(/[ \t]+/g, " ");
  targetHtml = targetHtml.replace(/[ \t]*\n[ \t]*/g, "\n");
  targetHtml = targetHtml.replace(/\n+/g, "\n"); // 연속된 줄바꿈을 단일 줄바꿈으로 병합해 정결한 텍스트 구성

  return targetHtml.trim();
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
    const authError = assertAppApiAccess(request);
    if (authError) return authError;

    const rateError = assertRateLimit(
      `extract-url:${clientIpFromRequest(request)}`,
      30,
      60_000,
    );
    if (rateError) return rateError;

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
    url = await assertSafePublicHttpUrl(url);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    // 리다이렉트는 안전 URL 재검증 후 1회만 추적
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return NextResponse.json(
          { ok: false, error: "URL 내용을 가져오지 못했습니다." },
          { status: 500 },
        );
      }
      const redirected = await assertSafePublicHttpUrl(new URL(location, url).toString());
      const redirectedResponse = await fetch(redirected, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!redirectedResponse.ok) {
        return NextResponse.json(
          { ok: false, error: "URL 내용을 가져오지 못했습니다.", status: redirectedResponse.status },
          { status: 500 },
        );
      }
      // continue with redirectedResponse below by reassigning - use a variable
      return await buildExtractResponse(redirectedResponse, redirected);
    }

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

    return await buildExtractResponse(response, url);
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

async function buildExtractResponse(response: Response, url: string) {
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
  const clippedHtml = html.length > 500_000 ? html.slice(0, 500_000) : html;

  // ReDoS 방지 및 파싱 성능 향상을 위해 head 부분만 슬라이스해서 메타태그 매칭
  const headEndIndex = clippedHtml.indexOf("</head>");
  const headHtml =
    headEndIndex !== -1 ? clippedHtml.slice(0, headEndIndex + 7) : clippedHtml.slice(0, 1024 * 64);

  const siteName = getMetaContent(headHtml, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["'][^>]*>/i,
  ]);

  let title =
    getMetaContent(headHtml, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) || url;

  // 제목이 generic한 경우 (사이트 명과 같거나 셰에라자드 등일 경우) 본문에서 구체적인 제품명 검색
  const isGenericTitle = !title || title === siteName || title.trim() === "셰에라자드";
  if (isGenericTitle) {
    const productTitleRegexes = [
      /class=["'][^"']*(?:product-name|product_name|goods_name|pdp-title)[^"']*["'][^>]*>([\s\S]*?)<\//i,
      /id=["'][^"']*(?:product-name|product_name|goods_name|pdp-title)[^"']*["'][^>]*>([\s\S]*?)<\//i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    ];
    for (const regex of productTitleRegexes) {
      const match = clippedHtml.match(regex);
      if (match?.[1]) {
        const cleanTitle = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (cleanTitle && cleanTitle !== siteName) {
          title = cleanTitle;
          break;
        }
      }
    }
  }

  const description = getMetaContent(headHtml, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
  ]);

  let imageUrl = getMetaContent(headHtml, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
  ]);

  // 이미지가 generic한 로고 등인 경우 본문에서 실제 제품 포스터/대표 이미지 검색 fallback
  const isGenericImage =
    !imageUrl || imageUrl.toLowerCase().includes("logo") || imageUrl.toLowerCase().includes("bi.");
  if (isGenericImage) {
    const bodyImageRegexes = [
      /data-u=["']image["'][^>]+src=["']([^"']+)["']/i,
      /src=["']([^"']+)["']/i,
      /<img[^>]+src=["']([^"']*(?:upload|goods|event)[^"']+\.(?:jpg|png|gif|jpeg))["'][^>]*>/i,
    ];
    for (const regex of bodyImageRegexes) {
      const match = clippedHtml.match(regex);
      if (match?.[1]) {
        const candidate = match[1];
        if (
          !candidate.includes("logo") &&
          !candidate.includes("btn") &&
          !candidate.includes("icon") &&
          !candidate.includes("menu")
        ) {
          imageUrl = candidate;
          break;
        }
      }
    }
  }
  const image = toAbsoluteUrl(url, imageUrl);

  const plainText = stripHtmlToText(clippedHtml, title).slice(0, 1200);

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
}

