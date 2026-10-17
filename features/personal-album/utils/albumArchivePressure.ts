let usageRatio = 0;
let lastUsedBytes = 0;
let lastQuotaBytes = 0;
let skipAlbumId: string | null = null;

export function noteStorageUsageRatio(usedBytes: number, quotaBytes: number): void {
  lastUsedBytes = Math.max(0, usedBytes);
  lastQuotaBytes = Math.max(0, quotaBytes);
  usageRatio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;
}

export function storageNeedsArchive(): boolean {
  return usageRatio >= 0.8;
}

export function readStorageUsage(): {
  usedBytes: number;
  quotaBytes: number;
  percent: number;
  known: boolean;
} {
  return {
    usedBytes: lastUsedBytes,
    quotaBytes: lastQuotaBytes,
    percent: lastQuotaBytes > 0 ? Math.round((lastUsedBytes / lastQuotaBytes) * 100) : 0,
    known: lastQuotaBytes > 0,
  };
}

function formatStorageSize(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    const gb = bytes / 1_000_000_000;
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1).replace(/\.0$/, "")}GB`;
  }
  const mb = bytes / 1_000_000;
  if (mb >= 10) return `${Math.round(mb)}MB`;
  if (mb >= 1) return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)}KB`;
  return `${Math.max(0, Math.round(bytes))}B`;
}

/** 예: "Supabase 저장 공간 732MB / 1GB (73%)" */
export function formatStorageUsageLabel(
  usedBytes = lastUsedBytes,
  quotaBytes = lastQuotaBytes,
): string | null {
  if (!(quotaBytes > 0)) return null;
  const percent = Math.round((Math.max(0, usedBytes) / quotaBytes) * 100);
  return `Supabase 저장 공간 ${formatStorageSize(usedBytes)} / ${formatStorageSize(quotaBytes)} (${percent}%)`;
}

export function setArchiveMigrationSkipAlbumId(id: string | null): void {
  skipAlbumId = id?.trim() || null;
}

export function archiveMigrationSkipAlbumId(): string | null {
  return skipAlbumId;
}
