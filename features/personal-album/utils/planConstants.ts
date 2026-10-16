/** 출발지 미입력 시 기본 집 주소 */
export const DEFAULT_HOME_DEPARTURE = "집:경기도 파주시 해솔로 20";

/** @deprecated lookupKnownMapCoord — 파주 집 주소 검증 좌표 */
export const PAJU_HOME_MAP_COORD = { lat: 37.7284697, lng: 126.749502 } as const;

/** geocoding API 오지정·실패 시 사용 — 검증된 WGS84 좌표 */
export const KNOWN_MAP_PLACES = [
  {
    names: ["출발지", "집", "집:"],
    address: "경기도 파주시 해솔로 20",
    lat: 37.7284697,
    lng: 126.749502,
  },
  {
    names: ["경기전"],
    address: "전북 전주시 완산구 태조로 44",
    lat: 35.814753,
    lng: 127.149018,
  },
  {
    names: ["전동성당"],
    address: "전북 전주시 완산구 전동 296",
    lat: 35.815682,
    lng: 127.153445,
  },
  {
    names: ["전주한옥마을", "한옥마을", "전주 한옥마을"],
    address: "전북 전주시 완산구 기린대로 99",
    lat: 35.81542,
    lng: 127.153294,
  },
  {
    names: ["전주한옥마을공영주차장", "전주공영주차장", "한옥마을 공영주차장"],
    address: "전북 전주시 완산구 전동 138-3",
    lat: 35.81635,
    lng: 127.15185,
  },
  {
    names: ["오목대", "이목대"],
    address: "전북 전주시 완산구 기린대로 1055",
    lat: 35.8134,
    lng: 127.1592,
  },
  {
    names: ["남부시장", "전주남부시장"],
    address: "전북 전주시 완산구 노송동 730-1",
    lat: 35.8129,
    lng: 127.1455,
  },
] as const;

/** @deprecated lookupKnownMapCoord 사용 */
export const PRESET_MAP_ADDRESS_COORDS: Readonly<Record<string, { lat: number; lng: number }>> = {
  "경기도 파주시 해솔로 20": { lat: 37.7284697, lng: 126.749502 },
  "경기 파주시 해솔로 20": { lat: 37.7284697, lng: 126.749502 },
  "전북 전주시 완산구 태조로 44": { lat: 35.814753, lng: 127.149018 },
  "전북특별자치도 전주시 완산구 태조로 44": { lat: 35.814753, lng: 127.149018 },
  "전북 전주시 완산구 전동 296": { lat: 35.815682, lng: 127.153445 },
  "전북 전주시 완산구 기린대로 99": { lat: 35.81542, lng: 127.153294 },
  "전북특별자치도 전주시 완산구 기린대로 99": { lat: 35.81542, lng: 127.153294 },
};

/** 추가 정보 수집 시 최신성 기준 (개월) */
export const PLAN_INFO_FRESHNESS_MONTHS = 6;

/** 일차별 지도·일정 색상 (1~8일) */
export const PLAN_DAY_COLORS = [
  "#ef4444", // 1일 — 빨강
  "#f97316", // 2일 — 주황
  "#eab308", // 3일 — 노랑
  "#22c55e", // 4일 — 초록
  "#3b82f6", // 5일 — 파랑
  "#1e3a8a", // 6일 — 남색
  "#a855f7", // 7일 — 보라
  "#94a3b8", // 8일 — 회색
] as const;

export function getPlanDayColor(day: number): string {
  if (day <= 0) return "#64748b";
  return PLAN_DAY_COLORS[(day - 1) % PLAN_DAY_COLORS.length];
}

/** 지도 장소 선택 키 (동일 장소명·다른 일차 구분) */
export function toMapPlaceKey(day: number, name: string): string {
  return `${day}::${name}`;
}

export function parseMapPlaceKey(key: string): { day: number; name: string } {
  const sep = key.indexOf("::");
  if (sep === -1) return { day: 0, name: key };
  const day = Number.parseInt(key.slice(0, sep), 10);
  return { day: Number.isFinite(day) ? day : 0, name: key.slice(sep + 2) };
}

/** 통합·일차별 지도 영역 높이(px) */
export const INTEGRATED_MAP_HEIGHT = 560;
export const DAY_MAP_HEIGHT = 400;
