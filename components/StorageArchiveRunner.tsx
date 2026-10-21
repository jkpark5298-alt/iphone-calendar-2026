"use client";

import { useEffect } from "react";

/**
 * 앱을 열고 잠시 뒤 Supabase 저장 공간을 확인한다.
 * 80%를 넘으면 일반정보수집 사진을 Google Drive로 옮기고, 70% 아래로 내려갈 때까지 이어서 한다.
 * 80% 미만이면 가벼운 확인 한 번(약 0.5KB)으로 끝난다.
 */
const LAST_RUN_KEY = "storage-archive-last-run";
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const START_DELAY_MS = 20_000;
const START_RATIO = 80;
const MAX_ROUNDS = 12;

type UsageSummary = { ok?: boolean; percent?: number };
type ArchiveResponse = { ok?: boolean; skipped?: string; percent?: number; moved?: number; remaining?: number };

export function StorageArchiveRunner() {
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const last = Number(localStorage.getItem(LAST_RUN_KEY) || "0");
        if (Date.now() - last < MIN_INTERVAL_MS) return;
      } catch {
        /* 저장소를 못 쓰면 매번 확인 */
      }

      const usage = (await fetch("/api/storage-usage?summary=1", { cache: "no-store" })
        .then((response) => response.json())
        .catch(() => null)) as UsageSummary | null;
      if (cancelled || !usage?.ok || (usage.percent ?? 0) < START_RATIO) return;

      try {
        localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }

      let movedTotal = 0;
      for (let round = 0; round < MAX_ROUNDS && !cancelled; round += 1) {
        const result = (await fetch(`/api/storage-archive${round > 0 ? "?continue=1" : ""}`, { method: "POST" })
          .then((response) => response.json())
          .catch(() => null)) as ArchiveResponse | null;
        if (!result?.ok || result.skipped) break;
        movedTotal += result.moved || 0;
        if (!result.moved || !result.remaining) break;
      }

      // 글의 사진 주소가 바뀌었으니 화면의 목록도 새로 받게 한다.
      if (movedTotal > 0 && !cancelled) window.dispatchEvent(new Event("general-info:reload"));
    };

    const timer = window.setTimeout(() => void run(), START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
