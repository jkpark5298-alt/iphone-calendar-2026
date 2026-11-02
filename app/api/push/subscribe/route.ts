import { NextRequest, NextResponse } from "next/server";
import { assertAppApiAccess, assertRateLimit, clientIpFromRequest, genericApiError } from "../../../../lib/apiSecurity";
import { getPushAdmin } from "../../../../lib/pushServer";

export const dynamic = "force-dynamic";

const isHttpsUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** 이 기기의 푸시 구독을 저장한다. */
export async function POST(request: NextRequest) {
  const denied = assertAppApiAccess(request) || assertRateLimit(`push-sub:${clientIpFromRequest(request)}`, 20, 60_000);
  if (denied) return denied;

  try {
    const body = await request.json();
    const endpoint = body?.endpoint;
    const p256dh = body?.keys?.p256dh;
    const auth = body?.keys?.auth;
    if (!isHttpsUrl(endpoint) || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 300 || auth.length > 100) {
      return NextResponse.json({ ok: false, error: "구독 정보가 올바르지 않습니다." }, { status: 400 });
    }

    const { error } = await getPushAdmin()
      .from("push_subscriptions")
      .upsert(
        {
          endpoint,
          p256dh,
          auth,
          user_agent: (request.headers.get("user-agent") || "").slice(0, 300),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) {
      console.warn("push subscribe error:", error.message);
      return NextResponse.json(
        { ok: false, error: "알림 저장 테이블이 없습니다. push_subscriptions SQL을 먼저 실행해 주세요." },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return genericApiError(400);
  }
}

/** 이 기기의 푸시 구독을 지운다. */
export async function DELETE(request: NextRequest) {
  const denied = assertAppApiAccess(request) || assertRateLimit(`push-unsub:${clientIpFromRequest(request)}`, 20, 60_000);
  if (denied) return denied;

  try {
    const body = await request.json();
    if (!isHttpsUrl(body?.endpoint)) {
      return NextResponse.json({ ok: false, error: "구독 정보가 올바르지 않습니다." }, { status: 400 });
    }
    const { error } = await getPushAdmin().from("push_subscriptions").delete().eq("endpoint", body.endpoint);
    if (error) return genericApiError(500);
    return NextResponse.json({ ok: true });
  } catch {
    return genericApiError(400);
  }
}
