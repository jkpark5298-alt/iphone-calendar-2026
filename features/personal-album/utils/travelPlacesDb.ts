import type {
  TravelPlaceCategory,
  TravelPlacePhoto,
  TravelPlaceRecord,
} from "../types";

const STORAGE_KEY = "iphone-calendar-personal-album-travel-places-v1";

export const TRAVEL_PLACE_CATEGORIES: TravelPlaceCategory[] = [
  "attraction",
  "restaurant",
  "stay",
  "cafe",
  "shopping",
  "home",
];

export const TRAVEL_PLACE_CATEGORY_LABELS: Record<TravelPlaceCategory, string> = {
  attraction: "여행지",
  restaurant: "식당",
  stay: "숙소",
  cafe: "카페",
  shopping: "쇼핑",
  home: "집",
};

export function isTravelPlaceCategory(value: unknown): value is TravelPlaceCategory {
  return (
    typeof value === "string" &&
    (TRAVEL_PLACE_CATEGORIES as string[]).includes(value)
  );
}

export function normalizeTravelPlaceCategory(
  value?: string | null,
): TravelPlaceCategory {
  return isTravelPlaceCategory(value) ? value : "attraction";
}

export function travelPlaceCategoryLabel(
  category?: TravelPlaceCategory | string | null,
): string {
  return TRAVEL_PLACE_CATEGORY_LABELS[normalizeTravelPlaceCategory(category)];
}

/** 이름·주소 정규화 (중복 비교용) */
export function normalizePlaceKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function namesAreSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) {
    return true;
  }
  return false;
}

/**
 * 저장 전 유사·정확 중복 후보.
 * exact: 이름+주소 완전일치 / similar: 이름 유사 또는 주소 일치
 */
export function findSimilarTravelPlaces(
  places: TravelPlaceRecord[],
  candidate: Pick<TravelPlaceRecord, "id" | "name" | "address">,
): Array<{ place: TravelPlaceRecord; match: "exact" | "similar" }> {
  const nameKey = normalizePlaceKeyPart(candidate.name);
  const addressKey = normalizePlaceKeyPart(candidate.address);
  if (!nameKey && !addressKey) return [];

  const hits: Array<{ place: TravelPlaceRecord; match: "exact" | "similar" }> = [];
  for (const p of places) {
    if (p.id === candidate.id) continue;
    const pName = normalizePlaceKeyPart(p.name);
    const pAddress = normalizePlaceKeyPart(p.address);

    const nameExact = Boolean(nameKey && pName && nameKey === pName);
    const addressExact = Boolean(addressKey && pAddress && addressKey === pAddress);
    const nameSimilar = namesAreSimilar(nameKey, pName);

    if (nameExact && addressExact) {
      hits.push({ place: p, match: "exact" });
      continue;
    }
    if (nameExact && !addressKey && !pAddress) {
      hits.push({ place: p, match: "exact" });
      continue;
    }
    if (!nameKey && addressExact) {
      hits.push({ place: p, match: "exact" });
      continue;
    }
    if (nameExact || addressExact || (nameSimilar && (addressExact || !addressKey || !pAddress))) {
      hits.push({ place: p, match: "similar" });
    }
  }

  return hits.sort((a, b) => {
    if (a.match !== b.match) return a.match === "exact" ? -1 : 1;
    return 0;
  });
}

/** @deprecated findSimilarTravelPlaces 사용 — 호환용 exact만 */
export function findDuplicateTravelPlaces(
  places: TravelPlaceRecord[],
  candidate: Pick<TravelPlaceRecord, "id" | "name" | "address">,
): TravelPlaceRecord[] {
  return findSimilarTravelPlaces(places, candidate)
    .filter((h) => h.match === "exact")
    .map((h) => h.place);
}

type TravelPlacesRoot = {
  version: 1;
  places: TravelPlaceRecord[];
  updatedAt: string;
};

function emptyRoot(): TravelPlacesRoot {
  return { version: 1, places: [], updatedAt: new Date().toISOString() };
}

function readRoot(): TravelPlacesRoot {
  if (typeof window === "undefined") return emptyRoot();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyRoot();
    const parsed = JSON.parse(raw) as TravelPlacesRoot;
    if (parsed.version === 1 && Array.isArray(parsed.places)) return parsed;
    return emptyRoot();
  } catch {
    return emptyRoot();
  }
}

