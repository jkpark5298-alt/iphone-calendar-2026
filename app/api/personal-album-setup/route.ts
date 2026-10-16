import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "fs/promises";
import path from "path";

/**
 * 개인앨범용 버킷 생성 + travel_albums_state 테이블 존재 확인.
 * 테이블 DDL은 PostgREST로 불가 → 없으면 SQL Editor용 SQL을 반환합니다.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({
      ok: false,
      message: "SUPABASE_SERVICE_ROLE_KEY가 없습니다.",
    });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const buckets: Record<string, string> = {};

  for (const [id, opts] of [
    [
      "travel-diary-files",
      {
        public: true,
        fileSizeLimit: 10485760,
        allowedMimeTypes: [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/webp",
          "image/gif",
          "image/heic",
          "image/heif",
          "application/pdf",
        ],
      },
    ],
    ["travel-diary-private", { public: false }],
  ] as const) {
    const existing = await admin.storage.getBucket(id);
    if (existing.data) {
      buckets[id] = "exists";
      continue;
    }
    const created = await admin.storage.createBucket(id, opts as { public: boolean });
    buckets[id] = created.error ? created.error.message : "created";
  }

  const { error: tableError } = await admin.from("travel_albums_state").select("session_id").limit(1);
  if (tableError && /relation|does not exist|schema cache/i.test(tableError.message)) {
    const sqlPath = path.join(process.cwd(), "supabase/travel_albums_state.sql");
    const sql = await readFile(sqlPath, "utf8");
    return NextResponse.json({
      ok: false,
      needsMigration: true,
      buckets,
      message:
        "travel_albums_state 테이블이 없습니다. Supabase SQL Editor에서 supabase/travel_albums_state.sql 을 실행하세요.",
      sql,
    });
  }

  if (tableError) {
    return NextResponse.json({ ok: false, buckets, message: tableError.message });
  }

  return NextResponse.json({
    ok: true,
    buckets,
    message: "개인앨범 버킷·테이블 준비됨",
  });
}
