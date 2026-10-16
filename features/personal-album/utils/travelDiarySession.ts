/**
 * PC · 아이폰이 같은 클라우드 세션을 쓰도록 하는 공유 세션 ID.
 * - 기본값 "default": 기존 데이터와 호환, 집안 기기 간 공유 유지
 * - localStorage에 같은 값을 넣으면 기기끼리 짝을 맞출 수 있음
 */
const SESSION_STORAGE_KEY = "iphone-calendar-personal-album-session-id";

export function getTravelDiarySessionId(): string {
  if (typeof window === "undefined") return "default";
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY)?.trim();
    if (existing) return existing;
    localStorage.setItem(SESSION_STORAGE_KEY, "default");
    return "default";
  } catch {
    return "default";
  }
}

export function setTravelDiarySessionId(sessionId: string): void {
  if (typeof window === "undefined") return;
  const next = sessionId.trim() || "default";
  localStorage.setItem(SESSION_STORAGE_KEY, next);
}
