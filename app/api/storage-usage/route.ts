import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BUCKET = "info-photos";
const GENERAL_PREFIX = "general-info/";

type UsagePart = {
  bytes: number;
  fileBytes: number;
  textBytes: number;
  files: number;
};

const emptyPart = (): UsagePart => ({ bytes: 0, fileBytes: 0, textBytes: 0, files: 0 });

const byteLength = (value: unknown) => {
  if (value == null) return 0;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  return Buffer.byteLength(JSON.stringify(value), "utf8");
};

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase URL 또는 Key 환경변수가 없습니다.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
};

const listStorageObjects = async (supabase: SupabaseClient) => {
  const fromTable = await listStorageObjectsFromTable(supabase);
  if (fromTable) return fromTable;
  return listStorageObjectsByFolder(supabase, "");
};

const listStorageObjectsFromTable = async (supabase: SupabaseClient) => {
  const objects: Array<{ name: string; size: number }> = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await supabase
      .schema("storage")
      .from("objects")
      .select("name, metadata")
      .eq("bucket_id", BUCKET)
      .range(from, from + pageSize - 1);
    if (error || !data) return null;
    for (const row of data) {
      const metadata = row.metadata as { size?: number | string } | null;
      const size = Number(metadata?.size || 0);
      objects.push({
        name: String(row.name || ""),
        size: Number.isFinite(size) ? size : 0,
      });
    }
    if (data.length < pageSize) break;
  }
  return objects;
};

const listStorageObjectsByFolder = async (supabase: SupabaseClient, prefix: string) => {
  const objects: Array<{ name: string; size: number }> = [];
  let offset = 0;
  while (offset < 50000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) break;
    for (const item of data) {
      if (!item.name || item.name === ".emptyFolderPlaceholder") continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) {
        objects.push(...(await listStorageObjectsByFolder(supabase, path)));
        continue;
      }
      const size = Number(item.metadata?.size || 0);
      objects.push({ name: path, size: Number.isFinite(size) ? size : 0 });
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return objects;
};

const sumColumnBytes = (rows: Array<Record<string, unknown>>, columns: string[]) =>
  rows.reduce(
    (total, row) => total + columns.reduce((rowTotal, column) => rowTotal + byteLength(row[column]), 0),
    0,
  );

const loadPagedRows = async (
  supabase: SupabaseClient,
  table: string,
  columns: string,
) => {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 200;
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as unknown as Array<Record<string, unknown>>));
    if (data.length < pageSize) break;
  }
  return rows;
};

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const generalInfo = emptyPart();
    const photobook = emptyPart();

    const objects = await listStorageObjects(supabase);
    for (const object of objects) {
      const target = object.name.startsWith(GENERAL_PREFIX) ? generalInfo : photobook;
      target.fileBytes += object.size;
      target.files += 1;
    }

    const generalColumns = [
      "title",
      "text",
      "summary",
      "extra_note",
      "fact_check_summary",
      "formatted_text_html",
      "file_preview",
      "media_items",
      "keywords",
      "source_url",
    ];
    let generalRows: Array<Record<string, unknown>>;
    try {
      generalRows = await loadPagedRows(supabase, "general_info_items", generalColumns.join(", "));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/formatted_text_html/i.test(message)) throw error;
      generalRows = await loadPagedRows(
        supabase,
        "general_info_items",
        generalColumns.filter((column) => column !== "formatted_text_html").join(", "),
      );
    }
    generalInfo.textBytes = sumColumnBytes(generalRows, generalColumns);

    const photoRows = await loadPagedRows(supabase, "info_photos", "storage_path, caption");
    for (const row of photoRows) {
      const path = String(row.storage_path || "");
      const target = path.includes(GENERAL_PREFIX) ? generalInfo : photobook;
      target.textBytes += byteLength(row.caption);
    }

    generalInfo.bytes = generalInfo.fileBytes + generalInfo.textBytes;
    photobook.bytes = photobook.fileBytes + photobook.textBytes;

    return NextResponse.json({
      ok: true,
      generalInfo,
      photobook,
      total: {
        bytes: generalInfo.bytes + photobook.bytes,
        files: generalInfo.files + photobook.files,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "보관량을 계산하지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
