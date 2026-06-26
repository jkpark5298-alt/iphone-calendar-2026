/**
 * redDateApi.ts
 * 빨간 날짜(red dates)를 Supabase의 `red_dates` 테이블에 저장·불러오는 함수 모음.
 *
 * ── Supabase 테이블 스키마 (최초 한 번 실행) ──────────────────────────────
 * CREATE TABLE IF NOT EXISTS red_dates (
 *   id    BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 *   year  INT    NOT NULL,
 *   month INT    NOT NULL,
 *   days  INT[]  NOT NULL DEFAULT '{}',
 *   UNIQUE (year, month)
 * );
 * ──────────────────────────────────────────────────────────────────────────
 */

// 공유 Supabase 클라이언트 사용 → GoTrueClient 중복 경고 방지
import { supabase, isSupabaseConfigured } from "./supabaseClient";

export const isConfigured = isSupabaseConfigured;

/**
 * 특정 연도의 모든 레드 데이트를 Supabase에서 불러옵니다.
 * 반환 형태: { [month: number]: number[] }
 */
export async function loadRedDatesFromSupabase(
  year: number
): Promise<Record<number, number[]> | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from("red_dates")
    .select("month, days")
    .eq("year", year);

  if (error) {
    console.warn("Supabase 레드 데이트 로드 오류:", error.message);
    return null;
  }

  const result: Record<number, number[]> = {};
  (data ?? []).forEach((row: { month: number; days: number[] }) => {
    result[Number(row.month)] = Array.isArray(row.days) ? row.days : [];
  });

  return result;
}

/**
 * 특정 연도·월의 레드 데이트 배열을 Supabase에 저장합니다.
 * 이미 같은 (year, month) 행이 있으면 days 컬럼만 업데이트합니다.
 */
export async function saveRedDateToSupabase(
  year: number,
  month: number,
  days: number[]
): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;

  const { error } = await supabase
    .from("red_dates")
    .upsert(
      { year, month, days },
      { onConflict: "year,month" }
    );

  if (error) {
    console.warn("Supabase 레드 데이트 저장 오류:", error.message);
    return false;
  }

  return true;
}
