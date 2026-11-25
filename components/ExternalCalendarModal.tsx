"use client";

import { useRef, useState } from "react";
import { REMIND_OPTIONS } from "../lib/pushSchedule";
import {
  COLOR_OPTIONS, ICON_OPTIONS, agoLabel, fetchNaverSources, fetchUrlSource, readIcsFile, refreshSources,
  type ExternalSource, type FetchedSource,
} from "../lib/externalCalendars";
import type { ImportedEvent } from "../lib/icsImport";

type Props = {
  sources: ExternalSource[];
  /** 받은 일정을 캘린더에 넣는다. events가 없으면 출처 정보(오류 등)만 바뀐 것 */
  onApply: (results: Array<{ source: ExternalSource; events?: ImportedEvent[] }>) => Promise<boolean>;
  /** 아이콘·색·알림을 바꾼다 (이미 넣은 일정에도 반영) */
  onUpdateSource: (source: ExternalSource) => Promise<boolean>;
  onRemoveSource: (source: ExternalSource) => Promise<boolean>;
  /** 기존 근무표(ICS/JSON) 가져오기 */
  onWorkScheduleFile: (file: File | null) => void;
  onClose: () => void;
};

export default function ExternalCalendarModal({
  sources, onApply, onUpdateSource, onRemoveSource, onWorkScheduleFile, onClose,
}: Props) {
  const icsInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"url" | "naver" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [naverId, setNaverId] = useState("");
  const [naverPw, setNaverPw] = useState("");

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setMessage("");
    try {
      setMessage(await task());
    } catch (error) {
      setMessage(`❌ ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const summary = (list: FetchedSource[], saved: boolean) =>
    list.map(({ source, events }) => `✅ ${source.icon} ${source.name}: 일정 ${events.length}건`).join("\n") +
    (saved ? "" : "\n⚠️ 기기에는 넣었지만 서버 저장에 실패했습니다. 잠시 뒤 다시 시도해 주세요.");

  const handleIcsFiles = (files: FileList | null) => run(async () => {
    if (!files?.length) return "";
    const list: FetchedSource[] = [];
    let known = sources;
    for (const file of Array.from(files)) {
      const fetched = await readIcsFile(file, known);
      list.push(fetched);
      known = [...known.filter((s) => s.id !== fetched.source.id), fetched.source];
    }
    return summary(list, await onApply(list));
  });

  const handleUrl = () => run(async () => {
    if (!url.trim()) throw new Error("구독 주소를 넣어 주세요.");
    const fetched = await fetchUrlSource(url, sources);
    const saved = await onApply([fetched]);
    setUrl("");
    setMode(null);
    return summary([fetched], saved);
  });

  const handleNaver = () => run(async () => {
    if (!naverId.trim() || !naverPw) throw new Error("네이버 아이디와 애플리케이션 비밀번호를 모두 넣어 주세요.");
    const list = await fetchNaverSources(naverId, naverPw, sources);
    if (!list.length) throw new Error("가져올 네이버 캘린더가 없습니다.");
    const saved = await onApply(list);
    setNaverPw("");
    setMode(null);
    return summary(list, saved);
  });

  const handleRefresh = () => run(async () => {
    const results = await refreshSources(sources, 0);
    if (!results.length) return "새로 받을 구독이 없습니다. (파일로 가져온 일정은 파일을 다시 가져와 주세요)";
    const saved = await onApply(results);
    const failed = results.filter((r) => !r.events).length;
    return (failed ? `구독 ${results.length - failed}개 갱신, ${failed}개 실패 (목록의 빨간 글씨 확인)` : `✅ 구독 ${results.length}개를 최신 일정으로 갱신했습니다.`)
      + (saved ? "" : "\n⚠️ 서버 저장에 실패했습니다.");
  });

  const change = (source: ExternalSource, patch: Partial<ExternalSource>) =>
    run(async () => ((await onUpdateSource({ ...source, ...patch })) ? "" : "⚠️ 서버 저장에 실패했습니다."));

  const remove = (source: ExternalSource) => {
    if (!window.confirm(`'${source.name}'에서 가져온 일정을 캘린더에서 모두 지울까요?`)) return;
    void run(async () => ((await onRemoveSource(source)) ? `🗑 ${source.name} 일정을 지웠습니다.` : "⚠️ 서버 저장에 실패했습니다."));
  };

  const hasSubscriptions = sources.some((s) => s.kind !== "file");

  return (
    <div className="ext-cal-overlay" role="dialog" aria-modal="true" aria-label="가져오기" onClick={onClose}>
      <div className="ext-cal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="ext-cal-head">
          <strong>가져오기</strong>
          <button type="button" className="ext-cal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="ext-cal-section">
          <p className="ext-cal-label">근무표</p>
          <label className="ext-cal-btn">
            근무표 파일 (ICS / JSON)
            <input
              type="file"
              accept=".ics,.json,text/calendar,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                event.target.value = "";
                onClose();
                onWorkScheduleFile(file);
              }}
            />
          </label>
        </div>

        <div className="ext-cal-section">
          <p className="ext-cal-label">일정 (축구 경기 등) · 모든 시간은 한국시간</p>
          <div className="ext-cal-row">
            <button type="button" className="ext-cal-btn" disabled={busy} onClick={() => icsInputRef.current?.click()}>
              📄 ICS 파일
            </button>
            <button type="button" className={`ext-cal-btn ${mode === "url" ? "active" : ""}`} disabled={busy} onClick={() => setMode(mode === "url" ? null : "url")}>
              🔗 구독 주소
            </button>
            <button type="button" className={`ext-cal-btn ${mode === "naver" ? "active" : ""}`} disabled={busy} onClick={() => setMode(mode === "naver" ? null : "naver")}>
              N 네이버
            </button>
          </div>
          <input
            ref={icsInputRef}
            type="file"
            accept=".ics,.ical,.icalendar,text/calendar"
            multiple
            hidden
            onChange={(event) => { void handleIcsFiles(event.target.files); event.target.value = ""; }}
          />

          {mode === "url" && (
            <div className="ext-cal-form">
              <input
                type="url"
                inputMode="url"
                placeholder="webcal:// 또는 https://…ics"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void handleUrl(); }}
              />
              <button type="button" className="ext-cal-btn primary" disabled={busy} onClick={() => { void handleUrl(); }}>
                {busy ? "받는 중…" : "구독"}
              </button>
              <p className="ext-cal-help">
                구단·리그 홈페이지의 &lsquo;캘린더 구독&rsquo; 주소나 구글 캘린더의 &lsquo;iCal 형식 주소&rsquo;를 붙여 넣으세요.
                이 기기에서 앱을 열 때(3시간 간격) 자동으로 최신 일정으로 바뀝니다.
              </p>
            </div>
          )}

          {mode === "naver" && (
            <div className="ext-cal-form">
              <input type="text" autoComplete="username" placeholder="네이버 아이디" value={naverId} onChange={(event) => setNaverId(event.target.value)} />
              <input
                type="password"
                autoComplete="off"
                placeholder="애플리케이션 비밀번호"
                value={naverPw}
                onChange={(event) => setNaverPw(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void handleNaver(); }}
              />
              <button type="button" className="ext-cal-btn primary" disabled={busy} onClick={() => { void handleNaver(); }}>
                {busy ? "연결 중…" : "연결"}
              </button>
              <p className="ext-cal-help">
                일반 로그인 비밀번호가 아니라 <b>애플리케이션 비밀번호</b>를 넣어야 합니다
                (네이버 → 내정보 → 보안설정 → 2단계 인증 → 애플리케이션 비밀번호 관리).
                비밀번호는 이 기기 브라우저에만 저장되고, 갱신할 때 네이버로 전달하는 데만 씁니다.
              </p>
            </div>
          )}

          {busy && !mode && <p className="ext-cal-help">처리 중…</p>}
          {message && <pre className="ext-cal-message">{message}</pre>}
        </div>

        {sources.length > 0 && (
          <div className="ext-cal-section">
            <div className="ext-cal-row ext-cal-list-head">
              <p className="ext-cal-label">가져온 일정</p>
              {hasSubscriptions && (
                <button type="button" className="ext-cal-link" disabled={busy} onClick={() => { void handleRefresh(); }}>↻ 구독 새로고침</button>
              )}
            </div>
            <ul className="ext-cal-list">
              {sources.map((source) => (
                <li key={source.id}>
                  <div className="ext-cal-row">
                    <select
                      className="ext-cal-icon"
                      value={source.icon}
                      disabled={busy}
                      aria-label="아이콘"
                      onChange={(event) => { void change(source, { icon: event.target.value }); }}
                    >
                      {Array.from(new Set([source.icon, ...ICON_OPTIONS])).map((icon) => (
                        <option key={icon || "none"} value={icon}>{icon || "없음"}</option>
                      ))}
                    </select>
                    <span className="ext-cal-name">{source.name}</span>
                    <span className="ext-cal-count">{source.eventCount ?? 0}건</span>
                  </div>
                  <p className={`ext-cal-sync ${source.lastSyncError ? "error" : ""}`}>
                    {source.kind === "file" ? "파일" : source.kind === "url" ? "구독 주소 · 자동 갱신" : `네이버 ${source.username} · 자동 갱신`}
                    {" · "}
                    {source.lastSyncError ? `갱신 실패: ${source.lastSyncError}` : `${agoLabel(source.lastSyncedAt)} 받음`}
                  </p>
                  <div className="ext-cal-row">
                    <label className="ext-cal-select">
                      알림
                      <select value={source.remind} disabled={busy} onChange={(event) => { void change(source, { remind: event.target.value }); }}>
                        {REMIND_OPTIONS.map((option) => (
                          <option key={option.value || "none"} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="ext-cal-select">
                      색
                      <select value={source.color} disabled={busy} onChange={(event) => { void change(source, { color: event.target.value }); }}>
                        {COLOR_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="ext-cal-link danger" disabled={busy} onClick={() => remove(source)}>삭제</button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="ext-cal-help">
              🔔 알림은 이 앱의 푸시 알림으로 옵니다(앱을 닫아도 옴). 알림을 받으려면 이 기기에서 푸시 알림이 켜져 있어야 합니다.
              종일 일정의 &lsquo;정시&rsquo;는 오전 9시, &lsquo;전날 저녁 8시&rsquo;는 전날 20시에 옵니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
