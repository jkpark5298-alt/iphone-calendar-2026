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
      error: "Google Drive 연결에 실패했습니다.",
      denied: "Google Drive 권한이 거부되었습니다.",
    };
    showPasteHint(driveMessages[driveFlag] || driveMessages.error);
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
