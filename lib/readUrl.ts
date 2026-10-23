import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { assertSafePublicHttpUrl } from "./apiSecurity";
import { mirrorRemoteImage } from "./mirrorImage";

/** 읽기 도구(Reader) 형식으로 웹페이지 본문을 가져온다. 서버에서만 쓴다. */

const MAX_DOWNLOAD_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
/** 서버가 저장하는 본문 HTML 한도(200,000자)보다 충분히 작게 자른다. */
const MAX_BODY_HTML = 120_000;
/** 원본 주소가 며칠 뒤 깨지는 것을 막기 위해 앞쪽 사진만 우리 저장소로 복사한다. */
const MAX_MIRRORED_IMAGES = 5;
const MIRROR_TIMEOUT_MS = 12_000;
const MIN_ARTICLE_CHARS = 120;

export class ReadUrlError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

export type ReadUrlResult = {
  url: string;
  title: string;
  siteName: string;
  byline: string;
  publishedTime: string;
  html: string;
  textLength: number;
  imageCount: number;
  mirroredCount: number;
  truncated: boolean;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 네이버 블로그 글은 본문이 iframe 안에 있어서 본문 전용 주소로 바꾼다. */
function transformNaverBlogUrl(url: string) {
  const match = url.match(/https?:\/\/(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9_-]+)\/([0-9]+)/i);
  return match ? `https://blog.naver.com/PostView.naver?blogId=${match[1]}&logNo=${match[2]}` : url;
}

