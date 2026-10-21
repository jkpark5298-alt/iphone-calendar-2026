-- 새 Supabase 프로젝트로 옮기면서 빠진 유니크 제약을 다시 만듭니다.
-- 이 제약이 없으면 앱의 upsert(onConflict) 저장이 42P10 오류로 실패합니다.
-- (일기장, 정보보관소, 빨간 날짜, 달력 표시)
-- 2026-10-21 기준 네 테이블 모두 중복 데이터 없음 확인.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diary_entries_entry_date_key') THEN
    ALTER TABLE public.diary_entries ADD CONSTRAINT diary_entries_entry_date_key UNIQUE (entry_date);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'info_entries_entry_date_key') THEN
    ALTER TABLE public.info_entries ADD CONSTRAINT info_entries_entry_date_key UNIQUE (entry_date);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'red_dates_year_month_key') THEN
    ALTER TABLE public.red_dates ADD CONSTRAINT red_dates_year_month_key UNIQUE (year, month);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_marks_month_day_mark_type_plus_key') THEN
    ALTER TABLE public.calendar_marks ADD CONSTRAINT calendar_marks_month_day_mark_type_plus_key UNIQUE (month, day, mark_type, plus);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
