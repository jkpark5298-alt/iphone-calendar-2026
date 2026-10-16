let usageRatio = 0;
let skipAlbumId: string | null = null;

export function noteStorageUsageRatio(usedBytes: number, quotaBytes: number): void {
  usageRatio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;
}

export function storageNeedsArchive(): boolean {
  return usageRatio >= 0.8;
}

export function setArchiveMigrationSkipAlbumId(id: string | null): void {
  skipAlbumId = id?.trim() || null;
}

export function archiveMigrationSkipAlbumId(): string | null {
  return skipAlbumId;
}
