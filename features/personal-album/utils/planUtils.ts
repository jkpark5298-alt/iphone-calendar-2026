import type { PlanRequest, TravelBundle, DayPlan, AdditionalTravelInfo, TravelPlaceWithAddress, PlanScheduleSegment, TravelPlaceDetail, CollectedItem } from "../types";
import { DEFAULT_HOME_DEPARTURE, getPlanDayColor } from "./planConstants";

function departureHasMapAddress(departure: string): boolean {
  const parsed = parsePlaceWithAddress(departure);
  return Boolean(parsed.address && /(?:로|길|동|읍|면|리|시|군|구|도)/.test(parsed.address));
}

/** 출발지 미입력·라벨만(「출발지」「집」) → 기본 집 주소 */
export function getEffectiveDeparture(departure?: string): string {
  const trimmed = (departure || "").trim();
  if (!trimmed) return DEFAULT_HOME_DEPARTURE;
  if (departureHasMapAddress(trimmed)) return trimmed;
  const label = parsePlaceWithAddress(trimmed).name || trimmed;
  if (/^(?:출발지|집|출발|home)$/i.test(label.replace(/^집:\s*/i, ""))) {
    return DEFAULT_HOME_DEPARTURE;
  }
  return trimmed;
}

export function resolvePlanRequestForApi(planRequest: PlanRequest): PlanRequest {
  return {
    ...planRequest,
    departure: getEffectiveDeparture(planRequest.departure),
  };
}

export function isDomesticPlan(planRequest: PlanRequest): boolean {
  const text = `${planRequest.destinations} ${getEffectiveDeparture(planRequest.departure)}`;
  return /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text);
}

