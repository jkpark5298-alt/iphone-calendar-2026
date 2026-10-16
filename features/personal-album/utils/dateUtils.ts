/**
 * dateUtils.ts
 * 날짜 관련 유틸리티 함수 모음
 */
import type { CollectedItem, FactCheckResult, ItemType } from "../types";

/** 현재 시간을 한국어 형식으로 반환 */
export const nowText = () => new Date().toLocaleString("ko-KR");

/** 타임스탬프(ms)를 한국어 날짜 문자열로 변환 */
export const formatDateFromTimestamp = (timestamp?: number): string => {
  if (!timestamp || Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toLocaleString("ko-KR");
};

/** 아이템 내용에서 작성 날짜를 감지 */
export const findSourceWrittenDate = (item?: CollectedItem): string => {
  if (!item) return "";
  const text = [item.name, item.content, item.summaryTitle, item.summaryText]
    .filter(Boolean)
    .join(" ");

  const koreanDate = text.match(
    /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(작성|등록|게시|업데이트|수정)?/,
  );

  if (koreanDate) {
    const [, year, month, day, label] = koreanDate;
    return `${year}. ${Number(month)}. ${Number(day)}.${label ? ` ${label}` : " 작성일 감지"}`;
  }

  const isoDate = text.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return `${year}. ${Number(month)}. ${Number(day)}. 작성일 감지`;
  }

  return "";
};

/** 자료 유형별 수집일 라벨 생성 */
export const makeSourceDateLabel = (type: ItemType, capturedAt: string): string => {
  if (type === "url") return `원문 작성일: 확인 필요 · 수집일: ${capturedAt}`;
  if (type === "text") return `입력일: ${capturedAt}`;
  if (type === "image") return `촬영/생성일: 확인 필요 · 수집일: ${capturedAt}`;
  if (type === "pdf") return `원문 작성일: 확인 필요 · 수집일: ${capturedAt}`;
  return `자료 수집일: ${capturedAt}`;
};

/** 파일의 메타데이터를 기반으로 날짜 라벨 생성 */
export const makeFileSourceDateLabel = (
  file: File,
  type: ItemType,
  capturedAt: string,
): string => {
  const fileDate = formatDateFromTimestamp(file.lastModified);
  if (fileDate) {
    return type === "image"
      ? `촬영일 또는 파일 수정일 추정: ${fileDate} · 파일 메타데이터 기준`
      : `파일 수정일: ${fileDate} · 파일 메타데이터 기준`;
  }
  return makeSourceDateLabel(type, capturedAt);
};

/** 아이템의 작성/수집일 텍스트 반환 */
export const getItemSourceDateText = (item?: CollectedItem): string => {
  if (!item) return "작성/수집일 확인 불가";
  const writtenDate = findSourceWrittenDate(item);

  if (writtenDate) {
    return `작성일: ${writtenDate} · 수집일: ${item.createdAt}`;
  }

  if (item.type === "url") return `작성일: 확인 필요 · 수집일: ${item.createdAt}`;
  if (item.type === "text") return `입력일: ${item.createdAt}`;
  if (item.type === "image") return `촬영/생성일: 확인 필요 · 수집일: ${item.createdAt}`;
  if (item.type === "pdf") return `작성일: 확인 필요 · 수집일: ${item.createdAt}`;
  return item.sourceCreatedAtLabel || `수집일: ${item.createdAt}`;
};

/** Fact Check 완료 텍스트 반환 */
export const getFactCheckCompletedText = (factCheck?: FactCheckResult): string => {
  if (!factCheck) return "Fact Check 미실시";
  return `Fact Check 완료 · 확인일: ${factCheck.checkedAt}`;
};

/** 날짜 차이(일수) 계산. 최소 1일, 최대 7일 */
export const getDateDiffDays = (startDate: string, endDate: string): number => {
  if (!startDate || !endDate) return 3;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 3;
  const diff = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return Math.min(Math.max(diff, 1), 7);
};

/** 여행 계획 날짜 라벨 (n일차) */
export const getPlanDateLabel = (startDate: string, dayIndex: number): string => {
  if (!startDate) return `날짜 미정 · ${dayIndex + 1}일차`;
  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return `날짜 미정 · ${dayIndex + 1}일차`;
  date.setDate(date.getDate() + dayIndex);
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
};

/** 여행 계획 날짜 ISO 문자열 (YYYY-MM-DD) */
export const getPlanDateIso = (startDate: string, dayIndex: number): string => {
  if (!startDate) return "";
  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + dayIndex);
  return date.toISOString().slice(0, 10);
};

/** 통화 입력값을 천 단위 구분 형식으로 변환 */
export const formatCurrencyInput = (value: string): string => {
  const onlyNumbers = value.replace(/[^0-9]/g, "");
  if (!onlyNumbers) return "";
  return Number(onlyNumbers).toLocaleString("ko-KR");
};

/** 통화 문자열에서 숫자만 추출 */
export const currencyToNumber = (value: string): number => {
  const onlyNumbers = value.replace(/[^0-9]/g, "");
  return onlyNumbers ? Number(onlyNumbers) : 0;
};

/** 숫자를 원화 형식으로 변환 */
export const formatWon = (value: number): string =>
  `${Math.max(0, Math.round(value)).toLocaleString("ko-KR")}원`;