function normalizeCharset(value: string) {
  const charset = value.toLowerCase().replace(/["']/g, "").trim();
  if (!charset) return "utf-8";
  if (/euc-kr|ks_c_5601|cp949|windows-949/.test(charset)) return "euc-kr";
  if (charset.includes("utf-8") || charset.includes("utf8")) return "utf-8";
  return charset;
}

function detectCharset(head: string, contentType: string) {
  const header = contentType.match(/charset=([^;]+)/i);
  if (header?.[1]) return normalizeCharset(header[1]);
  const meta = head.match(/<meta[^>]+charset=["']?([^\s"'/>]+)/i);
  if (meta?.[1]) return normalizeCharset(meta[1]);
  const equiv = head.match(/<meta[^>]+content=["'][^"']*charset=([^"';\s]+)[^"']*["'][^>]*>/i);
  if (equiv?.[1]) return normalizeCharset(equiv[1]);
  return "utf-8";
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new ReadUrlError("페이지가 너무 커서 읽을 수 없습니다.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** 안전한 주소만 따라가며(리다이렉트도 매번 검사) 페이지 HTML을 받는다. */
async function fetchPageHtml(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = await assertSafePublicHttpUrl(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ReadUrlError("페이지를 가져오지 못했습니다.", 502);
      current = await assertSafePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      throw new ReadUrlError(`페이지를 가져오지 못했습니다. (응답 ${response.status})`, 502);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new ReadUrlError("HTML 웹페이지가 아닙니다.", 400);
    }
    const bytes = await readCapped(response);
    const preview = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 8192));
    const charset = detectCharset(preview, contentType);
    let html: string;
    try {
      html = new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch {
      html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
    return { html, finalUrl: current };
  }
  throw new ReadUrlError("이동(리다이렉트)이 너무 많습니다.", 502);
}

const ALLOWED_TAGS = new Set([
  "p", "br", "div", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote",
  "strong", "b", "em", "i", "u", "a", "img", "hr", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td",
]);
const DROP_TAGS = new Set([
  "script", "style", "noscript", "iframe", "object", "embed", "form", "button", "input",
  "select", "textarea", "svg", "canvas", "audio", "video", "source", "link", "meta", "template",
]);
const NON_ARTICLE_IMAGE_RE = /(^|[/_.\-=])(logo|icon|avatar|profile|reporter|banner|btn|sprite|pixel|blank|spacer|emoticon)([/_.\-=]|\d|$)/i;
const LAZY_IMAGE_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-origin-src", "data-actualsrc"];

function absolute(base: string, value: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function isHttp(value: string) {
  return /^https?:\/\//i.test(value);
}

/** 느리게 불러오는 사진(data-src 등)을 src로 옮겨 Readability가 사진을 버리지 않게 한다. */
function prepareLazyImages(document: any) {
  for (const img of Array.from(document.querySelectorAll("img")) as any[]) {
    const lazy = LAZY_IMAGE_ATTRS.map((name) => img.getAttribute(name)).find((v) => v && v.trim());
    const src = img.getAttribute("src") || "";
    if (lazy && (!src || src.startsWith("data:") || /placeholder|blank|spacer|loading/i.test(src))) {
      img.setAttribute("src", lazy.trim());
    }
    if (!img.getAttribute("src")) {
      const srcset = img.getAttribute("srcset") || "";
      const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      if (first) img.setAttribute("src", first);
    }
  }
}

/** 허용한 태그와 속성만 남기고, 주소는 절대 주소로 바꾼다. */
function sanitizeContent(contentHtml: string, baseUrl: string) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${contentHtml}</div></body></html>`) as any;
  const root = document.getElementById("root");

  // 사진 설명(figcaption)은 문단으로 바꾼다. (figure 자체는 풀어서 들여쓰기를 없앤다)
  for (const caption of Array.from(root.querySelectorAll("figcaption")) as any[]) {
    const paragraph = document.createElement("p");
    while (caption.firstChild) paragraph.appendChild(caption.firstChild);
    caption.replaceWith(paragraph);
  }

  const walk = (node: any) => {
    for (const child of Array.from(node.childNodes) as any[]) {
      if (child.nodeType === 8) {
        child.remove();
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = String(child.tagName).toLowerCase();
      if (DROP_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      walk(child);
      if (!ALLOWED_TAGS.has(tag)) {
        // 허용하지 않는 태그는 겉만 벗기고 안의 내용은 살린다.
        while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      const keep: Record<string, string> = {};
      if (tag === "a") {
        const href = absolute(baseUrl, child.getAttribute("href") || "");
        if (isHttp(href)) keep.href = href;
      } else if (tag === "img") {
        const src = absolute(baseUrl, child.getAttribute("src") || "");
        if (!isHttp(src)) {
          child.remove();
          continue;
        }
        // 기자 프로필, 로고, 아이콘, 아주 작은 사진은 본문 사진이 아니므로 뺀다.
        const width = parseInt(child.getAttribute("width") || "0", 10);
        const height = parseInt(child.getAttribute("height") || "0", 10);
        const linkHref = child.closest("a")?.getAttribute("href") || "";
        if (
          NON_ARTICLE_IMAGE_RE.test(src) ||
          /reporter|author|profile|byline/i.test(linkHref) ||
          (width > 0 && width < 100) ||
          (height > 0 && height < 100)
        ) {
          child.remove();
          continue;
        }
        keep.src = src;
        const alt = child.getAttribute("alt");
        if (alt) keep.alt = alt.slice(0, 200);
      } else if ((tag === "td" || tag === "th") && child.getAttribute("colspan")) {
        keep.colspan = child.getAttribute("colspan");
      }
      for (const attr of Array.from(child.attributes) as any[]) child.removeAttribute(attr.name);
      for (const [name, value] of Object.entries(keep)) child.setAttribute(name, value);
    }
  };
  walk(root);

  // 맨 앞이나 연속으로 나오는 줄바꿈은 큰 빈칸이 되므로 하나만 남긴다.
  for (const br of Array.from(root.querySelectorAll("br")) as any[]) {
    const prev = br.previousSibling;
    if (!prev || (prev.nodeType === 1 && String(prev.tagName).toLowerCase() === "br")) br.remove();
  }

  // 내용 없는 빈 문단 정리
  for (const el of Array.from(root.querySelectorAll("p, div, li, figure")) as any[]) {
    if (!el.querySelector("img") && !String(el.textContent || "").trim()) el.remove();
  }
  return root;
}

/** 앞쪽 블록부터 한도까지만 남긴다. (div로 겹겹이 싸인 곳은 풀어서 문단 단위로 센다) */
function limitHtml(root: any): { html: string; truncated: boolean } {
  const pieces: string[] = [];
  const collect = (node: any) => {
    for (const child of Array.from(node.childNodes) as any[]) {
      if (child.nodeType === 3) {
        const text = String(child.textContent || "").trim();
        if (text) pieces.push(`<p>${text}</p>`);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = String(child.tagName).toLowerCase();
      if (tag === "div" && child.children.length > 0) collect(child);
      else pieces.push(child.outerHTML);
    }
  };
  collect(root);
  let html = "";
  let truncated = false;
  for (const piece of pieces) {
    if (html.length + piece.length > MAX_BODY_HTML) {
      truncated = true;
      break;
    }
    html += piece;
  }
  return { html, truncated };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export async function readUrlAsArticle(rawUrl: string): Promise<ReadUrlResult> {
  let url = String(rawUrl || "").trim();
  if (!url) throw new ReadUrlError("URL을 입력해 주세요.", 400);
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ReadUrlError("올바른 URL이 아닙니다.", 400);
  }
  if (/(^|\.)instagram\.com$|(^|\.)instagr\.am$/i.test(host)) {
    throw new ReadUrlError("Instagram 주소는 위의 Instagram URL 칸을 이용해 주세요.", 400);
  }

  const { html, finalUrl } = await fetchPageHtml(transformNaverBlogUrl(url));
  const { document } = parseHTML(html) as any;
  const siteName =
    document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim() || host.replace(/^www\./, "");
  prepareLazyImages(document);

  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  } catch (error) {
    console.warn("readability failed", error instanceof Error ? error.message : error);
  }
  const textLength = String(article?.textContent || "").replace(/\s+/g, " ").trim().length;
  if (!article || !article.content || textLength < MIN_ARTICLE_CHARS) {
    throw new ReadUrlError(
      "이 페이지에서 본문을 찾지 못했습니다. 로그인이나 구독이 필요하거나, 자바스크립트로 그리는 페이지일 수 있습니다.",
      422,
    );
  }

  const root = sanitizeContent(article.content, finalUrl);

  // 앞쪽 사진을 우리 저장소로 복사 (실패하면 원본 주소 유지)
  const images = Array.from(root.querySelectorAll("img")) as any[];
  const targets = images.slice(0, MAX_MIRRORED_IMAGES);
  let mirroredCount = 0;
  await Promise.all(
    targets.map(async (img) => {
      try {
        const mirrored = await withTimeout(mirrorRemoteImage(img.getAttribute("src") || ""), MIRROR_TIMEOUT_MS);
        if (mirrored?.url) {
          img.setAttribute("src", mirrored.url);
          mirroredCount += 1;
        }
      } catch (error) {
        console.warn("read-url image mirror skipped", error instanceof Error ? error.message : error);
      }
    }),
  );

  const limited = limitHtml(root);
  return {
    url: finalUrl,
    title: String(article.title || "").trim(),
    siteName: String(article.siteName || siteName || "").trim(),
    byline: String(article.byline || "").trim(),
    publishedTime: String(article.publishedTime || "").trim(),
    html: limited.html,
    textLength,
    imageCount: images.length,
    mirroredCount,
    truncated: limited.truncated,
  };
}
