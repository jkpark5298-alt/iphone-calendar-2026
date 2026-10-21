"use client";

/**
 * 개인 앨범 (TRAVEL diary Chapter 3 개인 앨범 엔진 이식)
 * - 사진 EXIF 업로드, 임시저장/확정, Supabase 동기화, Drive 압축(80%/70%), PDF, 전체 백업, 일자/년도/장소 구분
 * - localStorage / sessionStorage 키 접두사: iphone-calendar-personal-album-*
 */

import "leaflet/dist/leaflet.css";
import "./personalAlbum.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PersonalAlbumShell } from "./components/PersonalAlbumShell";

export default function PersonalAlbumApp() {
  const [hint, setHint] = useState("");
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPasteHint = useCallback((msg: string) => {
    setHint(msg);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    if (msg) {
      hintTimerRef.current = setTimeout(() => setHint(""), 4500);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const driveFlag = params.get("googleDrive");
    if (!driveFlag) return;
    const driveMessages: Record<string, string> = {
      connected: "Google Drive 연결이 완료되었습니다.",
      updated: "Google Drive 연결이 갱신되었습니다.",
      missing: "Google Drive Client ID/Secret이 서버에 없습니다. Vercel env를 확인하세요.",
      "test-user": "Google에서 액세스가 거부되었습니다. OAuth 동의 화면 → 테스트 사용자에 계정을 추가하세요.",
      state: "Google Drive 연결 세션이 만료되었습니다. 다시 「Google Drive 연결」을 눌러 주세요.",
      token: "Google 토큰 교환에 실패했습니다. Client Secret·리디렉션 URI를 확인하세요.",
      "token-invalid_client":
        "Client ID/Secret이 맞지 않습니다. Google Cloud의 iphone-calendar-drive Secret을 Vercel에 다시 넣어야 합니다.",
      "token-invalid_grant":
        "인증 코드가 만료·재사용되었습니다. Google Drive 연결을 처음부터 다시 눌러 주세요.",
      "token-redirect_uri_mismatch":
        "리디렉션 URI가 일치하지 않습니다. Google Cloud에 https://iphone-calendar-2026.vercel.app/api/google-drive/callback 이 있는지 확인하세요.",
      "no-refresh": "refresh_token이 없습니다. myaccount.google.com/connections 에서 여행앨범·캘린더 앱을 삭제한 뒤 다시 연결하세요.",
      denied: "Google Drive 권한이 거부되었습니다. 「계속」→「허용」을 선택하세요.",
      owner: "이미 연결된 Google 계정과 다른 계정입니다. 기존 연결은 그대로 유지했습니다. 같은 계정으로 다시 연결해 주세요.",
      storage: "Drive 토큰을 Supabase private 버킷에 저장하지 못했습니다. 서비스 롤·버킷을 확인하세요.",
      folder: "Google Drive 폴더를 만들지 못했습니다. Drive API 사용 설정을 확인하세요.",
      error: "Google Drive 연결에 실패했습니다. 다시 시도해 주세요.",
    };
    showPasteHint(driveMessages[driveFlag] || `Google Drive 연결 결과: ${driveFlag}`);
    params.delete("googleDrive");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [showPasteHint]);

  return (
    <div className="personalAlbumRoot">
      {hint ? (
        <div className="noticeBar" role="status">
          {hint}
        </div>
      ) : null}
      <PersonalAlbumShell showPasteHint={showPasteHint} />
    </div>
  );
}

export { PersonalAlbumApp };
