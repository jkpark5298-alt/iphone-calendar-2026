"use client";

import React from "react";

export type ScheduleQuickNotice = { state: "saving" | "saved" | "error" | "invalid"; text: string } | null;

/** 일정 입력 폼(일정 / 날짜 / 시간 / 반복 / 색깔). 일정 화면과 일기장 화면에서 같이 쓴다. */
export function ScheduleQuickForm({
  title,
  onTitle,
  date,
  onDate,
  time,
  onTime,
  repeat,
  onRepeat,
  color,
  onColor,
  colors,
  editing,
  onSubmit,
  onCancel,
  notice,
  onRetry,
  titleRef,
}: {
  title: string;
  onTitle: (value: string) => void;
  date: string;
  onDate: (value: string) => void;
  time: string;
  onTime: (value: string) => void;
  repeat: string;
  onRepeat: (value: string) => void;
  color: string;
  onColor: (value: string) => void;
  colors: { value: string; label: string }[];
  editing: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  notice: ScheduleQuickNotice;
  onRetry?: () => void;
  titleRef?: React.Ref<HTMLInputElement>;
}) {
  const noticeColor = notice?.state === "error" || notice?.state === "invalid" ? "#c0392b" : notice?.state === "saved" ? "#2e7d32" : "#7a8594";
  return (
    <div className="scheduleQuick">
      <input
        ref={titleRef}
        className="scheduleQuickTitle"
        value={title}
        onChange={(event) => onTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="일정 내용"
        enterKeyHint="done"
        aria-label="일정 내용"
      />
      <div className="scheduleQuickRow">
        <label>
          <span>날짜</span>
          <input type="date" value={date} onChange={(event) => onDate(event.target.value)} />
        </label>
        <label>
          <span>시간 (선택)</span>
          <span className="scheduleQuickTimeWrap">
            <input type="time" value={time} onChange={(event) => onTime(event.target.value)} />
            {time ? (
              <button type="button" className="scheduleQuickClear" onClick={() => onTime("")} aria-label="시간 지우기">
                ×
              </button>
            ) : null}
          </span>
        </label>
      </div>
      <div className="scheduleQuickRow">
        <label>
          <span>반복</span>
          <select value={repeat} onChange={(event) => onRepeat(event.target.value)}>
            {["없음", "매일", "매주", "매월", "매년"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="scheduleQuickColors" role="radiogroup" aria-label="색깔">
          <span>색깔</span>
          <div>
            {colors.map((item) => (
              <button
                type="button"
                key={item.value}
                role="radio"
                aria-checked={color === item.value}
                aria-label={item.label}
                title={item.label}
                className={`scheduleQuickColor schedule-${item.value}${color === item.value ? " active" : ""}`}
                onClick={() => onColor(item.value)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="scheduleQuickActions">
        <button type="button" className="scheduleQuickSubmit" onClick={onSubmit}>
          {editing ? "수정 저장" : "저장하고 계속 입력"}
        </button>
        {editing ? (
          <button type="button" className="scheduleQuickCancel" onClick={onCancel}>
            수정 취소
          </button>
        ) : null}
      </div>
      {notice ? (
        <div className="scheduleQuickNotice" role="status" aria-live="polite" style={{ color: noticeColor }}>
          <span>{notice.text}</span>
          {notice.state === "error" && onRetry ? (
            <button type="button" onClick={onRetry}>
              다시 저장
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
