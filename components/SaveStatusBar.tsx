"use client";

export type SaveBarState = "dirty" | "saving" | "saved" | "error";

function formatSavedAt(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 저장 상태 표시와 [저장] 버튼. 서버 저장이 끝났을 때만 '저장됨'으로 바뀝니다. */
export function SaveStatusBar({
  state,
  at,
  onSave,
}: {
  state: SaveBarState | null;
  at: string | null;
  onSave: () => void;
}) {
  const time = formatSavedAt(at);
  const label =
    state === "dirty"
      ? "수정됨 · 아직 저장 전"
      : state === "saving"
        ? "저장 중…"
        : state === "saved"
          ? `✓ 저장됨${time ? ` · ${time}` : ""}`
          : state === "error"
            ? "⚠ 서버 저장 실패 · 기기에 보관 중입니다. [저장]을 다시 눌러 주세요"
            : "";
  const color = state === "error" ? "#c0392b" : state === "saved" ? "#2e7d32" : "#7a8594";
  return (
    <div className="diarySaveStatus" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, margin: "2px 0 6px" }}>
      {label ? (
        <span role="status" aria-live="polite" style={{ fontSize: 12, color, textAlign: "right" }}>
          {label}
        </span>
      ) : null}
      <button
        type="button"
        className="pill-btn compact-pill diarySaveNowBtn"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSave}
        disabled={state === "saving"}
      >
        저장
      </button>
    </div>
  );
}
