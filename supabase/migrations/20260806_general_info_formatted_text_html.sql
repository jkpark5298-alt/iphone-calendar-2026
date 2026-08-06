-- 본문 TEXT(HTML + 인라인 이미지) 및 긴 AI 보고서 저장용
ALTER TABLE general_info_items
  ADD COLUMN IF NOT EXISTS formatted_text_html text;

-- fact_check_summary 가 짧은 경우 길이 제한이 있다면 완화 (text 타입이면 불필요)
-- ALTER TABLE general_info_items ALTER COLUMN fact_check_summary TYPE text;
