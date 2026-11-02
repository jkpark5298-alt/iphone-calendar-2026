import { NextRequest, NextResponse } from "next/server";
import { assertAppApiAccess, assertRateLimit, clientIpFromRequest } from "../../../../lib/apiSecurity";
import { configureWebPush, getPushAdmin, sendToSubscription, type StoredSubscription } from "../../../../lib/pushServer";

export const dynamic = "force-dynamic";

/** 등록된 모든 기기에 테스트 알림을 보낸다("알림 테스트" 버튼). */
export async function POST(request: NextRequest) {
  const denied = assertAppApiAccess(request) || assertRateLimit(`push-test:${clientIpFromRequest(request)}`, 5, 60_000);
  if (denied) return denied;
  if (!configureWebPush()) {
    return NextResponse.json({ ok: false, error: "알림 서버 설정(VAPID 키)이 아직 없습니다." }, { status: 503 });
  }

  try {
    const admin = getPushAdmin();
    const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth");
    if (error) return NextResponse.json({ ok: false, error: "알림 저장 테이블이 없습니다. SQL을 먼저 실행해 주세요." }, { status: 500 });
    if (!subs?.length) return NextResponse.json({ ok: false, error: "알림을 켠 기기가 없습니다." }, { status: 404 });

    let sent = 0;
    const gone: string[] = [];
    for (const sub of subs as StoredSubscription[]) {
      const result = await sendToSubscription(sub, { title: "알림 테스트", body: "일정 알림이 이 기기로 도착합니다.", tag: "push-test", url: "/" });
      if (result === "sent") sent += 1;
      else if (result === "gone") gone.push(sub.endpoint);
    }
    if (gone.length) await admin.from("push_subscriptions").delete().in("endpoint", gone);
    return NextResponse.json({ ok: sent > 0, sent, removed: gone.length });
  } catch {
    return NextResponse.json({ ok: false, error: "알림을 보내지 못했습니다." }, { status: 500 });
  }
}
