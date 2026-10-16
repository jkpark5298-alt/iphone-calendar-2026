/**
 * locationUtils.ts
 * 위치 정보 관련 유틸리티 함수 모음
 */
import type {
  CollectedItem,
  FactCheckResult,
  ItemStatus,
  LocationInfo,
  TravelBundle,
  PlanRequest,
  TravelStyle,
} from "../types";

/** 빈 위치 기본값 */
export const emptyLocation: LocationInfo = {
  country: "",
  city: "",
  area: "",
  place: "",
};

/** 일반적인 장소 라벨(전체일정, 계획 등)인지 판별 */
export const isGenericPlaceLabel = (value?: string): boolean => {
  const normalized = String(value || "").trim().replace(/\s+/g, "");
  if (!normalized) return false;

  return [
    "전체일정",
    "일정",
    "여행일정",
    "전체여행",
    "여행계획",
    "계획",
    "가이드",
    "여행가이드",
    "무료여행가이드",
    "여행자료",
    "자료",
    "전체자료",
    "전체코스",
    "코스",
    "일정표",
    "여행표",
    "추천일정",
    "전체",
  ].includes(normalized);
};

/** 표시용 위치 정규화 (일반적 장소 라벨 제거) */
export const normalizeLocationForDisplay = (
  location?: LocationInfo | null,
): LocationInfo | null => {
  if (!location) return location || null;

  if (!isGenericPlaceLabel(location.place)) {
    return location;
  }

  return {
    ...location,
    place: "",
  };
};

/** 위치 정보를 표시 텍스트로 변환 */
export const formatDisplayLocationText = (location?: LocationInfo | null): string => {
  const normalizedLocation = normalizeLocationForDisplay(location);

  if (!normalizedLocation) return "위치 미정";

  const parts = [
    normalizedLocation.country,
    normalizedLocation.area,
    normalizedLocation.city,
    normalizedLocation.place,
  ]
    .flatMap((part) =>
      String(part || "")
        .split(">")
        .map((value) => value.trim())
        .filter(Boolean),
    )
    .filter((part) => !isGenericPlaceLabel(part));

  const uniqueParts = Array.from(new Set(parts));

  return uniqueParts.join(" > ") || "위치 미정";
};

/** 번들의 표시 상태 결정 */
export const getBundleDisplayStatus = (bundle: TravelBundle): ItemStatus => {
  const location =
    bundle.confirmedLocation ||
    bundle.manualLocation ||
    bundle.aiDetected ||
    emptyLocation;

  const hasCountry = Boolean(location.country);
  const hasSpecificLocation = Boolean(
    location.city || location.area || location.place,
  );

  if (hasCountry && hasSpecificLocation) return "confirmed";
  if (bundle.status === "confirmed" && (!hasCountry || !hasSpecificLocation)) return "pending";

  return bundle.status;
};

/** 번들의 표시 제목 생성 */
export const formatDisplayBundleTitle = (bundle: TravelBundle): string => {
  const rawTitle = String(bundle.title || "").trim();
  const location =
    bundle.confirmedLocation ||
    bundle.manualLocation ||
    bundle.aiDetected ||
    emptyLocation;

  const locationTitle = formatDisplayLocationText(location);

  if (!rawTitle) return locationTitle || "여행자료";

  const parts = rawTitle
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !isGenericPlaceLabel(part));

  const cleanedTitle = parts.join(" > ");

  if (!cleanedTitle || cleanedTitle === "위치 미정") {
    return locationTitle || "여행자료";
  }

  return cleanedTitle;
};

/** 번들 검색용 텍스트 생성 */
export const makeBundleSearchText = (
  bundle: TravelBundle,
  getFactCheckMeta: (factCheck?: FactCheckResult) => { label: string },
): string => {
  const location =
    bundle.confirmedLocation || bundle.aiDetected || bundle.manualLocation;
  const locationValue = formatDisplayLocationText(location);
  const itemValue = bundle.items
    .map((item) => `${item.type} ${item.name} ${item.content}`)
    .join(" ");
  const factValue = bundle.factCheck
    ? `${getFactCheckMeta(bundle.factCheck).label} ${bundle.factCheck.summary} ${bundle.factCheck.issues
        .map((issue) => `${issue.title} ${issue.description} ${issue.suggestion || ""}`)
        .join(" ")}`
    : "Fact Check 미실시 미검증";

  const purposeValue = [
    bundle.purposeTag,
    bundle.topicCategory,
    ...bundle.items.map((item) => `${item.purposeTag || ""} ${item.topicCategory || ""}`),
  ].join(" ");

  return `${formatDisplayBundleTitle(bundle)} ${getBundleDisplayStatus(bundle)} ${locationValue} ${itemValue} ${factValue} ${purposeValue} ${bundle.createdAt}`.toLowerCase();
};

