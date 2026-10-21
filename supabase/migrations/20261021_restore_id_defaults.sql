-- 새 Supabase 프로젝트로 옮기면서 id 칸의 자동 생성(기본값)이 빠졌다.
-- 그래서 새 행을 만드는 저장(새 날짜 일기, 사진 기록, 달력 표시, 일정 등)이 모두
-- "null value in column id violates not-null constraint" 오류로 실패한다.
-- 앱이 id를 직접 만드는 표(general_info_items, theme_notes, information_entries)는 건드리지 않는다.

-- 글자형 id: 새 행마다 무작위 고유값(UUID)을 넣는다
ALTER TABLE public.diary_entries      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.info_entries       ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.diary_photos       ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.info_photos        ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.info_text_cards    ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.calendar_marks     ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.calendar_schedules ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- red_dates.id 는 이미 identity(자동 번호) 칸이라 손댈 필요가 없다.

NOTIFY pgrst, 'reload schema';
