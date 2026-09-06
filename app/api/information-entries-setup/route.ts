import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "fs/promises";
import path from "path";

/**
 * Supabase SQL Editor에 마이그레이션을 직접 실행하는 것이 정석입니다.
 * 서비스 롤이 있으면 RPC/SQL 실행이 가능한 경우에만 보조로 사용하세요.
 * (일반적으로는 대시보드에서 20260906_information_entries.sql 실행)
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({
      ok: false,
      message:
        "SUPABASE_SERVICE_ROLE_KEY가 없습니다. supabase/migrations/20260906_information_entries.sql 을 SQL Editor에서 실행하세요.",
      sqlPath: "supabase/migrations/20260906_information_entries.sql",
    });
  }

  const sqlPath = path.join(process.cwd(), "supabase/migrations/20260906_information_entries.sql");
  const sql = await readFile(sqlPath, "utf8");

  // PostgREST로는 DDL 실행이 불가하므로, 안내 + 테이블 존재 여부만 확인
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from("information_entries").select("id").limit(1);

  if (error && /relation|does not exist|schema cache/i.test(error.message)) {
    return NextResponse.json({
      ok: false,
      needsMigration: true,
      message: "information_entries 테이블이 없습니다. 아래 SQL을 Supabase SQL Editor에서 실행하세요.",
      sql,
    });
  }

  if (error) {
    return NextResponse.json({ ok: false, message: error.message });
  }

  return NextResponse.json({ ok: true, message: "information_entries 테이블이 준비되어 있습니다." });
}
