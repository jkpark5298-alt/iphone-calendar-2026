"use client";

import type { ReactNode, MouseEvent } from "react";
import {
  Bold,
  Eraser,
  ImagePlus,
  Minus,
  Plus,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import {
  AI_REPORT_CIRCLED_NUMBERS,
  AI_REPORT_FONT_SIZES,
  AI_REPORT_HIGHLIGHT_COLORS,
  AI_REPORT_TEXT_COLORS,
} from "../lib/aiReportEditor";

export function AiReportFormatToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFontSize,
  onFontSizeStep,
  onBold,
  onUnderline,
  onColor,
  onHighlight,
  onInsertChar,
  onRemoveFormat,
  onImage,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFontSize: (px: number) => void;
  onFontSizeStep: (delta: number) => void;
  onBold: () => void;
  onUnderline: () => void;
  onColor: (c: string) => void;
  onHighlight: (c: string) => void;
  onInsertChar: (ch: string) => void;
  onRemoveFormat?: () => void;
  onImage?: () => void;
}) {
  const keep = (e: MouseEvent) => e.preventDefault();

  return (
    <div className="giAiReportToolbar" aria-label="보고서 서식 도구">
      <ToolBtn onClick={onUndo} title="되돌리기" disabled={!canUndo}>
        <Undo2 className="giAiReportToolbarIcon" />
        <span>되돌리기</span>
      </ToolBtn>
      <ToolBtn onClick={onRedo} title="다시 실행" disabled={!canRedo}>
        <Redo2 className="giAiReportToolbarIcon" />
        <span>다시</span>
      </ToolBtn>
      <span className="giAiReportToolbarSep" aria-hidden />
      <ToolBtn onClick={onBold} title="굵게" onMouseDown={keep}>
        <Bold className="giAiReportToolbarIcon" />
      </ToolBtn>
      <ToolBtn onClick={onUnderline} title="밑줄" onMouseDown={keep}>
        <Underline className="giAiReportToolbarIcon" />
      </ToolBtn>
      <ToolBtn onClick={() => onInsertChar("• ")} title="불릿(•) 삽입" onMouseDown={keep}>
        <span className="giAiReportBulletChar" aria-hidden>
          •
        </span>
      </ToolBtn>
      {onRemoveFormat && (
        <ToolBtn onClick={onRemoveFormat} title="서식 지우기" onMouseDown={keep}>
          <Eraser className="giAiReportToolbarIcon" />
          <span>지우기</span>
        </ToolBtn>
      )}
      <ToolBtn onClick={() => onFontSizeStep(-1)} title="글자 작게" onMouseDown={keep}>
        <Minus className="giAiReportToolbarIcon" />
      </ToolBtn>
      <div className="giAiReportToolbarSizes">
        <span>크기</span>
        {AI_REPORT_FONT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            title={`${size}px`}
            onMouseDown={keep}
            onClick={() => onFontSize(size)}
          >
            {size}
          </button>
        ))}
      </div>
      <ToolBtn onClick={() => onFontSizeStep(1)} title="글자 크게" onMouseDown={keep}>
        <Plus className="giAiReportToolbarIcon" />
      </ToolBtn>
      <span className="giAiReportToolbarSep" aria-hidden />
      <span className="giAiReportToolbarLabel">글자</span>
      {AI_REPORT_TEXT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          className="giAiReportSwatch"
          onMouseDown={keep}
          onClick={() => onColor(c.color)}
          style={{ background: c.color }}
        />
      ))}
      <span className="giAiReportToolbarLabel">형광</span>
      {AI_REPORT_HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={`${c.label} 형광`}
          className="giAiReportHighlight"
          onMouseDown={keep}
          onClick={() => onHighlight(c.bg)}
          style={{ background: c.bg }}
        />
      ))}
      <div className="giAiReportToolbarSizes">
        <span>번호</span>
        {AI_REPORT_CIRCLED_NUMBERS.map((ch) => (
          <button key={ch} type="button" title={`${ch} 삽입`} onMouseDown={keep} onClick={() => onInsertChar(ch)}>
            {ch}
          </button>
        ))}
      </div>
      {onImage && (
        <ToolBtn onClick={onImage} title="이미지 추가">
          <ImagePlus className="giAiReportToolbarIcon" />
          <span>이미지</span>
        </ToolBtn>
      )}
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
  disabled,
  onMouseDown,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  onMouseDown?: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      className="giAiReportToolBtn"
    >
      {children}
    </button>
  );
}
