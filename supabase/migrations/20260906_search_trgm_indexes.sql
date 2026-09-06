-- 통합 검색 성능: trigram 유사 검색 인덱스
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 일기장
CREATE INDEX IF NOT EXISTS diary_entries_diary_text_trgm
  ON public.diary_entries USING gin (diary_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS diary_entries_voice_text_trgm
  ON public.diary_entries USING gin (voice_text gin_trgm_ops);

-- 정보보관소 카드 / 포토 메모
CREATE INDEX IF NOT EXISTS info_text_cards_content_trgm
  ON public.info_text_cards USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS info_photos_caption_trgm
  ON public.info_photos USING gin (caption gin_trgm_ops);

-- 정보함 (iphone-information 공통)
CREATE INDEX IF NOT EXISTS information_entries_title_trgm
  ON public.information_entries USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS information_entries_summary_trgm
  ON public.information_entries USING gin (summary gin_trgm_ops);

-- 일반정보
CREATE INDEX IF NOT EXISTS general_info_items_title_trgm
  ON public.general_info_items USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS general_info_items_summary_trgm
  ON public.general_info_items USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS general_info_items_text_trgm
  ON public.general_info_items USING gin (text gin_trgm_ops);
