/** Instagram URL / caption helpers aligned with insta-fact-library 메타 보기. */

const INSTAGRAM_POST_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:(?:[A-Za-z0-9._]+|share)\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)/gi;

/** Same as POST_RE, but also consumes `/?utm_source=…` so leftover is not treated as caption. */
const INSTAGRAM_POST_FULL_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:(?:[A-Za-z0-9._]+|share)\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)\/?(?:\?[^\s]*)?(?:#[^\s]*)?/gi;

const toPostKind = (kind: string) => (kind.toLowerCase() === "reels" ? "reel" : kind.toLowerCase());

export const toInstagramPostUrl = (kind: string, shortcode: string) =>
  `https://www.instagram.com/${toPostKind(kind)}/${shortcode}/`;

export const extractInstagramUrls = (raw: string): string[] => {
  const text = String(raw || "");
  if (!text.trim()) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.matchAll(INSTAGRAM_POST_RE)) {
    const url = toInstagramPostUrl(match[1], match[2]);
    const key = `${toPostKind(match[1])}:${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
};

export const normalizeInstagramUrl = (raw: string): string => {
  const extracted = extractInstagramUrls(raw);
  if (extracted.length > 0) return extracted[0];
  const text = String(raw || "").trim();
  if (!text) return "";
  const short = text.match(/(?:^|[\s/>])(p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
  if (short) return toInstagramPostUrl(short[1], short[2]);
  return "";
};

export const isInstagramHostText = (raw: string) =>
  /(?:instagram\.com|instagr\.am)/i.test(String(raw || ""));

export const isInstagramPostUrl = (raw: string) => Boolean(normalizeInstagramUrl(raw));

export const isInstagramScrapeGarbage = (value: string) =>
  /InstagramUserAgent|is_edge_chromium|is_edge_legacy|"is_chrome"\s*:|KHTML, like Gecko/i.test(
    String(value || ""),
  );

/** Share-link leftovers like `/?utm_source=ig_web_copy_link` must never become 본문. */
export const isInstagramShareJunk = (value: string) => {
  const text = String(value || "").replace(/\u00a0/g, " ").trim();
  if (!text) return true;
  if (/^\/?\?/.test(text)) return true;
  if (/^(?:utm_[a-z]+=|igsh=|stkn=|ig_web_copy_link)/i.test(text)) return true;
  if (/utm_source|ig_web_copy_link|igsh=|stkn=/i.test(text) && !/\s/.test(text) && text.length < 240) {
    return true;
  }
  if (/^https?:\/\/\S+$/i.test(text) && isInstagramHostText(text)) return true;
  return false;
};

/** Homepage or profile URL — not a post. IFL 메타 보기 also rejects this. */
export const isInstagramHomeOrAccountUrl = (raw: string) => {
  const text = String(raw || "").trim();
  if (!text || !isInstagramHostText(text)) return false;
  return !isInstagramPostUrl(text);
};

export const INSTAGRAM_POST_URL_HINT =
  "지금 칸은 Instagram 홈입니다. 원문 열기를 누르면 로그인 화면만 나옵니다. 캡션을 읽으려면 게시물에서 「링크 복사」한 주소가 필요합니다. 예: https://www.instagram.com/p/XXXX/";

/**
 * IFL `f()`: strip OG wrappers like
 * `123 likes, 45 comments - name on Sep 1, 2026: "caption"`
 */
export const cleanInstagramCaption = (raw: string) => {
  let text = String(raw || "").trim();
  text = text.replace(/^\d[\d,.\s]*\s+likes?,\s*\d[\d,.\s]*\s+comments?\s*[-–—]\s*/i, "");
  text = text.replace(
    /^[^\s:"“]+(?:\s+[^\s:"“]+)*\s+(?:-|on)\s+[A-Za-z]+\s+\d{1,2},\s*\d{4}:\s*/i,
    "",
  );
  text = text.replace(/^\d[\d,.\s]*\s+likes?,\s*\d[\d,.\s]*\s+comments?[^\n"]*/i, "");
  text = text.replace(/^\s*[-–—:]\s*/, "");
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1).trim();
  } else if (text.startsWith('"') || text.startsWith("“")) {
    text = text.slice(1).trim();
  }
  return text.trim();
};

export const titleFromInstagramCaption = (caption: string) => {
  const line =
    String(caption || "")
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item.length > 0) || "";
  if (!line || /on instagram/i.test(line) || line.length > 80) return "";
  return line.slice(0, 80);
};

export const splitInstagramShareText = (raw: string) => {
  const text = String(raw || "");
  const urls = extractInstagramUrls(text);
  const url = urls[0] || "";
  INSTAGRAM_POST_FULL_RE.lastIndex = 0;
  const leftover = cleanInstagramCaption(
    text
      .replace(INSTAGRAM_POST_FULL_RE, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\/?\?[^\s]*/g, " ")
      .replace(/#\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const caption =
    leftover && !/^instagram$/i.test(leftover) && !isInstagramShareJunk(leftover)
      ? leftover
      : "";
  return { url, caption, urls };
};
