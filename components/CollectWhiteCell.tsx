"use client";

import React from "react";

/** A white writing box placed under the main editor. */
export function CollectWhiteCell({
  cellId,
  initialHtml,
  placeholder,
  onInput,
  onRemove,
}: {
  cellId: string;
  initialHtml: string;
  placeholder: string;
  onInput: () => void;
  onRemove: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = initialHtml || "";
  }, [initialHtml]);

  return (
    <div className="collect-white-cell-wrap" data-white-id={cellId}>
      <button
        type="button"
        className="collect-white-cell-del"
        aria-label="칸 지우기"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
      >
        ×
      </button>
      <div
        ref={ref}
        className="generalInfoRichTextEditor collectPaperEditor collect-white-cell"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        tabIndex={0}
        data-placeholder={placeholder}
        onInput={onInput}
      />
    </div>
  );
}
