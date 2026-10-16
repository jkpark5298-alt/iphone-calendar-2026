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


-- 개인 앨범(personal album) 스토리지 — 달력 Supabase(aseejsybbpcmbvveillj) SQL Editor에서 실행
-- 버킷 이름은 travel-diary 앨범 엔진과 동일하게 유지: travel-diary-files(공개) / travel-diary-private(비공개)
-- 함께 실행: supabase/travel_albums_state.sql

-- 1) 공개 읽기 버킷 생성
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'travel-diary-files',
  'travel-diary-files',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) anon 업로드/읽기/수정/삭제 허용 (단일 사용자 앱)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Allow anon read travel-diary-files'
  ) THEN
    CREATE POLICY "Allow anon read travel-diary-files"
      ON storage.objects FOR SELECT
      TO anon
      USING (bucket_id = 'travel-diary-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Allow anon insert travel-diary-files'
  ) THEN
    CREATE POLICY "Allow anon insert travel-diary-files"
      ON storage.objects FOR INSERT
      TO anon
      WITH CHECK (bucket_id = 'travel-diary-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Allow anon update travel-diary-files'
  ) THEN
    CREATE POLICY "Allow anon update travel-diary-files"
      ON storage.objects FOR UPDATE
      TO anon
      USING (bucket_id = 'travel-diary-files')
      WITH CHECK (bucket_id = 'travel-diary-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Allow anon delete travel-diary-files'
  ) THEN
    CREATE POLICY "Allow anon delete travel-diary-files"
      ON storage.objects FOR DELETE
      TO anon
      USING (bucket_id = 'travel-diary-files');
  END IF;
END $$;

-- 3) 비공개 버킷 (Google Drive OAuth 토큰 google-drive-auth.json 저장용)
--    서버(service role)에서만 접근하므로 anon 정책은 만들지 않는다.
--    (googleDrive.ts 가 없으면 자동 생성하지만, 미리 만들어 두는 것을 권장)
INSERT INTO storage.buckets (id, name, public)
VALUES ('travel-diary-private', 'travel-diary-private', false)
ON CONFLICT (id) DO NOTHING;
