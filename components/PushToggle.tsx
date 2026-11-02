"use client";

import React from "react";
import { disablePush, enablePush, getPushStatus, sendPushTest, type PushStatus } from "../lib/pushClient";

/** 이 기기의 일정 알림을 켜고 끄는 작은 줄. 일정 입력 폼 아래에 둔다. */
export function PushToggle() {
  const [status, setStatus] = React.useState<PushStatus>("checking");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void getPushStatus().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const run = async (action: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setMessage("");
    const result = await action();
    setMessage(result.message);
    setStatus(await getPushStatus());
    setBusy(false);
  };

  if (status === "checking") return null;

  const hint =
    status === "needs-install"
      ? "아이폰에서 알림을 받으려면 Safari 공유 버튼 → ‘홈 화면에 추가’로 설치한 뒤, 홈 화면의 앱에서 알림을 켜 주세요."
      : status === "unsupported"
        ? "이 브라우저는 알림을 지원하지 않습니다."
        : status === "unconfigured"
          ? "알림 서버 설정이 아직 되어 있지 않습니다."
          : status === "denied"
            ? "알림이 차단되어 있습니다. 설정 앱 → 알림 → 이 앱에서 허용해 주세요."
            : "";

  return (
    <div className="pushToggle">
      <div className="pushToggleRow">
        {status === "off" ? (
          <button type="button" disabled={busy} onClick={() => void run(enablePush)}>
            🔔 이 기기 알림 켜기
          </button>
        ) : null}
        {status === "on" ? (
          <>
            <span className="pushToggleOn">🔔 이 기기 알림 켜짐</span>
            <button type="button" disabled={busy} onClick={() => void run(sendPushTest)}>
              테스트
            </button>
            <button type="button" disabled={busy} onClick={() => void run(disablePush)}>
              끄기
            </button>
          </>
        ) : null}
      </div>
      {hint ? <div className="pushToggleHint">{hint}</div> : null}
      {message ? (
        <div className="pushToggleHint" role="status">
          {message}
        </div>
      ) : null}
    </div>
  );
}
