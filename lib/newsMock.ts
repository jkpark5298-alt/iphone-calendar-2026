import type { NewsItem } from "../types/news";

/** 알림에 표시할 오늘의 뉴스 5건 (API 연동 전 안정용 더미) */
export function getMockNewsItems(now = new Date()): NewsItem[] {
  const day = now.toISOString().slice(0, 10);
  return [
    {
      id: `news-${day}-1`,
      title: "정부, 하반기 민생 안정 대책 추가 발표",
      summary: "물가·주거·소상공인 지원을 중심으로 한 보완 대책이 공개됐습니다. 세부 집행 일정과 예산 규모가 함께 제시됐습니다.",
      source: "경제일보",
      url: "https://example.com/news/economy-policy",
      publishedAt: `${day}T08:20:00+09:00`,
      category: "경제",
    },
    {
      id: `news-${day}-2`,
      title: "수도권 집중호우 대비 비상근무 체계 가동",
      summary: "기상청이 강한 비를 예고하면서 지자체와 관계 기관이 현장 대응 태세를 강화했습니다. 출퇴근 교통 혼잡도 예상됩니다.",
      source: "사회뉴스",
      url: "https://example.com/news/weather-alert",
      publishedAt: `${day}T07:45:00+09:00`,
      category: "사회",
    },
    {
      id: `news-${day}-3`,
      title: "국내 반도체 수출, 전년 대비 두 자릿수 증가",
      summary: "AI 수요 확대에 힘입어 메모리·시스템 반도체 수출이 동반 상승했습니다. 업계는 하반기 실적 개선 흐름이 이어질 것으로 전망합니다.",
      source: "산업투데이",
      url: "https://example.com/news/semiconductor",
      publishedAt: `${day}T09:10:00+09:00`,
      category: "산업",
    },
    {
      id: `news-${day}-4`,
      title: "전국 초중고, 디지털 교과서 시범 확대 방안 공개",
      summary: "교육부가 학교 현장 의견을 반영한 단계적 확대안을 내놨습니다. 교사 연수와 디바이스 지원 계획이 포함됐습니다.",
      source: "교육신문",
      url: "https://example.com/news/edu-digital",
      publishedAt: `${day}T10:05:00+09:00`,
      category: "교육",
    },
    {
      id: `news-${day}-5`,
      title: "한·미 외교장관, 역내 협력·안보 현안 논의",
      summary: "양국은 한반도 정세와 공급망·첨단기술 협력을 중심으로 의견을 교환했습니다. 후속 실무협의 일정도 조율 중입니다.",
      source: "국제통신",
      url: "https://example.com/news/diplomacy",
      publishedAt: `${day}T11:30:00+09:00`,
      category: "외교",
    },
  ];
}
