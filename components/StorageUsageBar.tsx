"use client";

import { useEffect, useState } from "react";

type UsagePart = {
  bytes: number;
  fileBytes: number;
  textBytes: number;
  files: number;
};

type StorageUsage = {
  generalInfo: UsagePart;
  photobook: UsagePart;
  total: { bytes: number; files: number };
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; usage: StorageUsage };

const CACHE_MS = 60_000;
let cached: { at: number; usage: StorageUsage } | null = null;
let inflight: Promise<StorageUsage> | null = null;

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const detail = (part: UsagePart) =>
  `사진 ${formatBytes(part.fileBytes)} (${part.files}개) · 글 ${formatBytes(part.textBytes)}`;

async function fetchStorageUsage(force: boolean) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.usage;
  if (!force && inflight) return inflight;
  inflight = fetch("/api/storage-usage", { cache: "no-store" })
    .then(async (response) => {
      const body = (await response.json()) as StorageUsage & { ok?: boolean; error?: string };
      if (!response.ok || body.ok === false) {
        throw new Error(body.error || "보관량을 불러오지 못했습니다.");
      }
      cached = { at: Date.now(), usage: body };
      return body;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function StorageUsageBar() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = (force: boolean) => {
    setState({ status: "loading" });
    void fetchStorageUsage(force)
      .then((usage) => setState({ status: "ready", usage }))
      .catch((error: unknown) => {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "보관량을 불러오지 못했습니다.",
        });
      });
  };

  useEffect(() => {
    load(false);
  }, []);

  return (
    <div className="storageUsageBar" aria-live="polite">
      <span className="storageUsageLabel">보관량</span>
      {state.status === "loading" ? <span>계산 중...</span> : null}
      {state.status === "error" ? <span>{state.message}</span> : null}
      {state.status === "ready" ? (
        <>
          <span title={detail(state.usage.generalInfo)}>
            일반정보수집 <b>{formatBytes(state.usage.generalInfo.bytes)}</b>
          </span>
          <span title={detail(state.usage.photobook)}>
            포토북 <b>{formatBytes(state.usage.photobook.bytes)}</b>
          </span>
          <span title={`파일 ${state.usage.total.files}개`}>
            전체 <b>{formatBytes(state.usage.total.bytes)}</b>
          </span>
        </>
      ) : null}
      <button type="button" onClick={() => load(true)} disabled={state.status === "loading"}>
        다시 계산
      </button>
    </div>
  );
}
