-- 정보함(iphone-information) ↔ 캘린더 공통 저장
CREATE TABLE IF NOT EXISTS public.information_entries (
  id text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  source text NOT NULL DEFAULT 'other',
  primary_date date NOT NULL,
  event_dates date[] NOT NULL DEFAULT '{}'::date[],
  checked boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  important boolean NOT NULL DEFAULT false,
  summary text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS information_entries_primary_date_idx
  ON public.information_entries (primary_date);

CREATE INDEX IF NOT EXISTS information_entries_event_dates_gin
  ON public.information_entries USING gin (event_dates);

CREATE INDEX IF NOT EXISTS information_entries_checked_idx
  ON public.information_entries (checked);

ALTER TABLE public.information_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS information_entries_anon_all ON public.information_entries;
CREATE POLICY information_entries_anon_all
  ON public.information_entries
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.information_entries TO anon, authenticated;
