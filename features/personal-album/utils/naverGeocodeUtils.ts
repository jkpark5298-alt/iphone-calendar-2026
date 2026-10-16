import {
  extractRegionHints,
  normalizePlaceForGeocode,
  parsePlaceWithAddress,
  resolveExplicitMapAddress,
  sanitizeMapAddress,
  findLandmarkAddress,
} from "./planUtils";
import { KNOWN_MAP_PLACES } from "./planConstants";

function placeHasRegionPrefix(name: string): boolean {
  return /(?:^|\s)[가-힣]{2,}(?:특별자치도|광역시|특별시|시|군|구)(?:\s|$)/.test(name);
}

/** 시·군·구·읍·면 없이 도로명+번지만 있는 주소 (예: 조천북1길 35-6) */
function isBareKoreanRoadAddress(query: string): boolean {
  const trimmed = query.trim();
  if (!/[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?/.test(trimmed)) return false;
  return !/(?:특별자치도|광역시|특별시|(?:시|군|구|읍|면)\s|[가-힣]{2,}(?:시|군|구)\s)/.test(trimmed);
}

function extractKoreanRoadPortion(query: string): string | null {
  const match = query.match(/([가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)/);
  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function detectJejuTownFromAddress(query: string): string {
  const text = query.replace(/\s+/g, " ").trim();
  const compact = text.replace(/\s+/g, "");
  // 읍·면이 이미 있으면 그대로 사용
  const townInQuery = text.match(
    /(조천읍|애월읍|한림읍|구좌읍|한경면|성산읍|표선면|안덕면|대정읍|우도면|추자면)/,
  );
  if (townInQuery) return townInQuery[1];

  const road = extractKoreanRoadPortion(text) || text;
  const roadCompact = road.replace(/\s+/g, "");
  if (/조천|함덕|신촌|선흘|북촌|와흘|신흥/.test(compact) || /조천/.test(roadCompact)) return "조천읍";
  if (/애월|하귀|고내|구엄|수산|신엄/.test(compact)) return "애월읍";
  if (/한림|협재|옹포|금능/.test(compact)) return "한림읍";
  if (/구좌|김녕|월정|세화|하도|종달/.test(compact)) return "구좌읍";
  if (/한경|고산|신창/.test(compact)) return "한경면";
  if (/성산|섭지|오조/.test(compact)) return "성산읍";
  if (/표선|성읍/.test(compact)) return "표선면";
  if (/안덕|감산|덕수|화순/.test(compact)) return "안덕면";
  if (/대정|모슬포|하모/.test(compact)) return "대정읍";
  if (/중문|색달|예래|대포/.test(compact)) return "중문";
  return "";
}

function isSeogwipoTown(town: string): boolean {
  return town === "성산읍" || town === "표선면" || town === "안덕면" || town === "대정읍" || town === "중문";
}

/**
 * 짧은 도로명·지번 주소에 행정구역을 붙여 네이버 지오코딩 성공률을 높입니다.
 * 예: "조천북1길 35-6" / "조천리 2725-5" → 조천읍·제주시까지 보강
 */
export function expandBareKoreanRoadAddress(query: string, regionHint?: string): string[] {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) return [];
  const out: string[] = [];
  const push = (value: string) => {
    const next = value.trim().replace(/\s+/g, " ");
    if (next.length >= 2 && !out.includes(next)) out.push(next);
  };

  push(trimmed);
  const hyphenless = trimmed.replace(/(\d+)-\d+\s*$/, "$1");
  if (hyphenless !== trimmed) push(hyphenless);

  const road = extractKoreanRoadPortion(trimmed);
  if (road && road !== trimmed) push(road);

  // 지번: …리/동/가 + 번지
  const jibun = trimmed.match(/([가-힣]+(?:리|동|가)\s*\d+(?:-\d+)?)/)?.[1]?.trim();
  if (jibun && jibun !== trimmed) push(jibun);

  const hints = extractRegionHints(regionHint);
  for (const hint of hints) {
    if (!hint || trimmed.includes(hint)) continue;
    push(`${hint} ${trimmed}`);
    if (!/(?:시|군|구|도)$/.test(hint)) push(`${hint}시 ${trimmed}`);
    if (road) {
      push(`${hint} ${road}`);
      if (!/(?:시|군|구|도)$/.test(hint)) push(`${hint}시 ${road}`);
    }
    if (jibun) {
      push(`${hint} ${jibun}`);
      if (!/(?:시|군|구|도)$/.test(hint)) push(`${hint}시 ${jibun}`);
    }
  }

  const jejuTown = detectJejuTownFromAddress(trimmed);
  const looksJeju =
    Boolean(jejuTown) ||
    /제주|조천|애월|한림|한경|구좌|우도|추자|함덕|김녕|월정|중문|성산|표선|안덕|대정|협재|곽지/.test(
      trimmed,
    );

  if (looksJeju) {
    const core = road || jibun || trimmed;
    if (jejuTown) {
      if (isSeogwipoTown(jejuTown)) {
        push(`제주특별자치도 서귀포시 ${jejuTown} ${core}`);
        push(`서귀포시 ${jejuTown} ${core}`);
        push(`서귀포시 ${core}`);
      } else {
        push(`제주특별자치도 제주시 ${jejuTown} ${core}`);
        push(`제주 제주시 ${jejuTown} ${core}`);
        push(`제주시 ${jejuTown} ${core}`);
        push(`제주시 ${core}`);
      }
      // 이미 읍이 포함된 주소면 중복 붙이지 않음
      if (!trimmed.includes(jejuTown)) {
        push(`${jejuTown} ${core}`);
      }
    }
    push(`제주특별자치도 제주시 ${core}`);
    push(`제주특별자치도 서귀포시 ${core}`);
    push(`제주시 ${core}`);
    push(`서귀포시 ${core}`);
    push(`제주 ${core}`);
  }

  if (!isBareKoreanRoadAddress(trimmed) && road && !looksJeju) {
    push(road);
  }

  const preferred = out.filter(
    (candidate) => /(?:읍|면)\s/.test(candidate) || /특별자치도/.test(candidate),
  );
  const rest = out.filter((candidate) => !preferred.includes(candidate));
  return [...preferred, ...rest];
}

/** 한글 주소 판별 — JS \\b 는 한글에 동작하지 않음 */
const KOREAN_ADDRESS_TOKEN = /(?:로|길|동|읍|면|리|시|군|구|도)/;

function uniqGeocodeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim().replace(/\s+/g, " ");
    if (trimmed.length < 2 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= 18) break;
  }
  return result;
}

