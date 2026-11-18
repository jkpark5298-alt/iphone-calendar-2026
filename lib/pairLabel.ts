/**
 * 두 사람(박종규 × 김현숙) 근무를 겹쳐 본 "함께" 표기. 근무표 앱(excel-schedule-calendar)의 getDualPairLabel과 같은 규칙.
 * C+P → 동시出 / C+D → 교대出退 / 당+P → 출근 지원
 * 休+(P|P6|P7|B7|교육) → 현숙🚗 / 休+休 → 동시休 / 休+A5, 休+D, 당+A5 → PICK UP / A+A5 → 동시退
 */
const HYUNSOOK_DRIVE_BOARDING = new Set(["P", "P6", "P7", "B7", "교육"]);

/** @param ops 박종규 근무(C/A/당/休…), @param boarding 김현숙 근무(B7/A5/P/D/P6/休…) */
export function getDualPairLabel(ops: string | null | undefined, boarding: string | null | undefined): string | null {
  if (!ops || !boarding) return null;

  if (ops === "C" && boarding === "P") return "동시出";
  if (ops === "C" && boarding === "D") return "교대出退";
  if (ops === "당" && boarding === "P") return "출근 지원";
  if (ops === "休" && HYUNSOOK_DRIVE_BOARDING.has(boarding)) return "현숙🚗";
  if (ops === "休" && boarding === "休") return "동시休";
  if (ops === "休" && boarding === "A5") return "PICK UP";
  if (ops === "休" && boarding === "D") return "PICK UP";
  if (ops === "당" && boarding === "A5") return "PICK UP";
  if (ops === "A" && boarding === "A5") return "동시退";
  return null;
}
