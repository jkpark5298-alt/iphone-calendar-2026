import { NextRequest, NextResponse } from "next/server";
import { assertAppApiAccess, isProductionRuntime } from "../../../lib/apiSecurity";

const SQL = `ALTER TABLE public.calendar_marks
  DROP CONSTRAINT IF EXISTS calendar_marks_mark_type_check;

ALTER TABLE public.calendar_marks
  ADD CONSTRAINT calendar_marks_mark_type_check
  CHECK (mark_type = ANY (ARRAY['C'::text, 'A'::text, '당'::text, '심야'::text, '노조'::text, '休'::text]));`;

/** Returns the one-time SQL needed to allow 당/休 marks in Supabase. */
export async function GET(request: NextRequest) {
  if (isProductionRuntime()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authError = assertAppApiAccess(request);
  if (authError) return authError;

  return NextResponse.json({
    ok: true,
    reason: "calendar_marks_mark_type_check must allow C, A, 당, 심야, 노조, 休",
    instruction: "Supabase Dashboard → SQL Editor에서 아래 SQL을 실행하세요.",
    sql: SQL,
  });
}
