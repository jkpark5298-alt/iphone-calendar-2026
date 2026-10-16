/**
 * Chapter 3 클라우드 동기화 이벤트 (PC · 아이폰)
 */
import type { Chapter3ManualTripsStore } from "./chapter3ManualStorage";

export const CHAPTER3_CLOUD_SYNC_EVENT = "travel-diary-chapter3-cloud-sync";

export type Chapter3CloudSyncDetail = {
  manualTrips?: Chapter3ManualTripsStore | null;
};

export function dispatchChapter3CloudSync(detail: Chapter3CloudSyncDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<Chapter3CloudSyncDetail>(CHAPTER3_CLOUD_SYNC_EVENT, { detail }),
  );
}
