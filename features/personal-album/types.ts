export type ItemType = "text" | "image" | "pdf" | "url";
export type InputMode = "none" | "all" | "text" | "media" | "url";
export type ItemStatus =
  | "pending"
  | "analyzing"
  | "needs_location"
  | "confirmed"
  | "unclassified";

export type TravelStyle =
  | "여유롭게"
  | "맛집 중심"
  | "쇼핑 중심"
  | "자연 중심"
  | "고령층 동행"
  | "이동거리 짧게"
  | "비용 절약";

export type Chapter = "collect" | "plan" | "info" | "places";
export type FactCheckStatus = "passed" | "needs_review" | "possible_error";
export type FactCheckLevel = "info" | "warning" | "error";

export interface LocationInfo {
  country: string;
  city: string;
  area: string;
  place: string;
  /** 도로명/지번 주소 (여행지 DB·지도용) */
  address?: string;
  confidence?: number;
  reasons?: string[];
}

export interface FactCheckIssue {
  level: FactCheckLevel;
  title: string;
  description: string;
  suggestion?: string;
}

export interface FactCheckResult {
  status: FactCheckStatus;
  score: number;
  summary: string;
  checkedAt: string;
  issues: FactCheckIssue[];
}

export interface CollectedItem {
  id: number;
  type: ItemType;
  name: string;
  content: string;
  preview?: string;
  fileUrl?: string;
  storagePath?: string;
  fileName?: string;
  fileMimeType?: string;
  fileSize?: number;
  itemLocation?: LocationInfo;
  itemMemo?: string;
  sourceUrl?: string; // 오리지널 URL 주소 보관
  summaryTitle?: string;
  summaryText?: string;
  sourceCreatedAt?: string;
  sourceCreatedAtLabel?: string;
  purposeTag?: string;
  topicCategory?: string;
  status: ItemStatus;
  formattedTextHtml?: string;
  createdAt: string;
}

export interface TravelBundle {
  id: number;
  title: string;
  items: CollectedItem[];
  status: ItemStatus;
  aiDetected?: LocationInfo;
  manualLocation?: LocationInfo;
  confirmedLocation?: LocationInfo;
  factCheck?: FactCheckResult;
  purposeTag?: string;
  topicCategory?: string;
  createdAt: string;
}

export interface AiResult {
  detected: LocationInfo;
  confidence: number;
  needsManualLocation: boolean;
  reasons: string[];
  factCheck?: FactCheckResult;
}

/** 여행지 이름 + 주소 (지도 geocoding용) */
export interface TravelPlaceWithAddress {
  id: string;
  name: string;
  address: string;
}

/** 여행지 DB에 첨부된 관련 사진 */
export interface TravelPlacePhoto {
  id: string;
  /** 표시용 URL — Storage http(s) 우선, 업로드 전 임시 data URL 가능 */
  dataUrl: string;
  fileUrl?: string;
  storagePath?: string;
  /** EXIF DateTimeOriginal 등 — 촬영일 표시용 */
  exifDate?: string;
  createdAt: string;
}

/** 여행지 DB 장소 구분 — 관광지·식당·숙소·카페·쇼핑·집 */
export type TravelPlaceCategory =
  | "attraction"
  | "restaurant"
  | "stay"
  | "cafe"
  | "shopping"
  | "home";

