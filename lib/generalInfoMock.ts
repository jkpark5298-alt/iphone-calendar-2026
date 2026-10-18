import type { GeneralInfoDraft } from "../types/generalInfo";
import { INFO_INDEX_CATEGORIES } from "./infoIndex";
import { createEmptyParagraph } from "./generalInfoParagraphs";

export const generalInfoCategories = [...INFO_INDEX_CATEGORIES];

export const initialGeneralInfoDraft: GeneralInfoDraft = {
  title: "",
  text: "",
  sourceUrl: "",
  fileName: "",
  filePreview: "",
  fileType: "none",
  mediaItems: [],
  primaryCategory: "",
  secondaryCategory: "",
  thirdCategory: "",
  keywords: [],
  summary: "",
  factCheckStatus: "확인 전",
  factCheckSummary: "",
  formattedTextHtml: "",
  paragraphs: [createEmptyParagraph()],
  isPinned: false,
};

export const mockAnalyzeGeneralInfo = (draft: GeneralInfoDraft): GeneralInfoDraft => {
  const titleBase = (draft.title || "").trim();
  const isGeneric = !titleBase || [
    "일반 정보 자료",
    "붙여넣은 text 자료",
    "클립보드 text 자료",
    "url 자료",
    "클립보드 이미지 자료"
  ].includes(titleBase.toLowerCase());

  let extractedTitle = draft.title;
  if (isGeneric && draft.text.trim()) {
    const lines = draft.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const firstLine = lines[0].replace(/<[^>]*>/g, "").trim();
      if (firstLine) {
        extractedTitle = firstLine.length > 40 ? firstLine.slice(0, 40) + "..." : firstLine;
      }
    }
  }

  const source = [extractedTitle, draft.text, draft.sourceUrl, draft.fileName]
    .join(" ")
    .toLowerCase();

  const pickPrimaryCategory = () => {
    if (/애플|apple|아이폰|iphone|아이패드|ipad|워치|ios|macbook/.test(source)) return "애플";
    if (/건강|헬스|운동|의료|병원|다이어트|영양|수면/.test(source)) return "건강";
    if (/(^|[^a-z0-9])ai([^a-z0-9]|$)|인공지능|챗\s*gpt|chatgpt|생성형|제미나이|gemini|claude|llm/.test(source)) return "AI";
    if (/과학|연구|우주|바이오|기후|nasa/.test(source)) return "과학";
    if (/금리|물가|환율|증시|경제|소비|부동산|산업|기업|반도체|수출/.test(source)) return "경제";
    if (/기술|로봇|소프트웨어|데이터/.test(source)) return "기술";
    if (/화장품|코스메틱|스킨케어/.test(source)) return "화장품";
    if (/영화|시네마|개봉/.test(source)) return "영화";
    if (/책|도서|서적|독서/.test(source)) return "책";
    if (/마케팅|광고|브랜드/.test(source)) return "마케팅";
    if (/뇌|두뇌|신경/.test(source)) return "뇌";
    if (/문화|예술|전시|공연/.test(source)) return "문화";
    if (/국제|미국|중국|일본|유럽|해외|global|국방|안보|북한|외교|정상회담/.test(source)) return "국제";
    if (/사회|사건|사고|복지|노동|인구|지역|교육|정치|행정/.test(source)) return "사회";
    return "기타";
  };

  const primaryCategory = draft.primaryCategory || pickPrimaryCategory();

  const pickSecondaryCategory = () => {
    if (primaryCategory === "애플") return "애플/기기";
    if (primaryCategory === "건강") return "건강/웰니스";
    if (primaryCategory === "AI") return "인공지능";
    if (primaryCategory === "과학") return "과학/연구";
    if (primaryCategory === "경제") return "경제동향";
    if (primaryCategory === "기술") return "디지털";
    if (primaryCategory === "국제") return "해외동향";
    if (primaryCategory === "책") return "책";
    if (primaryCategory === "문화") return "문화";
    if (primaryCategory === "뇌") return "뇌";
    if (primaryCategory === "마케팅") return "마케팅";
    if (primaryCategory === "화장품") return "화장품";
    if (primaryCategory === "영화") return "영화";
    if (primaryCategory === "사회") return "사회이슈";
    return "일반";
  };

  const keywordCandidates = source
    .replace(/https?:\/\/\S/g, "")
    .replace(/[^가-힣a-zA-Z0-9#\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .filter(
      (word) =>
        ![
          "그리고",
          "하지만",
          "있는",
          "없는",
          "관련",
          "자료",
          "기사",
          "내용",
          "보고서",
          "요약",
          "입력",
        ].includes(word),
    )
    .slice(0, 24);

  const keywords = Array.from(
    new Set(keywordCandidates.map((word) => (word.startsWith("#") ? word : "#" + word))),
  ).slice(0, 8);

  const factCheckNeedsReview =
    /수치|통계|발표|최신|단독|논란|의혹|속보|가격|비율|증가|감소/.test(source);

  return {
    ...draft,
    title: extractedTitle || "일반 정보 자료",
    primaryCategory,
    secondaryCategory: draft.secondaryCategory || pickSecondaryCategory(),
    thirdCategory:
      draft.thirdCategory ||
      keywords
        .slice(0, 2)
        .map((keyword) => keyword.replace("#", ""))
        .join(" / "),
    keywords,
    summary: draft.summary || "",
    factCheckStatus: factCheckNeedsReview ? "확인 필요" : "확인 완료",
    // 짧은 자동 메모는 AI 검증 보고서 칸에 넣지 않음
    factCheckSummary: draft.factCheckSummary || "",
  };
};