function writeRoot(root: TravelPlacesRoot): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...root, updatedAt: new Date().toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function newTravelPlacePhoto(
  partial?: Partial<TravelPlacePhoto>,
): TravelPlacePhoto {
  const fileUrl =
    partial?.fileUrl ||
    (partial?.dataUrl?.startsWith("http") ? partial.dataUrl : undefined);
  return {
    id: partial?.id ?? `tpp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    dataUrl: fileUrl || partial?.dataUrl || "",
    fileUrl,
    storagePath: partial?.storagePath,
    exifDate: partial?.exifDate,
    createdAt: partial?.createdAt ?? new Date().toISOString(),
  };
}

function slimTravelPlacePhoto(photo: TravelPlacePhoto): TravelPlacePhoto {
  const fileUrl =
    photo.fileUrl?.startsWith("http")
      ? photo.fileUrl
      : photo.dataUrl?.startsWith("http")
        ? photo.dataUrl
        : undefined;
  return {
    id: photo.id,
    dataUrl: fileUrl || "",
    fileUrl,
    storagePath: photo.storagePath,
    exifDate: photo.exifDate,
    createdAt: photo.createdAt,
  };
}

export function slimTravelPlaceRecord(place: TravelPlaceRecord): TravelPlaceRecord {
  return {
    ...place,
    photos: (place.photos || []).map(slimTravelPlacePhoto).filter((p) => p.fileUrl || p.dataUrl),
  };
}

export function slimTravelPlacesForStorage(places: TravelPlaceRecord[]): TravelPlaceRecord[] {
  return places.map(slimTravelPlaceRecord);
}

export function newTravelPlaceRecord(
  partial?: Partial<TravelPlaceRecord>,
): TravelPlaceRecord {
  const now = new Date().toISOString();
  return {
    id: partial?.id ?? `tp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: partial?.name ?? "",
    address: partial?.address ?? "",
    country: partial?.country ?? "",
    city: partial?.city ?? "",
    area: partial?.area ?? "",
    phone: partial?.phone ?? "",
    category: normalizeTravelPlaceCategory(partial?.category),
    mapRegion: partial?.mapRegion ?? "domestic",
    lat: partial?.lat,
    lng: partial?.lng,
    photos: partial?.photos ?? [],
    createdAt: partial?.createdAt ?? now,
    updatedAt: now,
  };
}

/** 구분별 이름 입력 placeholder */
export function travelPlaceNamePlaceholder(category?: TravelPlaceCategory): string {
  switch (normalizeTravelPlaceCategory(category)) {
    case "restaurant":
      return "식당명 (예: 전주 한옥마을 콩나물국밥)";
    case "stay":
      return "숙소명 (예: 전주 한옥 게스트하우스)";
    case "cafe":
      return "카페명 (예: 성심당 카페)";
    case "shopping":
      return "쇼핑 장소 (예: 명동 지하상가)";
    case "home":
      return "집 이름 (예: 우리집, 파주 집)";
    default:
      return "여행지명 (예: 전주 한옥마을)";
  }
}

/** 최근 수정·입력 순 상위 N개 (이름·주소 있는 항목만) */
export function getRecentTravelPlaces(
  places: TravelPlaceRecord[],
  limit = 10,
): TravelPlaceRecord[] {
  return [...places]
    .filter((p) => p.name.trim() || p.address.trim())
    .sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || "") || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt || "") || 0;
      return tb - ta;
    })
    .slice(0, limit);
}

type TravelPlaceMapFields = Pick<
  TravelPlaceRecord,
  "name" | "address" | "country" | "city" | "area" | "mapRegion"
>;

