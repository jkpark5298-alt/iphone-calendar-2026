import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 파일 저장 공간(모든 버킷 합계). 화면 표시와 「80% 넘으면 Drive로 이동」 판단이 같은 숫자를 쓰도록 한 곳에서 잰다.
 * 예전에는 개인앨범은 앨범 폴더 하나, 보관량 표시는 정보사진 폴더 하나만 재서 실제보다 훨씬 작게 보였다.
 */
export const DEFAULT_STORAGE_QUOTA_BYTES = 1_000_000_000;

export function storageQuotaBytes(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_QUOTA_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STORAGE_QUOTA_BYTES;
}

export type BucketUsage = { bucket: string; bytes: number; files: number };

export type StorageUsageSummary = {
  usedBytes: number;
  quotaBytes: number;
  percent: number;
  files: number;
  buckets: BucketUsage[];
};

export type StorageObjectSize = { bucket: string; name: string; size: number };

async function listFromObjectsTable(supabase: SupabaseClient): Promise<StorageObjectSize[] | null> {
  const objects: StorageObjectSize[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await supabase
      .schema("storage")
      .from("objects")
      .select("bucket_id, name, metadata")
      .range(from, from + pageSize - 1);
    if (error || !data) return null;
    for (const row of data) {
      const size = Number((row.metadata as { size?: number | string } | null)?.size || 0);
      objects.push({ bucket: String(row.bucket_id), name: String(row.name), size: Number.isFinite(size) ? size : 0 });
    }
    if (data.length < pageSize) break;
  }
  return objects;
}

async function walkBucket(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
  out: StorageObjectSize[],
): Promise<void> {
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) break;
    for (const item of data) {
      if (!item.name || item.name === ".emptyFolderPlaceholder") continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) await walkBucket(supabase, bucket, path, out);
      else out.push({ bucket, name: path, size: Number(item.metadata?.size || 0) || 0 });
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
}

export async function listAllStorageObjects(supabase: SupabaseClient): Promise<StorageObjectSize[]> {
  const fromTable = await listFromObjectsTable(supabase);
  if (fromTable) return fromTable;
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const out: StorageObjectSize[] = [];
  for (const bucket of buckets || []) await walkBucket(supabase, bucket.name, "", out);
  return out;
}

export function summarizeObjects(objects: StorageObjectSize[], quotaBytes = storageQuotaBytes()): StorageUsageSummary {
  const byBucket = new Map<string, BucketUsage>();
  for (const object of objects) {
    const entry = byBucket.get(object.bucket) || { bucket: object.bucket, bytes: 0, files: 0 };
    entry.bytes += object.size;
    entry.files += 1;
    byBucket.set(object.bucket, entry);
  }
  const buckets = [...byBucket.values()].sort((a, b) => b.bytes - a.bytes);
  const usedBytes = buckets.reduce((sum, item) => sum + item.bytes, 0);
  return {
    usedBytes,
    quotaBytes,
    percent: quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : 0,
    files: buckets.reduce((sum, item) => sum + item.files, 0),
    buckets,
  };
}

let summaryCache: { at: number; value: StorageUsageSummary } | null = null;
const SUMMARY_CACHE_MS = 30_000;

/** 30초 동안 결과를 재사용한다 (여러 화면이 동시에 물어도 Supabase를 한 번만 조회). */
export async function measureStorageSummary(supabase: SupabaseClient, force = false): Promise<StorageUsageSummary> {
  if (!force && summaryCache && Date.now() - summaryCache.at < SUMMARY_CACHE_MS) return summaryCache.value;
  const value = summarizeObjects(await listAllStorageObjects(supabase));
  summaryCache = { at: Date.now(), value };
  return value;
}

export function invalidateStorageSummary(): void {
  summaryCache = null;
}
