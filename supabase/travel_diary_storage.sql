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