/** 번들 목록을 검색어로 필터링 */
export const filterBundlesBySearch = (
  source: TravelBundle[],
  keyword: string,
  getFactCheckMeta: (factCheck?: FactCheckResult) => { label: string },
): TravelBundle[] => {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return source;
  return source.filter((bundle) =>
    makeBundleSearchText(bundle, getFactCheckMeta).includes(normalized),
  );
};

/** Fact Check 메타 정보(색상, 아이콘, 라벨) 반환 */
export const getFactCheckMeta = (
  factCheck?: FactCheckResult,
): { label: string; color: string; icon: string } => {
  if (!factCheck)
    return { label: "Fact Check 미실시", color: "#94a3b8", icon: "🟡" };
  if (factCheck.status === "passed")
    return { label: "Fact Check 완료", color: "#34d399", icon: "✅" };
  if (factCheck.status === "needs_review")
    return { label: "Fact Check 완료 · 확인 필요", color: "#fbbf24", icon: "⚠️" };
  return { label: "Fact Check 완료 · 오류 가능성", color: "#fb7185", icon: "🚨" };
};

/** 목적 태그 정규화 (# 접두사) */
export const normalizePurposeTag = (value: string): string => {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
};

/** 주제 카테고리 추론 */
export const inferTopicCategory = (value: string): string => {
  const source = value.toLowerCase();

  if (source.includes("박물관") || source.includes("museum")) return "박물관";
  if (source.includes("미술관") || source.includes("gallery")) return "미술관";
  if (source.includes("성지") || source.includes("순례")) return "성지순례";
  if (source.includes("온천")) return "온천";
  if (source.includes("맛집") || source.includes("식당") || source.includes("음식")) return "맛집";
  if (source.includes("카페") || source.includes("커피")) return "카페";
  if (source.includes("숙박") || source.includes("호텔")) return "숙박";
  if (source.includes("교통") || source.includes("항공") || source.includes("기차")) return "교통";
  if (source.includes("쇼핑")) return "쇼핑";

  return value.trim() ? "주제자료" : "일반여행";
};

/** 번들의 목적 태그 반환 */
export const getBundlePurposeTag = (bundle: TravelBundle): string =>
  bundle.purposeTag || bundle.items.find((item) => item.purposeTag)?.purposeTag || "";

/** 번들의 주제 카테고리 반환 */
export const getBundleTopicCategory = (bundle: TravelBundle): string =>
  bundle.topicCategory ||
  bundle.items.find((item) => item.topicCategory)?.topicCategory ||
  inferTopicCategory(getBundlePurposeTag(bundle));

/** 번들 아이템 유형별 카운트 배지 */
export const getBundleItemCountBadges = (bundle: TravelBundle): string[] => {
  const imageCount = bundle.items.filter((item) => item.type === "image").length;
  const pdfCount = bundle.items.filter((item) => item.type === "pdf").length;
  const urlCount = bundle.items.filter((item) => item.type === "url").length;
  const textCount = bundle.items.filter((item) => item.type === "text").length;

  return [
    imageCount > 0 ? `사진 ${imageCount}장` : "",
    pdfCount > 0 ? `PDF ${pdfCount}건` : "",
    urlCount > 0 ? `URL ${urlCount}건` : "",
    textCount > 0 ? `Text ${textCount}건` : "",
  ].filter(Boolean);
};

/** 참조 위치에서 LocationInfo 생성 */
export const makeLocationFromResult = (
  result: { detected?: LocationInfo; needsManualLocation?: boolean },
  manualLocation?: LocationInfo,
): LocationInfo => {
  if (result.detected && !result.needsManualLocation) return result.detected;
  if (manualLocation) return manualLocation;
  return emptyLocation;
};

/** 텍스트 정규화 (비교용) */
export const normalizeMatchText = (value?: string): string =>
  String(value || "")
    .replace(/>/g, " ")
    .replace(/[\s·,./()[\]-]+/g, " ")
    .trim()
    .toLowerCase();

/** 두 텍스트가 서로 포함 관계인지 확인 */
export const textContainsMatch = (source?: string, keyword?: string): boolean => {
  const sourceText = normalizeMatchText(source);
  const keywordText = normalizeMatchText(keyword);

  if (!sourceText || !keywordText) return false;

  return sourceText.includes(keywordText) || keywordText.includes(sourceText);
};

