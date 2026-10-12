-- 테마별 작성. 일자 일기와 분리해 테마 단위로 본문을 저장합니다.
CREATE TABLE IF NOT EXISTS public.theme_notes (
  id text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.theme_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS theme_notes_anon_all ON public.theme_notes;
CREATE POLICY theme_notes_anon_all
  ON public.theme_notes
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.theme_notes TO anon, authenticated;
