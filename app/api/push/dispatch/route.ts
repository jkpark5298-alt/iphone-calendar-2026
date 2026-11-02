import { NextRequest, NextResponse } from "next/server";
import { dueReminders, type RemindRow } from "../../../../lib/pushSchedule";
import { configureWebPush, getPushAdmin, sendToSubscription, type StoredSubscription } from "../../../../lib/pushServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 정해진 주기(GitHub Actions, 5분마다)로 불려서 알림 시각이 된 일정을 모든 기기에 보낸다. */
export async function POST(request: NextRequest) {
  const tokens = [process.env.PUSH_CRON_SECRET, process.env.APP_API_TOKEN].filter(Boolean) as string[];
  const authorization = request.headers.get("authorization") || "";
  if (!tokens.some((token) => authorization === `Bearer ${token}`)) {
    return NextResponse.json({ ok: false, error: "요청 권한이 없습니다." }, { status: 401 });
  }
  if (!configureWebPush()) {
    return NextResponse.json({ ok: false, error: "VAPID 키 환경변수가 없습니다." }, { status: 503 });
  }

  try {
    const admin = getPushAdmin();

    const { data: rows, error: loadError } = await admin
      .from("calendar_schedules")
      .select("schedule_id, title, start_date, start_time, repeat, remind")
      .neq("remind", "");
    if (loadError) {
      return NextResponse.json(
        { ok: false, error: "calendar_schedules.remind 열을 읽지 못했습니다. 알림 SQL을 먼저 실행해 주세요.", detail: loadError.message },
        { status: 500 },
      );
    }

    const due = dueReminders((rows || []) as RemindRow[], Date.now());
    if (!due.length) return NextResponse.json({ ok: true, due: 0, sent: 0 });

    // 같은 알림을 두 번 보내지 않도록, 먼저 "보냄" 기록을 남기고 새로 기록된 것만 보낸다.
    const { data: claimed, error: claimError } = await admin
      .from("push_sent")
      .upsert(
        due.map((item) => ({ schedule_id: item.scheduleId, occurrence: item.occurrence, remind: item.remind })),
        { onConflict: "schedule_id,occurrence,remind", ignoreDuplicates: true },
      )
      .select("schedule_id, occurrence, remind");
    if (claimError) {
      return NextResponse.json(
        { ok: false, error: "push_sent 테이블을 쓰지 못했습니다. 알림 SQL을 먼저 실행해 주세요.", detail: claimError.message },
        { status: 500 },
      );
    }
    const claimedKeys = new Set((claimed || []).map((row) => `${row.schedule_id}|${row.occurrence}|${row.remind}`));
    const toSend = due.filter((item) => claimedKeys.has(`${item.scheduleId}|${item.occurrence}|${item.remind}`));
    if (!toSend.length) return NextResponse.json({ ok: true, due: due.length, sent: 0 });

    const { data: subs, error: subError } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth");
    if (subError) return NextResponse.json({ ok: false, error: "구독 목록을 읽지 못했습니다." }, { status: 500 });

    let sent = 0;
    let failed = 0;
    const gone: string[] = [];
    for (const item of toSend) {
      for (const sub of (subs || []) as StoredSubscription[]) {
        const result = await sendToSubscription(sub, {
          title: item.title,
          body: item.body,
          tag: `${item.scheduleId}-${item.occurrence}-${item.remind}`,
          url: "/",
        });
        if (result === "sent") sent += 1;
        else if (result === "gone") gone.push(sub.endpoint);
        else failed += 1;
      }
    }
    if (gone.length) await admin.from("push_subscriptions").delete().in("endpoint", Array.from(new Set(gone)));

    // 오래된 "보냄" 기록은 정리한다(30일 지난 것).
    await admin.from("push_sent").delete().lt("sent_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    return NextResponse.json({ ok: true, due: due.length, claimed: toSend.length, sent, failed, removed: gone.length });
  } catch (error) {
    console.warn("push dispatch error:", (error as Error)?.message);
    return NextResponse.json({ ok: false, error: "알림 처리 중 오류가 났습니다." }, { status: 500 });
  }
}