function expandProvinceAbbrev(query: string): string[] {
  const variants = [query];
  const rules: [RegExp, string][] = [
    [/^경기\s/, "경기도 "],
    [/^경기도\s/, "경기 "],
    [/^전북\s/, "전북특별자치도 "],
    [/^전북특별자치도\s/, "전북 "],
    [/^충북\s/, "충청북도 "],
    [/^충남\s/, "충청남도 "],
    [/^경북\s/, "경상북도 "],
    [/^경남\s/, "경상남도 "],
    [/^전남\s/, "전라남도 "],
    [/^제주\s/, "제주특별자치도 "],
    [/^제주특별자치도\s/, "제주 "],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(query)) {
      variants.push(query.replace(pattern, replacement));
    }
  }
  return [...new Set(variants.filter(Boolean))];
}

export function buildGeocodeQuery(place: string): string {
  const { address, name } = parsePlaceWithAddress(place);
  if (address && KOREAN_ADDRESS_TOKEN.test(address)) {
    return sanitizeMapAddress(address);
  }

  let query = normalizePlaceForGeocode(place);

  const bracketMatch = place.match(/\(([^)]+)\)/);
  if (bracketMatch) {
    const contentInBrackets = bracketMatch[1].trim();
    if (/(?:로|길|동|읍|면|리|시|구|군|도)|지번|도로명/i.test(contentInBrackets)) {
      query = contentInBrackets;
    }
  }

  if (query.includes(",")) {
    const parts = query.split(",");
    if (parts[0].trim().length > 3) {
      query = parts[0].trim();
    }
  }

  query = query.replace(/\s+\d+동\s*\d+호.*/i, "");
  if (!/(?:로|길)\s*\d/.test(query)) {
    query = query.replace(/\s+\d{3,}-\d+.*/i, "");
  }

  if (KOREAN_ADDRESS_TOKEN.test(query)) return query;
  if (KOREAN_ADDRESS_TOKEN.test(name)) return name;
  return query;
}

