/** 본문 복사 후 외부 AI 앱으로 이동할 때 쓰는 딥링크/폴백 URL */

export type ExternalAppTarget = "gemini" | "daglo";

type AppOpenConfig = {
  label: string;
  /** 우선 시도할 커스텀 스킴 (앱이 있으면 열림) */
  schemes: string[];
  /** 스킴 실패·미설치 시 웹/유니버설 링크 */
  fallbackUrl: string;
};

const APP_OPEN_CONFIG: Record<ExternalAppTarget, AppOpenConfig> = {
  gemini: {
    label: "Gemini",
    schemes: ["googlegemini://", "googleapp://robin"],
    fallbackUrl: "https://gemini.google.com/app",
  },
  daglo: {
    label: "Daglo",
    // 다글로는 daglo.ai 유니버설 링크로 앱 실행 (AASA paths: *)
    schemes: ["daglo://"],
    fallbackUrl: "https://daglo.ai/",
  },
};

/**
 * 사용자 제스처 안에서 앱 스킴 → 폴백 순으로 연다.
 * iPhone Safari에서는 커스텀 스킴이 실패해도 조용히 무시될 수 있어, 짧은 대기 후 폴백한다.
 */
export function openExternalApp(target: ExternalAppTarget): void {
  const config = APP_OPEN_CONFIG[target];
  if (typeof window === "undefined") return;

  const urls = [...config.schemes, config.fallbackUrl].filter(Boolean);
  if (!urls.length) return;

  let index = 0;
  const startedAt = Date.now();
  let settled = false;

  const tryNext = () => {
    if (settled || index >= urls.length) return;
    const url = urls[index++];
    const isHttp = /^https?:\/\//i.test(url);

    if (isHttp) {
      settled = true;
      // 유니버설 링크·웹은 같은 탭/새 탭 모두 가능 — 앱 전환이 목적일 때는 location이 더 안정적
      window.location.href = url;
      return;
    }

    try {
      window.location.href = url;
    } catch {
      tryNext();
      return;
    }

    window.setTimeout(() => {
      if (settled) return;
      // 앱으로 전환되면 보통 document.hidden 이 되거나 페이지가 백그라운드가 됨
      if (document.hidden || Date.now() - startedAt > 2500) {
        settled = true;
        return;
      }
      tryNext();
    }, 700);
  };

  const onHide = () => {
    settled = true;
    document.removeEventListener("visibilitychange", onHide);
  };
  document.addEventListener("visibilitychange", onHide);

  tryNext();
}

export function getExternalAppLabel(target: ExternalAppTarget): string {
  return APP_OPEN_CONFIG[target].label;
}