export function filterBundlesByDestinations(
  bundles: TravelBundle[],
  destinations: string,
): TravelBundle[] {
  const keywords = destinations
    .split(/[,，、/\n|>]+/)
    .map((s) => s.trim())
    .filter((k) => k.length >= 2);

  if (keywords.length === 0) return [];

  return bundles.filter((bundle) => {
    const loc = bundle.confirmedLocation || bundle.manualLocation || bundle.aiDetected;
    const haystack = [
      bundle.title,
      loc?.country,
      loc?.city,
      loc?.area,
      loc?.place,
      bundle.purposeTag,
      ...bundle.items.map((item) => `${item.name} ${item.content} ${item.summaryText || ""}`),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return keywords.some((kw) => {
      const key = kw.toLowerCase();
      if (haystack.includes(key)) return true;
      return key
        .split(/\s+/)
        .filter((part) => part.length >= 2)
        .some((part) => haystack.includes(part));
    });
  });
}

/** Gemini 프롬프트용 — base64·과대 텍스트 제거 */
export function sanitizeTextForPlanPrompt(text: string, maxLen = 600): string {
  const t = String(text || "").trim();
  if (!t) return "";
  if (/^data:[^;]+;base64,/i.test(t)) return "[미디어 본문 생략]";
  if (t.length > maxLen) return `${t.slice(0, maxLen)}…`;
  return t;
}

function formatBundleItemForPrompt(item: CollectedItem): string {
  if (item.type === "image" || item.type === "pdf") {
    const loc = item.itemLocation;
    const locBit = loc ? `${loc.city} ${loc.place}`.trim() : "";
    const memo = sanitizeTextForPlanPrompt(
      [item.itemMemo, item.summaryText, item.summaryTitle].filter(Boolean).join(" "),
      400,
    );
    return `[${item.type}] ${item.name}${locBit ? ` @ ${locBit}` : ""}${memo ? `: ${memo}` : ""}`;
  }
  const safeContent = sanitizeTextForPlanPrompt(item.content, 600);
  return `[${item.type}] ${item.name}: ${safeContent}`;
}

export function buildBundleContentsText(
  allBundles: TravelBundle[],
  destinations: string,
): { text: string; usedCount: number } {
  const filtered = filterBundlesByDestinations(allBundles, destinations);

  if (filtered.length === 0) {
    return {
      text: "여행 목적지와 직접 연관된 1번 챕터 확정 자료가 없습니다. **오직 사용자가 입력한 여행 목적지**만을 기준으로 정보를 수집·계획하세요. 다른 지역·국가는 포함하지 마세요.",
      usedCount: 0,
    };
  }

  const text = filtered
    .map((b, idx) => {
      const loc = b.confirmedLocation || b.manualLocation || b.aiDetected;
      const locStr = loc ? `${loc.country} ${loc.city} ${loc.area} ${loc.place}`.trim() : "미정";
      const itemsStr = b.items.map((i) => formatBundleItemForPrompt(i)).join("\n");
      return `[자료 ${idx + 1}] 위치: ${locStr}\n내용 및 메모:\n${itemsStr}`;
    })
    .join("\n\n");

  return { text, usedCount: filtered.length };
}

export function hasStructuredDaySchedule(plan: DayPlan): boolean {
  return (
    (plan.morningSchedule?.length ?? 0) > 0 ||
    (plan.afternoonSchedule?.length ?? 0) > 0 ||
    (plan.eveningSchedule?.length ?? 0) > 0
  );
}

export function validatePlanDestinations(destinations?: string): string | null {
  if (!destinations?.trim()) {
    return "여행 목적지를 반드시 입력해 주세요. (예: 원주 소금산 그랜드밸리, 뮤지엄산)";
  }
  return null;
}

/** 지도/길찾기용 장소명 정규화 */
export function normalizePlaceForGeocode(place: string): string {
  return place.replace(/^집:\s*/i, "").trim();
}

/** 지도용 주소 정리 — 중복 괄호·장소명 중첩 제거 */
export function sanitizeMapAddress(raw: string): string {
  if (!raw?.trim()) return "";
  let s = raw.trim().replace(/\s+/g, " ");

  // geocode용 — 층·호수·상세는 검색 방해되므로 제거
  s = s
    .replace(/,?\s*\d+\s*층(?:\s*.*)?$/i, "")
    .replace(/,?\s*\d+\s*호(?:\s*.*)?$/i, "")
    .replace(/,?\s*(?:지하|B)\d*\s*층(?:\s*.*)?$/i, "")
    .replace(/,\s*$/, "")
    .trim();

  let guard = 0;
  while (guard++ < 8) {
    const open = s.indexOf("(");
    if (open <= 0) break;
    const before = s.slice(0, open).trim();
    const lastClose = s.lastIndexOf(")");
    if (lastClose <= open) break;
    const inside = s.slice(open + 1, lastClose).trim();
    const after = s.slice(lastClose + 1).trim();
    const beforeIsPlaceName =
      before.length <= 60 &&
      !/(?:특별자치도|광역시|특별시)\s/.test(before) &&
      !/(?:로\d+길|로|길)\s*\d/.test(before);
    // 도로명뿐 아니라 지번(동/리 + 번지)도 주소로 인정
    const insideHasAddress =
      /(?:로\d+길|로|길)\s*\d/.test(inside) ||
      /(?:특별자치도|광역시|특별시|시|군|구).*(?:동|리|가|읍|면)\s*\d/.test(inside) ||
      /(?:동|리|가|읍|면)\s*\d+(?:-\d+)?/.test(inside);
    if (beforeIsPlaceName && insideHasAddress && !after) {
      s = inside;
      continue;
    }
    break;
  }

  const regionPrefix =
    "(?:전북(?:특별자치도)?|전남|경북|경남|충북|충남|경기(?:도)?|강원(?:특별자치도|도)?|제주(?:특별자치도|도)?|서울(?:특별시)?|부산(?:광역시)?|대구(?:광역시)?|인천(?:광역시)?|광주(?:광역시)?|대전(?:광역시)?|울산(?:광역시)?|세종(?:특별자치시)?)";

  // 도로명: "매봉산로2길 9" (로+숫자+길) 우선, 그다음 "기린대로 99" / "OO길 12"
  const roadMatch = s.match(
    new RegExp(
      `((?:${regionPrefix})[^()]*?(?:로\\d+길|로|길)\\s*\\d+(?:-\\d+)?)`,
    ),
  );
  if (roadMatch) return roadMatch[1].trim();

  // 지번: "장소명 서울특별시 마포구 상암동 4-1" → 시·도부터 추출
  const regionStart = s.search(
    /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?/,
  );
  if (regionStart >= 0) {
    const fromRegion = s.slice(regionStart).trim();
    if (/(?:동|리|가|읍|면|로\d+길|로|길)\s*\d/.test(fromRegion)) {
      return fromRegion;
    }
  }

  return s;
}

/** "장소명 (주소)" 형식으로 조합 */
export function formatPlaceWithAddress(name: string, address?: string): string {
  const n = name.trim();
  const a = sanitizeMapAddress(address || "");
  if (!n) return "";
  if (!a) return n;
  if (n.includes(a)) return n;
  if (n.includes(`(${a})`)) return n;
  return `${n} (${a})`;
}

/** "장소명 (주소)" 문자열 분리 — geocoder 괄호(교동,…) 포함 주소 지원 */
export function parsePlaceWithAddress(text: string): { name: string; address: string } {
  const trimmed = text.trim().replace(/^집:\s*/i, "");
  if (!trimmed) return { name: "", address: "" };

  const open = trimmed.indexOf("(");
  if (open > 0) {
    const before = trimmed.slice(0, open).trim();
    const lastClose = trimmed.lastIndexOf(")");
    const inside = lastClose > open ? trimmed.slice(open + 1, lastClose).trim() : "";
    const beforeIsPlaceName =
      before.length <= 60 &&
      !/(?:특별자치도|광역시|특별시|시|군|구)\s/.test(before.slice(0, 24)) &&
      !/(?:로|길)\s*\d/.test(before);
    const insideIsAddress =
      inside.length > 0 &&
      (/(?:로|길)\s*\d/.test(inside) ||
        /(?:특별자치도|광역시|특별시|시|군|구)/.test(inside) ||
        /(?:동|리|가|읍|면)\s*\d+(?:-\d+)?/.test(inside));
    if (beforeIsPlaceName && insideIsAddress && lastClose === trimmed.length - 1) {
      return { name: before, address: sanitizeMapAddress(inside) };
    }
  }

  // "장소명 서울특별시 …"처럼 괄호 없이 붙은 경우 — 시·도 앞에서 분리
  const regionStart = trimmed.search(
    /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?/,
  );
  if (regionStart > 0) {
    const before = trimmed.slice(0, regionStart).trim();
    const after = trimmed.slice(regionStart).trim();
    const beforeLooksLikeName =
      before.length >= 2 &&
      before.length <= 60 &&
      !/(?:특별자치도|광역시|특별시)\s/.test(before) &&
      !/(?:로|길)\s*\d/.test(before);
    const afterLooksLikeAddress =
      /(?:로|길|동|읍|면|리|가)\s*\d/.test(after) ||
      /(?:특별시|광역시|특별자치시|시|군|구)/.test(after);
    if (beforeLooksLikeName && afterLooksLikeAddress) {
      return { name: before, address: sanitizeMapAddress(after) };
    }
  }

  const looksLikeAddress =
    /(?:특별자치도|광역시|특별시|도|시|군|구).*(?:로|길|동|읍|면|리)\s*\d/.test(trimmed) ||
    /^(?:[가-힣]{2,}(?:시|군|구)\s+)+[가-힣\d\s\-]+(?:로|길)\s*\d/.test(trimmed);
  if (looksLikeAddress) {
    const addr = sanitizeMapAddress(trimmed);
    return { name: trimmed, address: addr };
  }
  return { name: trimmed, address: "" };
}

/** destinations 문자열 → 구조화 목록 */
export function parseDestinationsToPlaces(destinations: string): TravelPlaceWithAddress[] {
  if (!destinations?.trim()) return [];
  const parts = destinations.split(/,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
  return parts.map((part, idx) => {
    const { name, address } = parsePlaceWithAddress(part);
    return {
      id: `dest-${idx}-${name.replace(/\s+/g, "-") || idx}`,
      name,
      address,
    };
  });
}

/** 구조화 목록 → destinations 문자열 */
export function destinationPlacesToString(places: TravelPlaceWithAddress[]): string {
  return places
    .filter((p) => p.name.trim())
    .map((p) => formatPlaceWithAddress(p.name, p.address))
    .join(", ");
}

export function resolveDestinationPlaces(planRequest: PlanRequest): TravelPlaceWithAddress[] {
  if (planRequest.destinationPlaces?.length) {
    return planRequest.destinationPlaces.filter((p) => p.name.trim());
  }
  return parseDestinationsToPlaces(planRequest.destinations);
}

/** 지도 geocoding용 최종 라벨 */
export function getMapPlaceLabel(name?: string, address?: string): string {
  if (!name?.trim()) return "";
  const parsed = parsePlaceWithAddress(name);
  const finalName = parsed.name || name.trim();
  const finalAddress = address?.trim() || parsed.address;
  return formatPlaceWithAddress(finalName, finalAddress);
}

export function getSegmentMapLabel(seg: PlanScheduleSegment): string {
  return getMapPlaceLabel(seg.place, seg.address);
}

export function newDestinationPlace(partial?: Partial<TravelPlaceWithAddress>): TravelPlaceWithAddress {
  return {
    id: partial?.id || `dest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: partial?.name || "",
    address: partial?.address || "",
  };
}

export function normalizePlanRequestPlaces(planRequest: PlanRequest): PlanRequest {
  const destinationPlaces = planRequest.destinationPlaces?.length
    ? planRequest.destinationPlaces
    : parseDestinationsToPlaces(planRequest.destinations);
  const destinations = destinationPlacesToString(destinationPlaces) || planRequest.destinations;
  return { ...planRequest, destinationPlaces, destinations };
}

const MOVEMENT_KEYWORDS = [
  "이동", "비행기", "열차", "tgv", "항공", "출발", "도착", "유레일",
  "환승", "ktx", "srt", "버스", "택시", "도보", "전철", "지하철",
];

export function isMovementPlaceText(text: string): boolean {
  // 주소가 있으면 실제 장소 — 「출발지 (주소)」 등이 동선에서 빠지지 않게
  if (hasPlaceAddress(text)) return false;
  const t = text.toLowerCase();
  return MOVEMENT_KEYWORDS.some((kw) => t.includes(kw));
}

/** 1일차 출발지(집) segment — 사진·설명 입력 제외 */
export function isDepartureHomeSegment(
  seg: PlanScheduleSegment,
  context?: { day?: number; scheduleKey?: string; index?: number },
): boolean {
  const label = (seg.label || "").trim();
  const place = (seg.place || "").trim();

  if (/^집\s*:/i.test(place)) return true;
  if (/^출발지$/i.test(place)) return true;
  if (/출발지/.test(label)) return true;
  if (label === "출발" && (!place || /^집\s*:/i.test(place) || /출발지/.test(place))) return true;

  if (
    context?.day === 1 &&
    context.scheduleKey === "morningSchedule" &&
    context.index === 0 &&
    /^출발$/i.test(label)
  ) {
    return true;
  }

  return false;
}

const UNCONFIRMED_MAP_PATTERNS = [
  /숙소|숙박|호텔|펜션|게스트하우스|모텔|리조트|민박|캠핑장|오텔/i,
  /기념품|쇼핑\s*(?:거리|센터|몰|타임|지구|추천)?|면세|아울렛|souvenir|gift\s*shop/i,
  /(?:숙소|호텔|펜션)\s*후보|미정\s*숙|추천\s*숙/i,
  /자유\s*쇼핑|쇼핑\s*(?:시간|일정)/i,
];

/** 숙소·기념품 쇼핑 등 미확정 장소 — 동선 지도에서 제외 */
export function isUnconfirmedMapPlace(text: string): boolean {
  const parsed = parsePlaceWithAddress(text);
  const name = (parsed.name || text).trim();
  if (!name) return false;
  return UNCONFIRMED_MAP_PATTERNS.some((p) => p.test(name) || p.test(text));
}

export function isUnconfirmedScheduleSegment(seg: PlanScheduleSegment): boolean {
  const label = (seg.label || "").trim();
  if (/숙박|숙소|쇼핑|기념품|면세|자유\s*시간/i.test(label)) return true;
  const placeLabel = getSegmentMapLabel(seg);
  if (placeLabel && isUnconfirmedMapPlace(placeLabel)) return true;
  if (!seg.place?.trim() && /쇼핑|기념품|숙소|숙박/.test(seg.dining || "")) return true;
  return false;
}

function collectAccommodationPlaceCandidates(dp: DayPlan): string[] {
  const items: string[] = [];
  dp.accommodationRecommendations?.forEach((r) => r?.trim() && items.push(r.trim()));
  if (dp.accommodationRecommendation?.trim()) items.push(dp.accommodationRecommendation.trim());
  if (dp.staySuggestion?.trim()) items.push(dp.staySuggestion.trim());
  return items;
}

export type DayRouteMapSplit = {
  routePlaces: string[];
  excludedFromMap: string[];
};

/** 일자별 지도 동선 — 확정 방문지만 + 미확정 제외 목록 */
export function splitDayRoutePlacesForMap(
  dp: DayPlan,
  effectiveDeparture: string,
  totalDays: number,
  addressSources?: MapAddressSources | Map<string, string>,
): DayRouteMapSplit {
  const lookup =
    addressSources instanceof Map ? addressSources : buildMapAddressLookup(addressSources);
  const routeRaw: string[] = [];
  const excludedRaw: string[] = [];

  const pushPlace = (place: string, unconfirmed: boolean) => {
    if (!place?.trim() || isMovementPlaceText(place)) return;
    let enriched = enrichPlaceLabelWithKnownAddress(place, lookup);
    const explicit = resolveExplicitMapAddress(enriched, lookup);
    if (explicit && !enriched.includes(explicit)) {
      const parsed = parsePlaceWithAddress(enriched);
      enriched = formatPlaceWithAddress(parsed.name || enriched, explicit);
    } else if (explicit && parsePlaceWithAddress(enriched).name === explicit) {
      enriched = explicit;
    }
    if (unconfirmed) {
      if (!excludedRaw.includes(enriched)) excludedRaw.push(enriched);
    } else if (!routeRaw.includes(enriched)) {
      routeRaw.push(enriched);
    }
  };

  const scheduleBlocks: (keyof DayPlan)[] = ["morningSchedule", "afternoonSchedule", "eveningSchedule"];
  for (const key of scheduleBlocks) {
    const segments = dp[key] as DayPlan["morningSchedule"];
    segments?.forEach((seg) => {
      const label = getSegmentMapLabel(seg);
      pushPlace(label, isUnconfirmedScheduleSegment(seg) || isUnconfirmedMapPlace(label));
    });
  }

  const fromMain =
    dp.mainPlaces && dp.mainPlaces.length > 0
      ? dp.mainPlaces
      : [dp.morning?.place, dp.afternoon?.place, dp.evening?.place].filter(
          (x): x is string => Boolean(x),
        );
  fromMain.forEach((p) => pushPlace(p, isUnconfirmedMapPlace(p)));

  collectAccommodationPlaceCandidates(dp).forEach((p) => pushPlace(p, true));

  if (dp.day === 1 && effectiveDeparture) {
    routeRaw.unshift(formatDepartureForMapRoute(effectiveDeparture, lookup));
  }
  if (dp.day === totalDays && effectiveDeparture) {
    routeRaw.push(formatDepartureForMapRoute(effectiveDeparture, lookup));
  }

  const routePlaces = optimizeRoutePlacesForMap(routeRaw);
  const routeKeys = new Set(routePlaces.map(normalizePlaceDedupeKey));
  const excludedFromMap = excludedRaw.filter(
    (p) => !routeKeys.has(normalizePlaceDedupeKey(p)),
  );

  return { routePlaces, excludedFromMap };
}

/** 일자별 지도 동선용 장소 목록 추출 (확정 방문지만) */
export function extractDayRoutePlaces(
  dp: DayPlan,
  effectiveDeparture: string,
  totalDays: number,
  addressSources?: MapAddressSources | Map<string, string>,
): string[] {
  return splitDayRoutePlacesForMap(dp, effectiveDeparture, totalDays, addressSources).routePlaces;
}

export type MapAddressSources = {
  destinationPlaces?: TravelPlaceWithAddress[];
  placeDetails?: TravelPlaceDetail[];
};

/** 유명 관광지 — 장소명만 있을 때 geocoding 보조 (전주 등) */
const LANDMARK_ADDRESSES: Readonly<Record<string, string>> = {
  전주한옥마을: "전북 전주시 완산구 기린대로 99",
  한옥마을: "전북 전주시 완산구 기린대로 99",
  경기전: "전북 전주시 완산구 태조로 44",
  전동성당: "전북 전주시 완산구 전동 296",
  오목대: "전북 전주시 완산구 기린대로 1055",
  이목대: "전북 전주시 완산구 기린대로 1055",
  남부시장: "전북 전주시 완산구 노송동 730-1",
  전주남부시장: "전북 전주시 완산구 노송동 730-1",
  전주공영주차장: "전북 전주시 완산구 전동 138-3",
  전주한옥마을공영주차장: "전북 전주시 완산구 전동 138-3",
};

function normalizeLandmarkKey(name: string): string {
  return name
    .replace(/\s+/g, "")
    .replace(/^(?:전주|전북|완산구)\s*/g, "")
    .replace(/(?:인근|주변|근처|일대|부근|공영주차장|주차장|숙소|숙박)$/g, "")
    .toLowerCase();
}

function stripVaguePlaceSuffix(name: string): string {
  return name
    .replace(/\s*(인근|주변|부근|일대|근처)\s*$/i, "")
    .replace(/\s*(숙소|숙박|공영주차장|주차장)\s*$/i, "")
    .trim();
}

function registerMapAddressKey(lookup: Map<string, string>, name: string, address: string) {
  const n = name.trim();
  const a = address.trim();
  if (!n || !a) return;

  const keys = new Set<string>();
  keys.add(normalizePlaceDedupeKey(n));
  keys.add(normalizeLandmarkKey(n));

  stripVaguePlaceSuffix(n)
    .split(/\s*(?:&|및|\/|·|,)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      keys.add(normalizePlaceDedupeKey(part));
      keys.add(normalizeLandmarkKey(part));
    });

  // "전주 한옥마을" → "한옥마을" 토큰
  n.split(/\s+/).filter((t) => t.length >= 2).forEach((token) => {
    keys.add(normalizePlaceDedupeKey(token));
    keys.add(normalizeLandmarkKey(token));
  });

  keys.forEach((key) => {
    if (key && !lookup.has(key)) lookup.set(key, a);
  });
}

function splitCompoundPlaceName(name: string): string[] {
  return name
    .split(/\s*(?:&|및|\/|·)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

export function findLandmarkAddress(name: string): string | undefined {
  const compact = name.replace(/\s+/g, "");
  const compactKey = normalizeLandmarkKey(compact);
  if (compactKey && LANDMARK_ADDRESSES[compactKey]) {
    return LANDMARK_ADDRESSES[compactKey];
  }

  const variants = [
    normalizeLandmarkKey(name),
    normalizeLandmarkKey(stripVaguePlaceSuffix(name)),
    normalizePlaceDedupeKey(name),
  ];
  for (const key of variants) {
    if (key && LANDMARK_ADDRESSES[key]) {
      return LANDMARK_ADDRESSES[key];
    }
  }
  for (const part of splitCompoundPlaceName(name)) {
    const partKeys = [normalizeLandmarkKey(part), normalizePlaceDedupeKey(part)];
    for (const key of partKeys) {
      if (key && LANDMARK_ADDRESSES[key]) {
        return LANDMARK_ADDRESSES[key];
      }
    }
  }
  for (const part of name.split(/\s*(?:&|및|\/|·|,)\s*/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const partKeys = [normalizeLandmarkKey(trimmed), normalizePlaceDedupeKey(trimmed)];
    for (const key of partKeys) {
      if (key && LANDMARK_ADDRESSES[key]) {
        return LANDMARK_ADDRESSES[key];
      }
    }
  }
  return undefined;
}

/** 여행목적지·추가정보에 있는 주소를 일정 장소명과 매칭 */
export function buildMapAddressLookup(sources?: MapAddressSources): Map<string, string> {
  const lookup = new Map<string, string>();
  sources?.destinationPlaces?.forEach((p) => registerMapAddressKey(lookup, p.name, p.address || ""));
  sources?.placeDetails?.forEach((p) => registerMapAddressKey(lookup, p.name, p.address || ""));
  return lookup;
}

/** 출발지 주소를 lookup에 등록 — 일정 segment·지도 geocoding 공통 */
export function registerDepartureInMapLookup(lookup: Map<string, string>, departure: string): void {
  const parsed = parsePlaceWithAddress(departure);
  let addr =
    parsed.address?.trim() ||
    (/(?:로|길|동|읍|면)\s*\d/.test(parsed.name) ? sanitizeMapAddress(parsed.name) : "");
  if (!addr) {
    const fallback = parsePlaceWithAddress(DEFAULT_HOME_DEPARTURE);
    addr = fallback.address?.trim() || "";
  }
  if (!addr) return;

  registerMapAddressKey(lookup, "출발지", addr);
  registerMapAddressKey(lookup, "집", addr);
  registerMapAddressKey(lookup, "출발", addr);
  registerMapAddressKey(lookup, parsed.name || departure, addr);
  registerMapAddressKey(lookup, departure, addr);
}

/** 일정 segment 주소까지 포함한 lookup */
export function buildExtendedMapAddressLookup(
  sources?: MapAddressSources,
  dayPlans?: DayPlan[],
  effectiveDeparture?: string,
): Map<string, string> {
  const lookup = buildMapAddressLookup(sources);

  if (effectiveDeparture?.trim()) {
    registerDepartureInMapLookup(lookup, effectiveDeparture);
  }

  dayPlans?.forEach((dp) => {
    const scheduleKeys: (keyof DayPlan)[] = ["morningSchedule", "afternoonSchedule", "eveningSchedule"];
    for (const key of scheduleKeys) {
      const segments = dp[key] as DayPlan["morningSchedule"];
      segments?.forEach((seg) => {
        const parsed = parsePlaceWithAddress(seg.place || "");
        const addr = seg.address?.trim() || parsed.address;
        const name = parsed.name || seg.place || "";
        if (name && addr) registerMapAddressKey(lookup, name, addr);
      });
    }
  });

  return lookup;
}

function findKnownAddress(name: string, lookup: Map<string, string>): string | undefined {
  if (!name?.trim()) return undefined;

  const candidates = [
    name.trim(),
    stripVaguePlaceSuffix(name),
    parsePlaceWithAddress(name).name,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const key = normalizePlaceDedupeKey(candidate);
    if (lookup.has(key)) return lookup.get(key);

    const landmarkKey = normalizeLandmarkKey(candidate);
    if (lookup.has(landmarkKey)) return lookup.get(landmarkKey);

    for (const [knownKey, address] of lookup) {
      if (key.includes(knownKey) || knownKey.includes(key)) return address;
      if (landmarkKey.includes(knownKey) || knownKey.includes(landmarkKey)) return address;
    }

    // 토큰 겹침 (2글자 이상)
    const tokens = candidate.split(/\s+/).filter((t) => t.length >= 2);
    for (const [knownKey, address] of lookup) {
      if (tokens.some((t) => knownKey.includes(t.toLowerCase()) || t.toLowerCase().includes(knownKey))) {
        return address;
      }
    }
  }

  return findLandmarkAddress(name);
}

type ScheduleSegmentRef = {
  day: number;
  scheduleKey: "morningSchedule" | "afternoonSchedule" | "eveningSchedule";
  index: number;
};

/** 일정 segment에서 장소명으로 위치 찾기 */
export function findScheduleSegmentForPlace(
  dayPlans: DayPlan[],
  placeName: string,
  dayHint = 0,
): ScheduleSegmentRef | null {
  const targetKey = normalizePlaceDedupeKey(parsePlaceWithAddress(placeName).name || placeName);
  if (!targetKey) return null;

  const plans = dayHint > 0 ? dayPlans.filter((p) => p.day === dayHint) : dayPlans;
  for (const plan of plans) {
    for (const scheduleKey of ["morningSchedule", "afternoonSchedule", "eveningSchedule"] as const) {
      const segments = plan[scheduleKey] || [];
      for (let index = 0; index < segments.length; index++) {
        const seg = segments[index];
        const segName = parsePlaceWithAddress(seg.place || "").name || seg.place || "";
        if (normalizePlaceDedupeKey(segName) === targetKey) {
          return { day: plan.day, scheduleKey, index };
        }
      }
    }
  }
  return null;
}

/** 출발지 — 주소 우선, 표시명은 '출발지 (주소)' */
export function formatDepartureForMapRoute(
  departure: string,
  lookup?: Map<string, string>,
): string {
  const parsed = parsePlaceWithAddress(departure);
  if (parsed.address && /(?:로|길|동|읍|면|리|시|군|구|도)/.test(parsed.address)) {
    const label = /^집\s*:/i.test(departure.trim()) || parsed.name === parsed.address
      ? "출발지"
      : parsed.name;
    return formatPlaceWithAddress(label, parsed.address);
  }
  return enrichPlaceLabelWithKnownAddress(departure, lookup);
}

/** placeDetails 주소 → 일정 segment.address 동기화 */
export function syncScheduleAddressesFromPlaceDetails(
  plans: DayPlan[],
  sources?: MapAddressSources,
): DayPlan[] {
  const lookup = buildMapAddressLookup(sources);
  if (lookup.size === 0) return plans;

  const patchSegments = (segments?: PlanScheduleSegment[]) =>
    segments?.map((seg) => {
      if (seg.address?.trim()) return seg;
      const parsed = parsePlaceWithAddress(seg.place || "");
      const name = parsed.name || seg.place || "";
      const known = findKnownAddress(name, lookup);
      if (!known) return seg;
      return {
        ...seg,
        address: known,
        place: formatPlaceWithAddress(name, known),
      };
    });

  return plans.map((plan) => ({
    ...plan,
    morningSchedule: patchSegments(plan.morningSchedule),
    afternoonSchedule: patchSegments(plan.afternoonSchedule),
    eveningSchedule: patchSegments(plan.eveningSchedule),
  }));
}

/** 장소 문자열에 알려진 주소를 붙임 (이미 주소 있으면 유지) */
export function enrichPlaceLabelWithKnownAddress(
  place: string,
  lookup?: Map<string, string>,
): string {
  if (!place?.trim()) return place;
  const parsed = parsePlaceWithAddress(place);
  if (parsed.address && /(?:로|길|동|읍|면|리|시|군|구|도)/.test(parsed.address)) {
    return formatPlaceWithAddress(parsed.name, parsed.address);
  }
  const known =
    (lookup?.size ? findKnownAddress(parsed.name || place, lookup) : undefined) ||
    findLandmarkAddress(parsed.name || place);
  if (known) return formatPlaceWithAddress(parsed.name || place, known);
  return place;
}

export function hasPlaceAddress(place: string): boolean {
  const parsed = parsePlaceWithAddress(place);
  return Boolean(parsed.address && /(?:로|길|동|읍|면|리|시|군|구|도)/.test(parsed.address));
}

/** 중복 제거용 장소 키 */
export function normalizePlaceDedupeKey(place: string): string {
  let name = parsePlaceWithAddress(place).name;
  name = name.replace(/\s*(내\s*숙소|숙박|숙소)\s*$/i, "").trim();
  name = name.split(/\s*(?:&|및|\/|·|또는)\s*/)[0].trim();
  return name.toLowerCase();
}

/** 지도 동선용 — 중복·무분별 장소명 정리, 주소 있는 항목 우선 */
function normalizeRouteAddressKey(place: string): string {
  const parsed = parsePlaceWithAddress(place);
  const addr = parsed.address?.trim() || sanitizeMapAddress(parsed.name);
  if (addr && /(?:로|길|동|읍|면|리|시|군|구|도)/.test(addr)) {
    return addr.replace(/\s+/g, " ").trim().toLowerCase();
  }
  return normalizePlaceDedupeKey(place);
}

export function optimizeRoutePlacesForMap(places: string[]): string[] {
  const score = (p: string) => (hasPlaceAddress(p) ? 3 : 0) + (/\([^)]+\)/.test(p) ? 1 : 0);
  const bestByKey = new Map<string, string>();
  const bestByAddress = new Map<string, string>();

  for (const place of places) {
    if (!place?.trim() || isMovementPlaceText(place)) continue;
    const key = normalizePlaceDedupeKey(place);
    const existing = bestByKey.get(key);
    if (!existing || score(place) > score(existing)) {
      bestByKey.set(key, place);
    }

    const addrKey = normalizeRouteAddressKey(place);
    const existingAddr = bestByAddress.get(addrKey);
    if (!existingAddr || score(place) > score(existingAddr)) {
      bestByAddress.set(addrKey, place);
    }
  }

  const result: string[] = [];
  const seenKeys = new Set<string>();
  const seenAddresses = new Set<string>();

  for (const place of places) {
    if (!place?.trim() || isMovementPlaceText(place)) continue;
    const key = normalizePlaceDedupeKey(place);
    const addrKey = normalizeRouteAddressKey(place);

    if (seenKeys.has(key)) continue;
    if (seenAddresses.has(addrKey)) continue;

    const best = bestByKey.get(key);
    if (best) {
      seenKeys.add(key);
      seenAddresses.add(addrKey);
      result.push(best);
    }
  }
  return result;
}

/** geocoding용 — 주소가 명확하면 도로명·지번 전체 문자열만 반환 (장소명·축약 제외) */
export function resolveExplicitMapAddress(
  place: string,
  addressLookup?: Map<string, string>,
  manualAddress?: string,
): string | null {
  const hasAddrToken = (text: string) =>
    /(?:로|길|동|읍|면|리|시|군|구|도)/.test(text);

  const manual = manualAddress?.trim();
  if (manual && hasAddrToken(manual)) {
    return sanitizeMapAddress(manual);
  }

  if (!place?.trim()) return null;

  const parsed = parsePlaceWithAddress(place);
  if (parsed.address && hasAddrToken(parsed.address)) {
    return sanitizeMapAddress(parsed.address);
  }

  const name = (parsed.name || place).trim();
  const looksLikeFullAddress =
    /(?:특별자치도|광역시|특별시|도|시|군|구).*(?:로|길|동|읍|면|리)\s*\d/.test(name) ||
    /^(?:[가-힣]{2,}(?:시|군|구)\s+)+[가-힣\d\s\-]+(?:로|길)\s*\d/.test(name);
  if (looksLikeFullAddress) {
    return sanitizeMapAddress(name);
  }

  if (addressLookup?.size) {
    const known = findKnownAddress(name, addressLookup);
    if (known && hasAddrToken(known)) {
      return sanitizeMapAddress(known);
    }
  }

  const landmark = findLandmarkAddress(name);
  if (landmark && hasAddrToken(landmark)) {
    return sanitizeMapAddress(landmark);
  }

  return null;
}

/** PDF·화면 지도 공통 — geocoding 전 장소 문자열 (주소 우선) */
export function resolvePlaceForMapGeocode(
  place: string,
  addressLookup?: Map<string, string>,
  manualAddress?: string,
): string {
  if (!place?.trim()) return place;

  const explicitAddr = resolveExplicitMapAddress(place, addressLookup, manualAddress);
  if (explicitAddr) {
    const parsed = parsePlaceWithAddress(place);
    const name = (parsed.name || place).trim();
    if (name === explicitAddr || sanitizeMapAddress(name) === explicitAddr) {
      return explicitAddr;
    }
    const label =
      /^집\s*:/i.test(place) || /^출발지$/i.test(name)
        ? "출발지"
        : name;
    return formatPlaceWithAddress(label, explicitAddr);
  }

  return enrichPlaceLabelWithKnownAddress(place, addressLookup);
}

/** geocoding 보조용 — destinations 문자열에서 지역 힌트 추출 */
export function extractRegionHints(destinations?: string): string[] {
  if (!destinations?.trim()) return [];
  return destinations
    .split(/[,，·/|、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 목적지 입력값만으로 지도에 표시할 장소 목록 (출발지 포함) */
export function getDestinationPlacesForMap(
  planRequest: Pick<PlanRequest, "destinations" | "destinationPlaces">,
  effectiveDeparture?: string,
): string[] {
  const result: string[] = [];
  if (effectiveDeparture?.trim()) {
    result.push(effectiveDeparture.trim());
  }
  resolveDestinationPlaces(planRequest as PlanRequest).forEach((p) => {
    result.push(formatPlaceWithAddress(p.name, p.address));
  });
  return optimizeRoutePlacesForMap(Array.from(new Set(result.filter(Boolean))));
}

export function normalizeAdditionalTravelInfo(info: AdditionalTravelInfo): AdditionalTravelInfo {
  const placeDetails = (info.placeDetails || []).map((p, idx) => ({
    ...p,
    id: p.id || `place-${idx}-${(p.name || "unknown").replace(/\s+/g, "-")}`,
  }));
  return { ...info, placeDetails };
}

export interface DayMapPlaceItem {
  name: string;
  label: string;
  icon: string;
  day: number;
}

export type MapRouteDaySegment = {
  day: number;
  color: string;
  places: string[];
};

/** 일자별 지도 동선 segment (전체/특정 일차) */
export function buildRouteDaySegments(
  dayPlans: DayPlan[],
  effectiveDeparture: string,
  totalDays: number,
  addressSources?: MapAddressSources | Map<string, string>,
  filterDay = 0,
): MapRouteDaySegment[] {
  const plans =
    filterDay > 0 ? dayPlans.filter((p) => p.day === filterDay) : [...dayPlans].sort((a, b) => a.day - b.day);

  return plans
    .map((dp) => ({
      day: dp.day,
      color: getPlanDayColor(dp.day),
      places: extractDayRoutePlaces(dp, effectiveDeparture, totalDays, addressSources),
    }))
    .filter((seg) => seg.places.length > 0);
}

/** 일자별 지도 좌측 장소 목록 */
export function getDayMapPlaceDetails(
  dp: DayPlan,
  effectiveDeparture: string,
  totalDays: number,
  addressSources?: MapAddressSources | Map<string, string>,
): DayMapPlaceItem[] {
  const lookup =
    addressSources instanceof Map ? addressSources : buildMapAddressLookup(addressSources);
  const label = (place: string) => enrichPlaceLabelWithKnownAddress(place, lookup);
  const fromSchedule: DayMapPlaceItem[] = [];
  const scheduleBlocks: { key: keyof DayPlan; label: string; icon: string }[] = [
    { key: "morningSchedule", label: "오전", icon: "🌅" },
    { key: "afternoonSchedule", label: "오후", icon: "🌇" },
    { key: "eveningSchedule", label: "저녁", icon: "🌙" },
  ];

  for (const block of scheduleBlocks) {
    const segments = dp[block.key] as DayPlan["morningSchedule"];
    segments?.forEach((seg) => {
      const mapLabel = getSegmentMapLabel(seg);
      const enriched = label(mapLabel);
      if (enriched.trim() && !isMovementPlaceText(enriched)) {
        fromSchedule.push({ name: enriched, label: block.label, icon: block.icon, day: dp.day });
      }
    });
  }

  if (fromSchedule.length > 0) {
    const result = [...fromSchedule];
    if (dp.day === 1 && effectiveDeparture) {
      const depLabel =
        addressSources instanceof Map
          ? formatDepartureForMapRoute(effectiveDeparture, addressSources)
          : formatDepartureForMapRoute(effectiveDeparture, buildMapAddressLookup(addressSources));
      result.unshift({ name: depLabel, label: "출발지", icon: "🏁", day: dp.day });
    }
    if (dp.day === totalDays && effectiveDeparture) {
      const depLabel =
        addressSources instanceof Map
          ? formatDepartureForMapRoute(effectiveDeparture, addressSources)
          : formatDepartureForMapRoute(effectiveDeparture, buildMapAddressLookup(addressSources));
      result.push({ name: depLabel, label: "도착지", icon: "🏁", day: dp.day });
    }
    const { routePlaces } = splitDayRoutePlacesForMap(
      dp,
      effectiveDeparture,
      totalDays,
      addressSources,
    );
    const routeKeys = new Set(routePlaces.map(normalizePlaceDedupeKey));
    const filtered =
      routeKeys.size > 0
        ? result.filter((item) => routeKeys.has(normalizePlaceDedupeKey(item.name)))
        : result;
    return filtered.length > 0 ? filtered : result;
  }

  const placesList =
    dp.mainPlaces && dp.mainPlaces.length > 0
      ? dp.mainPlaces
      : [dp.morning?.place, dp.afternoon?.place].filter((x): x is string => Boolean(x));

  const list: DayMapPlaceItem[] = [];
  placesList.forEach((p, idx) => {
    if (p?.trim() && !isMovementPlaceText(p)) {
      list.push({
        name: label(p),
        label: idx < Math.ceil(placesList.length / 2) ? "오전 일정" : "오후 일정",
        icon: idx < Math.ceil(placesList.length / 2) ? "🌅" : "🌇",
        day: dp.day,
      });
    }
  });

  const resolveDepLabel = () =>
    addressSources instanceof Map
      ? formatDepartureForMapRoute(effectiveDeparture, addressSources)
      : formatDepartureForMapRoute(effectiveDeparture, buildMapAddressLookup(addressSources));

  if (dp.day === 1 && effectiveDeparture) {
    list.unshift({ name: resolveDepLabel(), label: "출발지", icon: "🏁", day: dp.day });
  }
  if (dp.day === totalDays && effectiveDeparture) {
    list.push({ name: resolveDepLabel(), label: "도착지", icon: "🏁", day: dp.day });
  }

  const { routePlaces } = splitDayRoutePlacesForMap(
    dp,
    effectiveDeparture,
    totalDays,
    addressSources,
  );
  const routeKeys = new Set(routePlaces.map(normalizePlaceDedupeKey));
  const filtered =
    routeKeys.size > 0
      ? list.filter((item) => routeKeys.has(normalizePlaceDedupeKey(item.name)))
      : list;
  return filtered.length > 0 ? filtered : list;
}