function splitCompoundPlaceName(name: string): string[] {
  return name
    .split(/\s*(?:&|및|\/|·)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

export function buildGeocodeQueryCandidates(place: string, regionHint?: string): string[] {
  const parsed = parsePlaceWithAddress(place);
  const base = buildGeocodeQuery(place);

  // 주소가 있으면 전체 주소 문자열만 (장소명·지역 힌트 fallback 금지)
  if (parsed.address && KOREAN_ADDRESS_TOKEN.test(parsed.address)) {
    const addr = sanitizeMapAddress(parsed.address.trim());
    return uniqGeocodeQueries([
      ...expandProvinceAbbrev(addr),
      ...expandBareKoreanRoadAddress(addr, regionHint),
    ]);
  }

  const cleanName = parsed.name.split(/[-–—~:|·(\[]/)[0].trim();
  const primaryName = cleanName.split(/\s*(?:&|및|\/|·)\s*/)[0].trim();
  const orFirst = cleanName.split(/\s*또는\s*/)[0].trim();
  const shortName = primaryName || orFirst || cleanName;
  const candidates = new Set<string>();

  if (parsed.address) candidates.add(parsed.address);
  if (base) candidates.add(base);
  if (shortName && shortName !== base) candidates.add(shortName);
  if (cleanName && cleanName !== shortName) candidates.add(cleanName);

  for (const part of splitCompoundPlaceName(cleanName)) {
    if (part.length >= 2) candidates.add(part);
  }

  const hints = extractRegionHints(regionHint);
  const skipRegionPrefix = placeHasRegionPrefix(shortName) || placeHasRegionPrefix(cleanName);
  for (const hint of hints) {
    if (!hint) continue;
    for (const name of [shortName, cleanName, base].filter(Boolean)) {
      if (name.includes(hint)) {
        candidates.add(name);
        continue;
      }
      if (skipRegionPrefix) continue;
      candidates.add(`${hint} ${name}`);
      if (!hint.endsWith("시") && !hint.endsWith("군") && !hint.endsWith("구")) {
        candidates.add(`${hint}시 ${name}`);
      }
    }
  }

  if (shortName.length <= 8 && hints.length > 0 && !skipRegionPrefix) {
    candidates.add(`${hints[0]} ${shortName}`);
    if (!hints[0].endsWith("시")) {
      candidates.add(`${hints[0]}시 ${shortName}`);
    }
  }

  return uniqGeocodeQueries(
    Array.from(candidates).flatMap((query) => expandBareKoreanRoadAddress(query, regionHint)),
  );
}

export function getNaverGeocodeCredentials(): { keyId: string; keySecret: string } | null {
  const keyId =
    process.env.NAVER_MAP_API_KEY_ID?.trim() ||
    process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID?.trim() ||
    process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?.trim() ||
    "";
  const keySecret = process.env.NAVER_MAP_CLIENT_SECRET?.trim() || "";
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

const PAJU_HAESOLLO_COORD = { lat: 37.7284697, lng: 126.749502 } as const;

/** 파주 해솔로 20 — API가 화성·안산 동명 도로로 오지정하는 경우 차단 */
function matchPajuHaesolloAddress(text: string): boolean {
  const compact = text.replace(/\s+/g, " ");
  return (
    /파주(?:시)?(?:\s|[가-힣\d]).*해솔로\s*20/i.test(compact) ||
    /해솔로\s*20.*파주(?:시)?/i.test(compact) ||
    /^경기(?:도|)\s*파주시\s*해솔로\s*20$/i.test(compact.trim())
  );
}

function isLikelyHwaseongAnsanCoord(lat: number, lng: number): boolean {
  return lat >= 37.05 && lat <= 37.45 && lng >= 126.75 && lng <= 127.0;
}

const GEOCODE_ENDPOINT = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

/** 쿼리 행정구역 대비 좌표 sanity check — 파주↔안산 오지정 차단 */
const REGION_ANCHORS: Readonly<Record<string, { lat: number; lng: number; radius: number }>> = {
  파주: { lat: 37.759, lng: 126.782, radius: 0.22 },
  파주시: { lat: 37.759, lng: 126.782, radius: 0.22 },
  화성: { lat: 37.199, lng: 126.831, radius: 0.18 },
  화성시: { lat: 37.199, lng: 126.831, radius: 0.18 },
  전주: { lat: 35.824, lng: 127.148, radius: 0.18 },
  전주시: { lat: 35.824, lng: 127.148, radius: 0.18 },
  완산구: { lat: 35.824, lng: 127.148, radius: 0.15 },
  논산: { lat: 36.186, lng: 127.098, radius: 0.15 },
  논산시: { lat: 36.186, lng: 127.098, radius: 0.15 },
  안산: { lat: 37.321, lng: 126.831, radius: 0.15 },
  안산시: { lat: 37.321, lng: 126.831, radius: 0.15 },
  수원: { lat: 37.263, lng: 127.028, radius: 0.2 },
  수원시: { lat: 37.263, lng: 127.028, radius: 0.2 },
  인천: { lat: 37.456, lng: 126.705, radius: 0.35 },
  인천광역시: { lat: 37.456, lng: 126.705, radius: 0.35 },
};

function coordMatchesQueryRegion(query: string, lat: number, lng: number): boolean {
  const tokens = extractQueryLocalityTokens(query);
  const cityTokens = tokens.filter((t) => /(?:시|군|구)$/.test(t));
  const anchors = cityTokens.length > 0 ? cityTokens : tokens;
  if (anchors.length === 0) return true;

  let checked = 0;
  for (const token of anchors) {
    const anchor =
      REGION_ANCHORS[token] ||
      REGION_ANCHORS[token.replace(/(?:특별자치도|특별시|광역시|도|시|군|구)$/g, "")];
    if (!anchor) continue;
    checked += 1;
    const dLat = Math.abs(lat - anchor.lat);
    const dLng = Math.abs(lng - anchor.lng);
    if (dLat <= anchor.radius && dLng <= anchor.radius) return true;
  }

  return checked === 0;
}

type GeocodeAddress = {
  x: string;
  y: string;
  roadAddress?: string;
  jibunAddress?: string;
};

type GeocodeAttempt = {
  endpoint: string;
  query: string;
  status: number;
  error?: string;
};

function extractRegionTokens(text: string): string[] {
  const tokens = text.match(/[가-힣]{2,}(?:특별자치도|특별시|광역시|도|시|군|구)/g) || [];
  return [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
}

function extractQueryLocalityTokens(query: string): string[] {
  return extractRegionTokens(query);
}

/** 쿼리에 시·군·구가 있으면 geocode 결과도 해당 행정구역을 포함해야 함 */
function geocodeResultMatchesQuery(query: string, addr: GeocodeAddress): boolean {
  const joined = `${addr.roadAddress || ""} ${addr.jibunAddress || ""}`.trim();
  if (!joined) return false;

  const localityTokens = extractQueryLocalityTokens(query);
  const cityTokens = localityTokens.filter((t) => /(?:시|군|구)$/.test(t));
  const mustMatch = cityTokens.length > 0 ? cityTokens : localityTokens;

  if (mustMatch.length > 0) {
    const regionOk = mustMatch.some((token) => {
      if (joined.includes(token)) return true;
      const short = token.replace(/(?:특별자치도|특별시|광역시|도|시|군|구)$/g, "");
      return short.length >= 2 && joined.includes(short);
    });
    if (!regionOk) return false;
  }

  const roadMatch = query.match(/([가-힣][가-힣0-9]*(?:로|길))\s*(\d+(?:-\d+)?)/);
  if (roadMatch) {
    const [, road, num] = roadMatch;
    if (!joined.includes(road)) return false;
    const mainNum = num.split("-")[0];
    if (!joined.includes(mainNum)) {
      const cityOk = cityTokens.some((t) => joined.includes(t));
      if (!cityOk) return false;
    }
  }

  return true;
}

function scoreGeocodeAddress(query: string, addr: GeocodeAddress): number {
  const joined = `${addr.roadAddress || ""} ${addr.jibunAddress || ""}`;
  if (!joined.trim()) return 0;
  let score = 0;

  for (const token of extractRegionTokens(query)) {
    if (joined.includes(token)) score += 15;
  }

  const roadMatch = query.match(/([가-힣0-9]+(?:로|길))\s*(\d+(?:-\d+)?)/);
  if (roadMatch) {
    const [, roadName, roadNum] = roadMatch;
    if (joined.includes(roadName) && joined.includes(roadNum)) score += 20;
    else if (joined.includes(roadName)) score += 8;
  }

  const cityMatch = query.match(/([가-힣]{2,}(?:시|군|구))/g);
  if (cityMatch) {
    for (const city of cityMatch) {
      if (joined.includes(city)) score += 10;
    }
  }

  return score;
}

function pickBestGeocodeAddress(query: string, addresses: GeocodeAddress[]): GeocodeAddress | null {
  if (addresses.length === 0) return null;

  const compatible = addresses.filter((addr) => geocodeResultMatchesQuery(query, addr));
  const hasCityToken = extractQueryLocalityTokens(query).some((t) => /(?:시|군|구)$/.test(t));

  if (compatible.length > 0) {
    const scored = compatible
      .map((addr) => ({ addr, score: scoreGeocodeAddress(query, addr) }))
      .sort((a, b) => b.score - a.score);
    return scored[0].addr;
  }

  if (hasCityToken) return null;

  const scored = addresses
    .map((addr) => ({ addr, score: scoreGeocodeAddress(query, addr) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) return scored[0].addr;
  return addresses.length === 1 ? addresses[0] : null;
}

function normalizeKnownPlaceKey(text: string): string {
  return text
    .replace(/^집:\s*/i, "")
    .replace(/\s+/g, "")
    .replace(/^(?:전주|전북|완산구)/g, "")
    .toLowerCase();
}

function normalizeKnownAddressKey(address: string): string {
  return sanitizeMapAddress(address).replace(/\s+/g, " ").trim();
}

function addressKeysForLookup(address: string): string[] {
  const normalized = normalizeKnownAddressKey(address);
  const keys = new Set<string>([normalized]);
  for (const variant of expandProvinceAbbrev(normalized)) {
    keys.add(normalizeKnownAddressKey(variant));
  }
  return Array.from(keys);
}

/** API 오지정·실패 방지 — 주소·장소명으로 검증 좌표 조회 */
export function lookupKnownMapCoord(place: string): { lat: number; lng: number } | null {
  if (matchPajuHaesolloAddress(place)) {
    return { ...PAJU_HAESOLLO_COORD };
  }

  const parsed = parsePlaceWithAddress(place);
  if (parsed.address && matchPajuHaesolloAddress(parsed.address)) {
    return { ...PAJU_HAESOLLO_COORD };
  }
  if (parsed.name && matchPajuHaesolloAddress(parsed.name)) {
    return { ...PAJU_HAESOLLO_COORD };
  }

  const nameCandidates = new Set<string>([
    parsed.name,
    place,
    parsed.name.split(/[-–—~:|·(\[]/)[0].trim(),
  ]);
  nameCandidates.forEach((n) => {
    if (n?.trim()) {
      nameCandidates.add(normalizeKnownPlaceKey(n));
      nameCandidates.add(n.replace(/\s+/g, ""));
    }
  });

  const addressCandidates = new Set<string>();
  if (parsed.address) {
    for (const key of addressKeysForLookup(parsed.address)) {
      addressCandidates.add(key);
    }
  }
  const strict = getStrictAddressQuery(place);
  if (strict) {
    for (const key of addressKeysForLookup(strict)) {
      addressCandidates.add(key);
    }
  }

  const landmarkAddr = findLandmarkAddress(parsed.name || place);
  if (landmarkAddr) {
    for (const key of addressKeysForLookup(landmarkAddr)) {
      addressCandidates.add(key);
    }
  }

  for (const entry of KNOWN_MAP_PLACES) {
    const entryAddressKeys = addressKeysForLookup(entry.address);
    if (entryAddressKeys.some((k) => addressCandidates.has(k))) {
      return { lat: entry.lat, lng: entry.lng };
    }
    if (entry.names.some((n) => nameCandidates.has(n) || nameCandidates.has(normalizeKnownPlaceKey(n)))) {
      return { lat: entry.lat, lng: entry.lng };
    }
  }
  return null;
}

/** @deprecated lookupKnownMapCoord */
export function lookupPresetMapCoord(place: string): { lat: number; lng: number } | null {
  return lookupKnownMapCoord(place);
}

export async function geocodeQueryWithNcp(
  query: string,
  keyId: string,
  keySecret: string,
  diagnostics?: GeocodeAttempt[],
): Promise<{ lat: number; lng: number } | null> {
  const preset = lookupKnownMapCoord(query);
  if (preset) return preset;

  for (const endpoint of [GEOCODE_ENDPOINT]) {
    const url = `${endpoint}?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-NCP-APIGW-API-KEY-ID": keyId,
        "X-NCP-APIGW-API-KEY": keySecret,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errBody = (await response.json()) as { errorMessage?: string; message?: string };
        errorMessage = errBody.errorMessage || errBody.message || response.statusText;
      } catch {
        /* keep statusText */
      }
      diagnostics?.push({ endpoint, query, status: response.status, error: errorMessage });
      continue;
    }

    const data = (await response.json()) as {
      status?: string;
      addresses?: GeocodeAddress[];
      errorMessage?: string;
    };

    const best = pickBestGeocodeAddress(query, data.addresses || []);
    if (!best) {
      diagnostics?.push({
        endpoint,
        query,
        status: response.status,
        error: data.errorMessage || data.status || "no_addresses",
      });
      continue;
    }

    const lat = parseFloat(best.y);
    const lng = parseFloat(best.x);

    if (/파주/.test(query) && isLikelyHwaseongAnsanCoord(lat, lng)) {
      diagnostics?.push({
        endpoint,
        query,
        status: response.status,
        error: "paju_query_hwaseong_result",
      });
      return { ...PAJU_HAESOLLO_COORD };
    }

    if (!coordMatchesQueryRegion(query, lat, lng)) {
      diagnostics?.push({
        endpoint,
        query,
        status: response.status,
        error: "region_mismatch",
      });
      continue;
    }

    return { lat, lng };
  }

  return null;
}

/** 주소 문자열만 추출 — geocoding 오지정 방지 */
export function getStrictAddressQuery(place: string): string | null {
  return resolveExplicitMapAddress(place);
}

/** 주소가 있으면 true — 지도 geocoding 시 주소 우선 */
export function hasMapAddress(place: string): boolean {
  return Boolean(getStrictAddressQuery(place));
}

function buildFullAddressGeocodeCandidates(fullAddress: string, regionHint?: string): string[] {
  const sanitized = sanitizeMapAddress(fullAddress.trim());
  return uniqGeocodeQueries([
    ...expandProvinceAbbrev(sanitized),
    ...expandBareKoreanRoadAddress(sanitized, regionHint),
  ]);
}

/** 지도용 geocoding 후보 — 주소 있으면 전체 주소만, 없으면 장소명+지역 */
export function buildGeocodeQueryCandidatesForMap(
  place: string,
  regionHint?: string,
  addressLookup?: Map<string, string>,
  manualAddress?: string,
): string[] {
  const fullAddress = resolveExplicitMapAddress(place, addressLookup, manualAddress);
  if (fullAddress && KOREAN_ADDRESS_TOKEN.test(fullAddress)) {
    return buildFullAddressGeocodeCandidates(fullAddress, regionHint);
  }
  return buildGeocodeQueryCandidates(place, regionHint);
}

/** Naver Geocode 응답에서 query와 가장 잘 맞는 좌표 선택 (클라이언트·서버 공용) */
export function resolveGeocodeCoordFromAddresses(
  query: string,
  addresses: GeocodeAddress[],
): { lat: number; lng: number } | null {
  const best = pickBestGeocodeAddress(query, addresses);
  if (!best) return null;
  return { lat: parseFloat(best.y), lng: parseFloat(best.x) };
}

/** 주소가 있으면 regionHint(목적지)를 붙이지 않음 — 출발지 오지정 방지 */
export async function geocodePlaceForMap(
  place: string,
  regionHint: string | undefined,
  keyId: string,
  keySecret: string,
  diagnostics?: GeocodeAttempt[],
  addressLookup?: Map<string, string>,
  manualAddress?: string,
): Promise<{ name: string; lat: number; lng: number } | null> {
  const known = lookupKnownMapCoord(place);
  if (known) return { name: place, ...known };

  const fullAddress = resolveExplicitMapAddress(place, addressLookup, manualAddress);
  const hint = fullAddress ? undefined : regionHint;
  const candidates = fullAddress
    ? buildFullAddressGeocodeCandidates(fullAddress, hint)
    : buildGeocodeQueryCandidates(place, hint);

  for (const query of candidates) {
    const presetForQuery = lookupKnownMapCoord(query);
    if (presetForQuery) return { name: place, ...presetForQuery };

    const coord = await geocodeQueryWithNcp(query, keyId, keySecret, diagnostics);
    if (coord) {
      return { name: place, ...coord };
    }
  }

  const fallback = lookupKnownMapCoord(place);
  return fallback ? { name: place, ...fallback } : null;
}

export async function geocodePlaceWithNcp(
  place: string,
  regionHint: string | undefined,
  keyId: string,
  keySecret: string,
  diagnostics?: GeocodeAttempt[],
): Promise<{ name: string; lat: number; lng: number } | null> {
  return geocodePlaceForMap(place, regionHint, keyId, keySecret, diagnostics);
}

const REVERSE_GEOCODE_ENDPOINT = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";

export function isKoreaCoordinates(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39.5 && lng >= 124 && lng <= 132;
}

export async function reverseGeocodeWithNaver(
  lat: number,
  lng: number,
  keyId: string,
  keySecret: string,
): Promise<string | null> {
  const url = `${REVERSE_GEOCODE_ENDPOINT}?${new URLSearchParams({
    coords: `${lng},${lat}`,
    output: "json",
    orders: "roadaddr,addr",
  }).toString()}`;

  const response = await fetch(url, {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": keyId,
      "X-NCP-APIGW-API-KEY": keySecret,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    results?: {
      name?: string;
      region?: {
        area1?: { name?: string };
        area2?: { name?: string };
        area3?: { name?: string };
        area4?: { name?: string };
      };
      land?: { name?: string; number1?: string; number2?: string };
    }[];
  };

  const result = data.results?.[0];
  if (!result) return null;

  const region = result.region;
  const land = result.land;
  const regionParts = [
    region?.area1?.name,
    region?.area2?.name,
    region?.area3?.name,
    region?.area4?.name,
  ].filter(Boolean);

  if (result.name === "roadaddr" && land?.name) {
    const road = [land.name, land.number1, land.number2 ? `-${land.number2}` : ""]
      .filter(Boolean)
      .join("");
    return [...regionParts, road].filter(Boolean).join(" ");
  }

  if (regionParts.length > 0) return regionParts.join(" ");
  return null;
}
