"use client";

/**
 * SharedComponents.tsx
 * 공통 UI 컴포넌트 모음
 * StorageStatus, Card, DropZone, EmptyState, LoadingOverlay
 */

import React from "react";

// ==================== StorageStatus ====================
export function StorageStatus({
  storageReady,
  lastSavedAt,
  message,
  supabaseStatus,
  onClear,
}: {
  storageReady: boolean;
  lastSavedAt: string;
  message: string;
  supabaseStatus?: string;
  onClear: () => void;
}) {
  return (
    <>
      <section className="storageStatus">
        <div>
          <strong>
            {storageReady
              ? "💾 이 기기 브라우저 자동 저장 ON"
              : "저장 상태 확인중"}
          </strong>
          <span>
            {message ||
              "저장 자료가 변경되면 자동으로 이 기기 브라우저에 보관됩니다."}
          </span>
        </div>
        <div className="storageActions">
          <small>
            {lastSavedAt ? `마지막 저장: ${lastSavedAt}` : "아직 저장 기록 없음"}
          </small>
          <button type="button" onClick={onClear}>
            저장 초기화
          </button>
        </div>
      </section>

      {supabaseStatus && (
        <div className="supabaseStatusPanel">
          <span>Supabase 동기화:</span> <strong>{supabaseStatus}</strong>
        </div>
      )}
    </>
  );
}

// ==================== Card ====================
export function Card({
  number,
  title,
  subtitle,
  children,
  compact = false,
}: {
  number: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`card ${compact ? "compactCard" : ""}`}>
      <div className="cardHeader">
        <span className="cardNumber">{number}</span>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// ==================== DropZone ====================
export function DropZone({
  dragOver,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  dragOver: boolean;
  children: React.ReactNode;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`dropZone ${dragOver ? "dragOver" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}

// ==================== EmptyState ====================
export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="emptyState">
      <span>{icon}</span>
      <p>{text}</p>
    </div>
  );
}

// ==================== LoadingOverlay ====================
export function LoadingOverlay({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="overlay">
      <div className="loadingCard">
        <div className="loadingIcon">🤖</div>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="loadingBar">
          <span />
        </div>
      </div>
    </div>
  );
}
