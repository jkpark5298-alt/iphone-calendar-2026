import { mergePhotosByExifDate } from "./albumPhotoOrderUtils";
import type { Chapter3AlbumDay, Chapter3AlbumPhoto } from "./chapter3Utils";

function albumPhotos(days: Chapter3AlbumDay[]): Chapter3AlbumPhoto[] {
  return days.flatMap((day) => day.places.flatMap((place) => place.photos));
}

/**
 * 편집기 내용을 저장본에 덮어쓰기 전에, 저장본에는 있는데 편집기에 없는 사진을 되살린다.
 * 사용자가 편집기에서 직접 지운 사진(removedIds)만 빠진 것으로 본다.
 * 편집기가 비었거나 예전 내용으로 다시 채워져도 앨범 사진이 사라지지 않게 하는 안전장치.
 */
export function restoreMissingAlbumPhotos(
  editorDays: Chapter3AlbumDay[],
  storedDays: Chapter3AlbumDay[],
  removedIds: ReadonlySet<string>,
  options?: { manualMode?: boolean },
): { days: Chapter3AlbumDay[]; restored: number } {
  const editorIds = new Set(albumPhotos(editorDays).map((photo) => photo.id));
  const missing = albumPhotos(storedDays).filter(
    (photo) => !editorIds.has(photo.id) && !removedIds.has(photo.id),
  );
  if (missing.length === 0) return { days: editorDays, restored: 0 };
  const merged = mergePhotosByExifDate(editorDays, missing, { manualMode: options?.manualMode });
  return { days: merged.days, restored: missing.length };
}
