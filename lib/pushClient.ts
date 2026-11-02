/** 브라우저(아이폰 홈 화면 앱)에서 푸시 알림 구독을 켜고 끄는 도우미. */

export type PushStatus =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "unconfigured"
  | "denied"
  | "off"
  | "on";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  window.matchMedia("(display-mode: standalone)").matches;

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function getPushStatus(): Promise<PushStatus> {
  try {
    // 아이폰은 홈 화면에 추가한 앱에서만 푸시를 받을 수 있다.
    if (isIos() && !isStandalone()) return "needs-install";
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    if (!VAPID_PUBLIC_KEY) return "unconfigured";
    if (Notification.permission === "denied") return "denied";
    const subscription = await currentSubscription();
    return subscription && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

async function postJson(url: string, method: "POST" | "DELETE", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.ok !== false, error: typeof data?.error === "string" ? data.error : "" };
}

/** 알림 권한을 요청하고 이 기기를 서버에 등록한다. 버튼을 누른 직후(사용자 동작 안)에서 불러야 한다. */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, message: "알림이 허용되지 않았습니다." };

    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY),
      }));

    const saved = await postJson("/api/push/subscribe", "POST", subscription.toJSON());
    if (!saved.ok) return { ok: false, message: saved.error || "서버에 알림 기기를 저장하지 못했습니다." };
    return { ok: true, message: "알림을 켰습니다." };
  } catch (error) {
    return { ok: false, message: `알림을 켜지 못했습니다. ${(error as Error)?.message || ""}`.trim() };
  }
}

export async function disablePush(): Promise<{ ok: boolean; message: string }> {
  try {
    const subscription = await currentSubscription();
    if (subscription) {
      await postJson("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    return { ok: true, message: "알림을 껐습니다." };
  } catch (error) {
    return { ok: false, message: `알림을 끄지 못했습니다. ${(error as Error)?.message || ""}`.trim() };
  }
}

export async function sendPushTest(): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch("/api/push/test", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok) return { ok: true, message: "테스트 알림을 보냈습니다. 잠시 후 도착합니다." };
    return { ok: false, message: typeof data?.error === "string" ? data.error : "테스트 알림을 보내지 못했습니다." };
  } catch {
    return { ok: false, message: "테스트 알림을 보내지 못했습니다." };
  }
}
