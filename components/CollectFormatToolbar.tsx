"use client";

import type { ReactNode, MouseEvent } from "react";
import {
  Bold,
  ClipboardPaste,
  ImagePlus,
  Minus,
  PenLine,
  Plus,
  Redo2,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import {
  COLLECT_CIRCLED_NUMBERS,
  COLLECT_FONT_SIZES,
  COLLECT_HIGHLIGHT_COLORS,
  COLLECT_TEXT_COLORS,
} from "../lib/collectFormatPalette";

/** builder FormatToolbar — 형식·기능 동일 */
export function CollectFormatToolbar({
  canUndo = true,
  canRedo = true,
  onUndo,
  onRedo,
  onFontSize,
  onFontSizeStep,
  onBold,
  onUnderline,
  onColor,
  onHighlight,
  onInsertChar,
  onImage,
  onPasteImage,
  onTextImage,
  onHandwriting,
}: {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFontSize: (px: number) => void;
  onFontSizeStep: (delta: number) => void;
  onBold: () => void;
  onUnderline: () => void;
  onColor: (c: string) => void;
  onHighlight: (c: string) => void;
  onInsertChar: (ch: string) => void;
  onImage: () => void;
  onPasteImage: () => void;
  onTextImage: () => void;
  onHandwriting: () => void;
}) {
  const keepSelection = (e: MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div className="collectFormatToolbar" aria-label="Text 편집 도구">
      <ToolBtn onClick={onUndo} title="되돌리기 (Ctrl+Z)" disabled={!canUndo}>
        <Undo2 className="collectFormatToolbarIcon" />
        <span>되돌리기</span>
      </ToolBtn>
      <ToolBtn onClick={onRedo} title="다시 실행 (Ctrl+Y)" disabled={!canRedo}>
        <Redo2 className="collectFormatToolbarIcon" />
        <span>다시 실행</span>
      </ToolBtn>
      <span className="collectFormatToolbarSep" aria-hidden />
      <ToolBtn onClick={onBold} title="굵게" onMouseDown={keepSelection}>
        <Bold className="collectFormatToolbarIcon" />
      </ToolBtn>
      <ToolBtn onClick={onUnderline} title="밑줄" onMouseDown={keepSelection}>
        <Underline className="collectFormatToolbarIcon" />
      </ToolBtn>
      <ToolBtn
        onClick={() => onFontSizeStep(-1)}
        title="글자 작게"
        onMouseDown={keepSelection}
      >
        <Minus className="collectFormatToolbarIcon" />
      </ToolBtn>
      <div className="collectFormatToolbarSizes">
        <span>크기</span>
        {COLLECT_FONT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            title={`${size}px`}
            onMouseDown={keepSelection}
            onClick={() => onFontSize(size)}
          >
            {size}
          </button>
        ))}
      </div>
      <ToolBtn
        onClick={() => onFontSizeStep(1)}
        title="글자 크게"
        onMouseDown={keepSelection}
      >
        <Plus className="collectFormatToolbarIcon" />
      </ToolBtn>
      <span className="collectFormatToolbarLabel">글자</span>
      {COLLECT_TEXT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          className="collectFormatSwatch"
          onMouseDown={keepSelection}
          onClick={() => onColor(c.color)}
          style={{ background: c.color }}
        />
      ))}
      <span className="collectFormatToolbarLabel">형광</span>
      {COLLECT_HIGHLIGHT_COLORS.map((c) => (
        <button
          key={`hl-${c.id}`}
          type="button"
          title={`${c.label} 형광`}
          className="collectFormatHighlight"
          onMouseDown={keepSelection}
          onClick={() => onHighlight(c.bg)}
          style={{ background: c.bg }}
        />
      ))}
      <div className="collectFormatToolbarSizes">
        <span>번호</span>
        {COLLECT_CIRCLED_NUMBERS.map((ch) => (
          <button
            key={ch}
            type="button"
            title={`${ch} 삽입`}
            onMouseDown={keepSelection}
            onClick={() => onInsertChar(ch)}
          >
            {ch}
          </button>
        ))}
      </div>
      <ToolBtn onClick={onImage} title="이미지 추가">
        <ImagePlus className="collectFormatToolbarIcon" />
      </ToolBtn>
      <ToolBtn onClick={onPasteImage} title="클립보드에서 붙여넣기 (아이폰)">
        <ClipboardPaste className="collectFormatToolbarIcon" />
        <span>붙여넣기</span>
      </ToolBtn>
      <ToolBtn onClick={onTextImage} title="텍스트를 이미지로">
        <Type className="collectFormatToolbarIcon" />
        <span>텍스트→이미지</span>
      </ToolBtn>
      <ToolBtn onClick={onHandwriting} title="손글씨">
        <PenLine className="collectFormatToolbarIcon" />
        <span>손글씨</span>
      </ToolBtn>
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
      className="collectFormatToolBtn"
    >
      {children}
    </button>
  );
}
