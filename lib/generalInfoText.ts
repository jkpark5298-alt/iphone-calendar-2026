/** 본문 첫 문장 (인포그래픽 제목 등) */
export function extractFirstSentence(text: string, maxLen = 80): string {
  const plain = String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  const match = plain.match(/^(.+?[.。!?！？\n])/u);
  const sentence = (match ? match[1] : plain).trim();
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen).trim()}…`;
}

/** 1·2차 분류 → 키워드 목록 */
export function categoryKeywordsList(primary: string, secondary: string): string[] {
  return [primary, secondary]
    .map((s) => String(s || "").trim().replace(/^#+/, ""))
    .filter(Boolean);
}

/** 예: #정치#외교 */
export function formatCategoryKeywords(primary: string, secondary: string): string {
  return categoryKeywordsList(primary, secondary)
    .map((kw) => `#${kw}`)
    .join("");
}