/** 특정 장소 키워드에 대한 이미지 매칭 점수 계산 */
export const getImageMatchScoreForPlace = (
  item: CollectedItem,
  placeKeyword: string,
): number => {
  const keyword = normalizeMatchText(placeKeyword);
  if (!keyword) return 0;

  const location = item.itemLocation;
  let score = 0;

  if (location?.place && textContainsMatch(location.place, keyword)) score += 100;
  if (location?.area && textContainsMatch(location.area, keyword)) score += 45;
  if (location?.city && textContainsMatch(location.city, keyword)) score += 35;
  if (location?.country && textContainsMatch(location.country, keyword)) score += 20;

  const extraText = [
    item.name,
    item.content,
    item.summaryTitle,
    item.summaryText,
    item.itemMemo,
  ]
    .filter(Boolean)
    .join(" ");

  if (textContainsMatch(extraText, keyword)) score += 15;

  return score;
};

/** 장소와 관련된 이미지 아이템 목록 반환 (점수 순 정렬) */
export const getMatchedImagesForPlace = (
  images: CollectedItem[],
  placeKeyword: string,
): CollectedItem[] =>
  images
    .map((item) => ({
      item,
      score: getImageMatchScoreForPlace(item, placeKeyword),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((result) => result.item)
    .slice(0, 6);

/** 수동 위치 입력 유효성 검사 */
export const validateManualLocation = (
  location?: LocationInfo,
): { valid: boolean; message: string } => {
  const target = location || emptyLocation;
  const country = target.country.trim();
  const city = target.city.trim();
  const area = target.area.trim();
  const place = target.place.trim();

  const warnings: string[] = [];

  if (!country && !city && !area && !place) {
    return {
      valid: false,
      message: "국가·도시·장소 중 하나 이상을 입력해 주세요.",
    };
  }

  if (country && country.length < 2) {
    warnings.push("국가는 2글자 이상으로 입력해 주세요. 예: 한국, 프랑스");
  }

  if (city && city.length < 2) {
    warnings.push("도시는 2글자 이상으로 입력해 주세요. 예: 강릉, 파리, 런던");
  }

  if (area && area.length < 2) {
    warnings.push("지역은 2글자 이상으로 입력하거나 모르면 비워두세요. 예: 경포, 안목, 초당");
  }

  if (place && place.length < 2) {
    warnings.push("장소는 실제 장소명으로 입력해 주세요. 예: 경포대, 안목해변, 루브르 박물관");
  }

  const suspiciousSingleLetters = [city, area, place].filter(
    (value) => value && value.length === 1,
  );

  if (suspiciousSingleLetters.length > 0) {
    warnings.push(
      "한 글자 위치값은 저장할 수 없습니다. 도시·지역·장소명을 다시 확인해 주세요.",
    );
  }

  if (!city && !place) {
    warnings.push("도시 또는 장소 중 하나는 입력하는 것을 권장합니다.");
  }

  if (warnings.length > 0) {
    return {
      valid: false,
      message: warnings.join("\n"),
    };
  }

  return {
    valid: true,
    message: "",
  };
};

export const formatLocationInputGuide =
  "입력 예시: 국가=한국 / 도시=강릉 / 지역=경포 / 장소=경포대";

/** 위치 정보를 간단한 텍스트로 포맷 */
export const formatLocationText = (location?: LocationInfo): string => {
  if (!location) return "위치 미정";
  return (
    [location.country, location.area, location.city, location.place]
      .filter(Boolean)
      .join(" > ") || "위치 미정"
  );
};

/** 번들의 개선 제안 목록 생성 */
export const getRevisionSuggestions = (
  bundle: TravelBundle,
): Array<{ title: string; current: string; suggestion: string; reason: string }> => {
  const location =
    bundle.confirmedLocation || bundle.manualLocation || bundle.aiDetected || emptyLocation;
  const sourceText = bundle.items
    .map((item) => `${item.name} ${item.content}`)
    .join(" ")
    .toLowerCase();
  const suggestions: Array<{ title: string; current: string; suggestion: string; reason: string }> = [];

  if (!location.country && !location.city && !location.place) {
    suggestions.push({
      title: "위치정보 보완 필요",
      current: "위치 미정",
      suggestion: "자료 안의 국가·도시·장소 단서를 확인해 위치를 입력하거나 재검증하세요.",
      reason: "위치가 확정되지 않으면 여행계획에 정확히 반영하기 어렵습니다.",
    });
  }

  if (
    sourceText.includes("gangneung") ||
    sourceText.includes("강릉") ||
    sourceText.includes("g317126")
  ) {
    suggestions.push({
      title: "강릉 위치 후보 감지",
      current: formatDisplayLocationText(location),
      suggestion: "한국 > 강원 > 강릉 > 강릉 관광명소 또는 구체 관광지로 반영 가능",
      reason: "입력 자료 또는 URL에서 Gangneung/강릉 단서가 확인됩니다.",
    });
  }

  if (sourceText.includes("경포대")) {
    suggestions.push({
      title: "장소명 후보 감지",
      current: location.place || "장소 미정",
      suggestion: "장소를 경포대로 수정하는 것을 검토하세요.",
      reason: "자료 원문에 경포대가 직접 나타납니다.",
    });
  }

  if (sourceText.includes("강릉") && (sourceText.includes("부산") || sourceText.includes("busan"))) {
    suggestions.push({
      title: "지역 혼합 가능성",
      current: "강릉/부산 단서가 함께 있음",
      suggestion: "강릉 자료인지 부산 자료인지 확인 후 하나의 여행지로 정리하세요.",
      reason: "서로 다른 도시가 한 자료에 섞이면 여행계획 동선이 잘못 생성될 수 있습니다.",
    });
  }

  if (bundle.items.some((item) => item.type === "url")) {
    suggestions.push({
      title: "URL 최신성 확인 필요",
      current: "블로그/관광 페이지 URL 자료",
      suggestion: "영업시간·입장료·휴무일은 공식 홈페이지나 지도 정보로 다시 확인하세요.",
      reason: "URL 자료는 작성일과 실제 방문일 사이에 정보가 바뀔 수 있습니다.",
    });
  }

  if (bundle.factCheck?.status === "possible_error") {
    suggestions.push({
      title: "오류 가능성 자료",
      current: getFactCheckMeta(bundle.factCheck).label,
      suggestion: "여행계획 생성 전 위치와 핵심 정보를 수정하거나 재검증하세요.",
      reason: "현재 Fact Check 결과가 오류 가능성으로 표시되어 있습니다.",
    });
  }

  return suggestions;
};

export const initialPlanRequest: PlanRequest = {
  startDate: "",
  endDate: "",
  departure: "",
  arrival: "",
  destinations: "",
  travelers: "성인 2명",
  budget: "",
  transportPreference: "자가용 또는 택시 병행",
  accommodationPreference: "",
  styles: ["여유롭게", "이동거리 짧게"] as TravelStyle[],
};

export const hasItemLocationValue = (location?: LocationInfo | null): boolean => {
  if (!location) return false;
  return Boolean(
    (location.country || "").trim() ||
      (location.city || "").trim() ||
      (location.area || "").trim() ||
      (location.place || "").trim(),
  );
};

export const getItemLocationGroupKey = (item: CollectedItem): string => {
  const location = item.itemLocation;
  if (!hasItemLocationValue(location)) {
    return "__no_location__";
  }
  return [
    location?.country || "",
    location?.city || "",
    location?.area || "",
    location?.place || "",
  ]
    .map((value) => value.trim())
    .join("|");
};

export const buildLocationFromItemLocations = (
  items: CollectedItem[],
  fallback: LocationInfo = emptyLocation,
): LocationInfo => {
  const locations = items
    .map((item) => item.itemLocation)
    .filter((location): location is LocationInfo => hasItemLocationValue(location));

  if (locations.length === 0) return fallback;

  const uniqueValues = (field: keyof LocationInfo) =>
    Array.from(
      new Set(
        locations
          .map((location) => String(location[field] || "").trim())
          .filter(Boolean),
      ),
    );

  const countries = uniqueValues("country");
  const cities = uniqueValues("city");
  const areas = uniqueValues("area");
  const places = uniqueValues("place").filter((place) => !isGenericPlaceLabel(place));

  return {
    country:
      countries.length === 1
        ? countries[0]
        : countries.length > 1
          ? "여러 국가"
          : fallback.country,
    city:
      cities.length === 1
        ? cities[0]
        : cities.length > 1
          ? "여러 도시"
          : fallback.city,
    area:
      areas.length === 1
        ? areas[0]
        : areas.length > 1
          ? "여러 지역"
          : fallback.area,
    place:
      places.length === 1
        ? places[0]
        : places.length > 1
          ? "사진별 장소 참조"
          : isGenericPlaceLabel(fallback.place)
            ? ""
            : fallback.place,
    confidence: 90,
  };
};

// Cache invalidate trigger comment to force Turbopack compilation

