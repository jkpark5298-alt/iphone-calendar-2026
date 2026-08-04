"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NewsItem } from "../types/news";

type NewsAlertModalProps = {
  open: boolean;
  onClose: () => void;
  onSaveSelected?: (items: NewsItem[]) => void | Promise<void>;
};

function formatPublishedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NewsAlertModal({ open, onClose, onSaveSelected }: NewsAlertModalProps) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("뉴스를 불러오는 중...");
  const [busy, setBusy] = useState(false);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds]
  );

  const loadNews = useCallback(async () => {
    setLoading(true);
    setStatus("뉴스를 불러오는 중...");
    try {
      const response = await fetch("/api/news", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "news error");
      }
      const nextItems: NewsItem[] = Array.isArray(data.items) ? data.items.slice(0, 5) : [];
      setItems(nextItems);
      setSelectedIds([]);
      setStatus(nextItems.length ? `오늘 뉴스 ${nextItems.length}건` : "표시할 뉴스가 없습니다.");
    } catch (error) {
      console.warn(error);
      setItems([]);
      setSelectedIds([]);
      setStatus("뉴스를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadNews();
  }, [open, loadNews]);

  function toggleItem(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  }

  function selectAll() {
    setSelectedIds(items.map((item) => item.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function shareSelected() {
    if (!selectedItems.length) {
      alert("공유할 뉴스를 선택하세요.");
      return;
    }
    const text = selectedItems
      .map(
        (item, index) =>
          `${index + 1}. [${item.category}] ${item.title}\n${item.summary}${item.url ? `\n${item.url}` : ""}`
      )
      .join("\n\n");

    try {
      if (navigator.share) {
        await navigator.share({
          title: "선택한 뉴스",
          text,
        });
        return;
      }
    } catch {
      // fall through to clipboard
    }

    try {
      await navigator.clipboard.writeText(text);
      alert("선택한 뉴스 내용을 클립보드에 복사했습니다.");
    } catch {
      alert(text);
    }
  }

  async function saveSelected() {
    if (!selectedItems.length) {
      alert("저장할 뉴스를 선택하세요.");
      return;
    }
    if (!onSaveSelected) {
      alert("저장 기능을 사용할 수 없습니다.");
      return;
    }
    setBusy(true);
    try {
      await onSaveSelected(selectedItems);
      setSelectedIds([]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="news-alert-modal"
      role="dialog"
      aria-modal="true"
      aria-label="뉴스 알림"
      onClick={onClose}
    >
      <div className="news-alert-panel" onClick={(event) => event.stopPropagation()}>
        <div className="news-alert-header">
          <div>
            <h3>알림 · 뉴스</h3>
            <p className="news-alert-status">{status}</p>
          </div>
          <div className="news-alert-header-actions">
            <button type="button" className="soft-btn" disabled={loading || busy} onClick={() => void loadNews()}>
              새로고침
            </button>
            <button type="button" className="pill-btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="news-alert-selection-bar">
            <span>☑️ 선택 {selectedIds.length}개</span>
            <div className="news-alert-selection-actions">
              <button type="button" className="pill-btn compact-pill" disabled={busy} onClick={() => void shareSelected()}>
                공유
              </button>
              {onSaveSelected && (
                <button
                  type="button"
                  className="pill-btn compact-pill news-alert-save-btn"
                  disabled={busy}
                  onClick={() => void saveSelected()}
                >
                  {busy ? "저장 중..." : "일반정보에 저장"}
                </button>
              )}
              <button type="button" className="pill-btn compact-pill news-alert-clear-btn" disabled={busy} onClick={clearSelection}>
                선택 해제
              </button>
            </div>
          </div>
        )}

        <div className="news-alert-toolbar">
          <button type="button" className="mini-btn" disabled={!items.length || loading} onClick={selectAll}>
            전체 선택
          </button>
          <button type="button" className="mini-btn" disabled={!selectedIds.length} onClick={clearSelection}>
            선택 해제
          </button>
        </div>

        <div className="news-alert-list" aria-busy={loading}>
          {loading && <div className="news-alert-empty">불러오는 중...</div>}
          {!loading && items.length === 0 && <div className="news-alert-empty">표시할 뉴스가 없습니다.</div>}
          {!loading &&
            items.map((item) => {
              const checked = selectedIds.includes(item.id);
              return (
                <label
                  key={item.id}
                  className={`news-alert-card ${checked ? "selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="news-alert-checkbox"
                    checked={checked}
                    onChange={() => toggleItem(item.id)}
                  />
                  <div className="news-alert-card-body">
                    <div className="news-alert-card-meta">
                      <span className="news-alert-category">{item.category}</span>
                      <span className="news-alert-source">{item.source}</span>
                      <span className="news-alert-time">{formatPublishedAt(item.publishedAt)}</span>
                    </div>
                    <strong className="news-alert-title">{item.title}</strong>
                    <p className="news-alert-summary">{item.summary}</p>
                    {item.url && (
                      <a
                        className="news-alert-link"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        원문 보기
                      </a>
                    )}
                  </div>
                </label>
              );
            })}
        </div>
      </div>
    </div>
  );
}
