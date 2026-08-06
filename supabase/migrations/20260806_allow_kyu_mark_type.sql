-- Allow 休 (rest day) as a calendar mark type for PC/iPhone sync.
-- Run once in Supabase Dashboard → SQL Editor → Run.

ALTER TABLE public.calendar_marks
  DROP CONSTRAINT IF EXISTS calendar_marks_mark_type_check;

ALTER TABLE public.calendar_marks
  ADD CONSTRAINT calendar_marks_mark_type_check
  CHECK (mark_type = ANY (ARRAY['C'::text, 'A'::text, '심야'::text, '노조'::text, '休'::text]));