/** 앱 전역 여행지 DB 레코드 (1·2·3·4장 공유) */
export interface TravelPlaceRecord {
  id: string;
  name: string;
  address: string;
  country?: string;
  city?: string;
  area?: string;
  /** 전화번호 (이미지 추출·수동 입력) */
  phone?: string;
  /** 장소 구분. 미설정·구데이터는 attraction(여행지)로 취급 */
  category?: TravelPlaceCategory;
  /** 국내→네이버 / 해외→구글. 미설정 시 주소·국가로 추론 */
  mapRegion?: "domestic" | "overseas";
  lat?: number;
  lng?: number;
  photos?: TravelPlacePhoto[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanRequest {
  startDate: string;
  endDate: string;
  /** 이전 버전 호환용: 과거에는 출발지로 사용했지만, 현재는 여행지 복수 입력이 핵심입니다. */
  departure: string;
  arrival?: string;
  /** API·표시용 요약 문자열 (destinationPlaces와 동기화) */
  destinations: string;
  /** 구조화 여행지 목록 — 주소 포함 지도 동선용 */
  destinationPlaces?: TravelPlaceWithAddress[];
  travelers: string;
  budget: string;
  transportPreference: string;
  accommodationPreference: string;
  styles: TravelStyle[];
}

export interface AdditionalTravelInfo {
  generatedAt: string;
  destinations: string[];
  targetDestinations?: string;
  travelPeriod?: string;
  sourceCount: number;
  verifiedWithinMonths?: number;
  placeDetails?: TravelPlaceDetail[];
  weatherSeasonNotes?: string;
  seniorCompanionNotes?: string;
  travelFatigueNotes?: string;
  routeEfficiencyNotes?: string;
  /** 전체 수집 근거 요약 */
  collectionSources?: string[];
  summaryLines: string[];
  cautionLines: string[];
}

export interface TravelPlaceDetail {
  id?: string;
  name: string;
  /** 도로명/지번 주소 (지도용) */
  address?: string;
  openingHours?: string;
  closedDays?: string;
  admissionFee?: string;
  transport?: string;
  travelTime?: string;
  accommodationOptions?: string[];
  estimatedCost?: string;
  dining?: string;
  shopping?: string;
  /** 수집 근거 (AI/출처) */
  sourceBasis?: string;
  /** 사용자 직접 추가 여부 */
  isManual?: boolean;
  /** 사용자 확인 메모 */
  userNotes?: string;
  /** 사용자 업로드 이미지 (data URL 또는 URL) */
  imageUrl?: string;
  imageCaption?: string;
  /** Google Places 등 외부 사진 출처 */
  imageAttribution?: string;
}

export interface PlanScheduleSegment {
  /** 수동 앨범용 안정 ID */
  segmentId?: string;
  label: string;
  place?: string;
  /** place와 별도 보관 — UI 편집용 (place에 "이름 (주소)"로 동기화) */
  address?: string;
  departureTime?: string;
  transport?: string;
  arrivalTime?: string;
  notes?: string;
  cost?: string;
  dining?: string;
  activity?: string;
  imageUrl?: string;
  imageCaption?: string;
  /** Google Places 등 외부 사진 출처 */
  imageAttribution?: string;
}

export type PlanScheduleSegmentField = Exclude<keyof PlanScheduleSegment, "segmentId">;

export interface DayPlanCostBreakdown {
  transport?: string;
  meals?: string;
  accommodation?: string;
  total?: string;
}

export interface PlanRevisionRequest {
  scheduleChanges?: string;
  costChanges?: string;
  accommodationChanges?: string;
}

export interface PlanTimeBlock {
  place: string;
  feature: string;
  intro: string;
  transport: string;
  evaluation: string;
  referenceDate: string;
  customPhotoUrl?: string;
}

export interface DayPlan {
  day: number;
  title: string;
  dateLabel?: string;
  dateIso?: string;
  mainPlaces: string[];
  morning?: PlanTimeBlock;
  afternoon?: PlanTimeBlock;
  transport: string;
  estimatedCost: string;
  staySuggestion: string;
  accommodationRecommendation?: string;
  totalCost?: string;
  note: string;
  mapColor?: string;
  lunchRecommendations?: string[];
  dinnerRecommendations?: string[];
  accommodationRecommendations?: string[];
  evening?: PlanTimeBlock;
  morningSchedule?: PlanScheduleSegment[];
  afternoonSchedule?: PlanScheduleSegment[];
  eveningSchedule?: PlanScheduleSegment[];
  recommendedRoute?: string;
  estimatedTravelTime?: string;
  transportMode?: string;
  costBreakdown?: DayPlanCostBreakdown;
  alternativePlan?: string;
  precautions?: string;
}

export interface SavedTravelDiaryState {
  version: number;
  savedAt: string;
  activeChapter: Chapter;
  bundles: TravelBundle[];
  unclassified: CollectedItem[];
  planRequest: PlanRequest;
  additionalTravelInfo: AdditionalTravelInfo | null;
  dayPlans: DayPlan[];
}

export interface SavedPlan {
  id: string;
  planRequest: PlanRequest;
  additionalTravelInfo: AdditionalTravelInfo | null;
  dayPlans: DayPlan[];
  savedAt: string;
}

