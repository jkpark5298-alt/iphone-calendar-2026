-- 개인 앨범 목록 동기화 테이블 (PC · 아이폰 공유) — 달력 Supabase SQL Editor에서 한 번 실행
-- 다른 TRAVEL DB와 별개 프로젝트이므로 이 프로젝트에서 새로 만들어야 합니다.

CREATE TABLE IF NOT EXISTS travel_albums_state (
  session_id TEXT PRIMARY KEY DEFAULT 'default',
  albums JSONB NOT NULL DEFAULT '[]'::jsonb,
  manual_trips JSONB,
  updated_at_kst TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기존 테이블에 수동 여행 계획(앨범 만들기) 동기화 컬럼 추가
ALTER TABLE travel_albums_state
  ADD COLUMN IF NOT EXISTS manual_trips JSONB;

ALTER TABLE travel_albums_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'travel_albums_state' AND policyname = 'Allow anon read travel_albums_state'
  ) THEN
    CREATE POLICY "Allow anon read travel_albums_state"
      ON travel_albums_state FOR SELECT
      TO anon
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'travel_albums_state' AND policyname = 'Allow anon insert travel_albums_state'
  ) THEN
    CREATE POLICY "Allow anon insert travel_albums_state"
      ON travel_albums_state FOR INSERT
      TO anon
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'travel_albums_state' AND policyname = 'Allow anon update travel_albums_state'
  ) THEN
    CREATE POLICY "Allow anon update travel_albums_state"
      ON travel_albums_state FOR UPDATE
      TO anon
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'travel_albums_state' AND policyname = 'Allow anon delete travel_albums_state'
  ) THEN
    CREATE POLICY "Allow anon delete travel_albums_state"
      ON travel_albums_state FOR DELETE
      TO anon
      USING (true);
  END IF;
END $$;