/** 국내→네이버 / 해외→구글 지도 검색 URL */
export function travelPlaceExternalMapUrl(place: TravelPlaceMapFields): string {
  const query = travelPlaceMapQuery(place);
  if (!query) return "";
  if (isDomesticPlaceRecord(place)) {
    return `https://map.naver.com/v5/search/${encodeURIComponent(query)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function openTravelPlaceExternalMap(place: TravelPlaceMapFields): boolean {
  const url = travelPlaceExternalMapUrl(place);
  if (!url || typeof window === "undefined") return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export function readTravelPlacesDb(): TravelPlaceRecord[] {
  return readRoot().places;
}

export function writeTravelPlacesDb(places: TravelPlaceRecord[]): boolean {
  return writeRoot({
    version: 1,
    places: slimTravelPlacesForStorage(places),
    updatedAt: new Date().toISOString(),
  });
}

export function upsertTravelPlace(record: TravelPlaceRecord): TravelPlaceRecord[] {
  const root = readRoot();
  const idx = root.places.findIndex((p) => p.id === record.id);
  const next = { ...record, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    root.places[idx] = {
      ...root.places[idx],
      ...next,
      photos: next.photos ?? root.places[idx].photos ?? [],
      createdAt: root.places[idx].createdAt,
    };
  } else {
    root.places.push({ ...next, photos: next.photos ?? [] });
  }
  writeRoot(root);
  return root.places;
}

export function removeTravelPlaceFromDb(id: string): TravelPlaceRecord[] {
  const root = readRoot();
  root.places = root.places.filter((p) => p.id !== id);
  writeRoot(root);
  return root.places;
}

export function travelPlaceLabel(place: Pick<TravelPlaceRecord, "name" | "address">): string {
  const name = place.name?.trim() ?? "";
  const address = place.address?.trim() ?? "";
  if (name && address) {
    return address.includes(name) ? address : `${name} (${address})`;
  }
  return name || address;
}

/** 국내(한국) 여부 — mapRegion 우선, 없으면 주소·국가로 추론 */
export function isDomesticPlaceRecord(place: TravelPlaceMapFields): boolean {
  if (place.mapRegion === "overseas") return false;
  if (place.mapRegion === "domestic") return true;

  const address = (place.address ?? "").trim();
  const country = (place.country ?? "").trim();

  // 국가가 있으면 한글 여부와 무관하게 한국(Korea)만 국내
  if (country) {
    return isKoreaCountryName(country);
  }

  if (address) {
    if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(address)) return true;
    if (/(특별|광역|자치).*(시|도)|[가-힣]+(시|군|구|읍|면|동|로|길)/.test(address)) {
      return true;
    }
    return false;
  }

  const city = (place.city ?? "").trim();
  if (city && /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(city)) return true;

  const name = (place.name ?? "").trim();
  return Boolean(name && /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(name));
}

/** 국가명으로 한국 여부 — 한글/영문 모두, 일본·중국 등 한글 국가명은 해외 */
export function isKoreaCountryName(country: string): boolean {
  const c = country.trim();
  if (!c) return false;
  if (/한국|대한민국|korea|south\s*korea|republic\s+of\s+korea/i.test(c)) {
    return true;
  }
  return false;
}

/** 목록 그룹용 국가 라벨 */
export function travelPlaceCountryGroup(place: TravelPlaceMapFields): string {
  const country = (place.country ?? "").trim();
  if (country) {
    if (isKoreaCountryName(country)) return "대한민국";
    return country;
  }
  if (isDomesticPlaceRecord(place)) return "대한민국";
  return "미분류";
}

export type TravelPlaceCountryGroup = {
  country: string;
  places: TravelPlaceRecord[];
};

/** 국가별 그룹 — 대한민국 우선, 미분류 마지막, 나머지는 가나다/알파벳 */
export function groupTravelPlacesByCountry(
  places: TravelPlaceRecord[],
): TravelPlaceCountryGroup[] {
  const map = new Map<string, TravelPlaceRecord[]>();
  for (const place of places) {
    const key = travelPlaceCountryGroup(place);
    const list = map.get(key);
    if (list) list.push(place);
    else map.set(key, [place]);
  }

  const rank = (country: string) => {
    if (country === "대한민국") return 0;
    if (country === "미분류") return 2;
    return 1;
  };

  return Array.from(map.entries())
    .sort(([a], [b]) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b, "ko");
    })
    .map(([country, groupPlaces]) => ({ country, places: groupPlaces }));
}

/** 지도 embed / geocode용 검색어 — "이름 (주소)" 형식으로 주소 추출이 되게 함 */
export function travelPlaceMapQuery(place: TravelPlaceMapFields): string {
  const name = place.name?.trim() ?? "";
  const address = place.address?.trim() ?? "";
  if (address) {
    if (!name || address.includes(name)) return address;
    // 괄호 형식이어야 parsePlaceWithAddress / geocode가 주소를 분리함
    return `${name} (${address})`;
  }
  return name;
}

export function formatTravelPlaceInputDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function searchTravelPlacesDb(
  query: string,
  places?: TravelPlaceRecord[],
): TravelPlaceRecord[] {
  const q = query.trim().toLowerCase();
  const list = places ?? readTravelPlacesDb();
  if (!q) return list;
  return list.filter((place) => {
    const label = travelPlaceLabel(place).toLowerCase();
    const categoryLabel = travelPlaceCategoryLabel(place.category).toLowerCase();
    return (
      place.name.toLowerCase().includes(q) ||
      place.address.toLowerCase().includes(q) ||
      place.country?.toLowerCase().includes(q) ||
      place.city?.toLowerCase().includes(q) ||
      place.area?.toLowerCase().includes(q) ||
      place.phone?.toLowerCase().includes(q) ||
      categoryLabel.includes(q) ||
      label.includes(q)
    );
  });
}

export function filterTravelPlacesByCategory(
  places: TravelPlaceRecord[],
  category: TravelPlaceCategory | "all",
): TravelPlaceRecord[] {
  if (category === "all") return places;
  return places.filter(
    (p) => normalizeTravelPlaceCategory(p.category) === category,
  );
}

export function clearTravelPlacesDb(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function mergeTravelPlacesIntoDb(
  incoming: Array<
    Pick<
      TravelPlaceRecord,
      "name" | "address" | "country" | "city" | "area" | "category" | "phone"
    >
  >,
): TravelPlaceRecord[] {
  const root = readRoot();
  for (const item of incoming) {
    if (!item.name?.trim() && !item.address?.trim()) continue;
    const existing = root.places.find(
      (p) =>
        p.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
        p.address.trim().toLowerCase() === (item.address ?? "").trim().toLowerCase(),
    );
    if (existing) continue;
    root.places.push(
      newTravelPlaceRecord({
        name: item.name.trim(),
        address: item.address?.trim() ?? "",
        country: item.country?.trim() ?? "",
        city: item.city?.trim() ?? "",
        area: item.area?.trim() ?? "",
        phone: item.phone?.trim() ?? "",
        category: normalizeTravelPlaceCategory(item.category),
      }),
    );
  }
  writeRoot(root);
  return root.places;
}

/** TSV/CSV 한 줄 파싱 — 이름\\t주소\\t구분\\t전화\\t국가\\t도시 */
export function parseTravelPlacesBulkText(raw: string): Array<{
  name: string;
  address: string;
  category?: TravelPlaceRecord["category"];
  phone?: string;
  country?: string;
  city?: string;
}> {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: Array<{
    name: string;
    address: string;
    category?: TravelPlaceRecord["category"];
    phone?: string;
    country?: string;
    city?: string;
  }> = [];

  for (const line of lines) {
    if (/^(이름|name|상호)/i.test(line)) continue;
    const parts = line.includes("\t")
      ? line.split("\t")
      : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((p) => p.replace(/^"|"$/g, "").trim());
    const name = (parts[0] || "").trim();
    const address = (parts[1] || "").trim();
    if (!name && !address) continue;
    const categoryRaw = (parts[2] || "").trim();
    rows.push({
      name,
      address,
      category: categoryRaw
        ? normalizeTravelPlaceCategory(
            /식당|restaurant/i.test(categoryRaw)
              ? "restaurant"
              : /숙소|stay|hotel/i.test(categoryRaw)
                ? "stay"
                : /카페|cafe/i.test(categoryRaw)
                  ? "cafe"
                  : /쇼핑|shopping/i.test(categoryRaw)
                    ? "shopping"
                    : /집|home|house/i.test(categoryRaw)
                      ? "home"
                      : /여행|관광|attraction/i.test(categoryRaw)
                        ? "attraction"
                        : categoryRaw,
          )
        : undefined,
      phone: (parts[3] || "").trim() || undefined,
      country: (parts[4] || "").trim() || undefined,
      city: (parts[5] || "").trim() || undefined,
    });
  }
  return rows;
}
