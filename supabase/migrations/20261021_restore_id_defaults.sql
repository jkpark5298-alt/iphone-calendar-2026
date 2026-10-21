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

-- 숫자형 id(red_dates): 기존 최대값 다음부터 이어지는 번호
CREATE SEQUENCE IF NOT EXISTS public.red_dates_id_seq OWNED BY public.red_dates.id;
SELECT setval('public.red_dates_id_seq', COALESCE((SELECT MAX(id) FROM public.red_dates), 0) + 1, false);
ALTER TABLE public.red_dates ALTER COLUMN id SET DEFAULT nextval('public.red_dates_id_seq');

NOTIFY pgrst, 'reload schema';
