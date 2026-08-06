import type { GeneralInfoDraft } from "../types/generalInfo";

export const generalInfoCategories = [
  "정치",
  "행정",
  "경제",
  "산업",
  "사회",
  "교육",
  "문화",
  "예술",
  "과학",
  "기술",
  "국제",
  "외교",
  "국방",
  "안보",
];

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
    if (/카리나|아이돌|가수|배우|연예|현장포토|셀럽|스타|미모|걸그룹|보이그룹|드라마|영화|예능/.test(source)) {
      return "문화";
    }
    if (/전시|공연|미술|음악|작품|갤러리|아트|무대/.test(source)) return "예술";
    if (/대통령|국회|정당|선거|정치|공약|정부/.test(source)) return "정치";
    if (/행정|지자체|구청|시청|정책|민원|공공/.test(source)) return "행정";
    if (/금리|물가|환율|증시|경제|소비|부동산/.test(source)) return "경제";
    if (/기업|산업|반도체|자동차|조선|배터리|수출/.test(source)) return "산업";
    if (/학교|교육|입시|학생|대학|교사|교육청/.test(source)) return "교육";
    if (/과학|연구|우주|바이오|기후/.test(source)) return "과학";
    if (/기술|ai|인공지능|로봇|소프트웨어|데이터/.test(source)) return "기술";
    if (/외교|정상회담|협정|대사|동맹/.test(source)) return "외교";
    if (/국방|군|방산|무기|훈련/.test(source)) return "국방";
    if (/안보|북한|핵|테러|사이버안보/.test(source)) return "안보";
    if (/국제|미국|중국|일본|유럽|해외|global/.test(source)) return "국제";
    if (/사회|사건|사고|복지|노동|인구|지역/.test(source)) return "사회";
    return "사회";
  };

  const primaryCategory = draft.primaryCategory || pickPrimaryCategory();

  const pickSecondaryCategory = () => {
    if (primaryCategory === "문화" && /카리나|아이돌|가수|배우|연예|현장포토|셀럽|스타/.test(source)) {
      return "연예/콘텐츠";
    }
    if (primaryCategory === "문화") return "문화콘텐츠";
    if (primaryCategory === "예술") return "전시/공연";
    if (primaryCategory === "국제") return "해외동향";
    if (primaryCategory === "외교") return "외교/정상회담";
    if (primaryCategory === "경제") return "경제동향";
    if (primaryCategory === "산업") return "산업동향";
    if (primaryCategory === "기술") return "AI/디지털";
    if (primaryCategory === "교육") return "교육정책/학교";
    if (primaryCategory === "국방") return "안보/방산";
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

  const summaryBase = draft.text || extractedTitle || draft.sourceUrl || draft.fileName;
  const summary =
    summaryBase.length > 90
      ? summaryBase.slice(0, 90) + "..."
      : summaryBase || "입력 자료 요약이 필요합니다.";

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
    summary,
    factCheckStatus: factCheckNeedsReview ? "확인 필요" : "확인 완료",
    factCheckSummary: factCheckNeedsReview
      ? "수치·최신성·출처 확인이 필요한 표현이 포함되어 있습니다. 저장 전 원문 출처 확인을 권장합니다."
      : "입력 자료 기준으로 큰 충돌 표현은 발견되지 않았습니다. 단, 중요한 정보는 원문 출처 확인이 필요합니다.",
  };
};
