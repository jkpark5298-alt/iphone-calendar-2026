/** 푸시 알림 서버 공통: web-push 설정, 관리자 Supabase 클라이언트. 서버 전용. */
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

let configured = false;

/** VAPID 키가 설정돼 있으면 web-push를 준비하고 true. 없으면 false. */
export function configureWebPush(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.NEXT_PUBLIC_SITE_URL || "https://iphone-calendar-2026.vercel.app";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function getPushAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 서버 키 환경변수가 없습니다.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export type StoredSubscription = { endpoint: string; p256dh: string; auth: string };

export type PushPayload = { title: string; body: string; tag?: string; url?: string };

/** 한 기기에 알림을 보낸다. 기기가 더는 구독하지 않으면 "gone"을 돌려준다. */
export async function sendToSubscription(
  subscription: StoredSubscription,
  payload: PushPayload,
): Promise<"sent" | "gone" | "failed"> {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: "high" },
    );
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return "gone";
    console.warn("push send failed:", status, (error as Error)?.message);
    return "failed";
  }
}
