"use client";

import React from "react";

/** A white writing box placed under the main editor. */
export function CollectWhiteCell({
  cellId,
  initialHtml,
  placeholder,
  onInput,
  onRemove,
  imageDeleteOnly = false,
}: {
  cellId: string;
  initialHtml: string;
  placeholder: string;
  onInput: () => void;
  onRemove: () => void;
  /** 일기장: 이미지를 선택했을 때만 ×를 보여주고, 그 이미지만 지웁니다. */
  imageDeleteOnly?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const selectedMediaRef = React.useRef<Element | null>(null);
  const [photoSelected, setPhotoSelected] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = initialHtml || "";
  }, [initialHtml]);

  React.useEffect(() => {
    if (!photoSelected) return;
    const onPointerDown = (event: PointerEvent) => {
      const wrap = wrapRef.current;
      if (!wrap || !(event.target instanceof Node) || wrap.contains(event.target)) return;
      setPhotoSelected(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [photoSelected]);

  const selectPhoto = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".collect-white-cell-del")) return;
    const wrap = wrapRef.current;
    wrap?.querySelectorAll("img.is-photo-selected, video.is-photo-selected").forEach((node) => {
      node.classList.remove("is-photo-selected");
    });
    const media = target?.closest("img, video") ?? null;
    const inside = Boolean(media && wrap?.contains(media));
    if (inside && media) media.classList.add("is-photo-selected");
    selectedMediaRef.current = inside ? media : null;
    setPhotoSelected(inside);
  };

  const removeSelectedImage = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const wrap = wrapRef.current;
    const media = selectedMediaRef.current;
    if (!media || !wrap?.contains(media)) return;
    if (!window.confirm("선택한 이미지를 삭제할까요?")) return;
    const block = media.closest(".rich-inline-img-wrap, .generalInfoInlineImageBlock");
    if (block && wrap.contains(block) && block !== wrap) block.remove();
    else media.remove();
    selectedMediaRef.current = null;
    setPhotoSelected(false);
    onInput();
  };

  return (
    <div
      ref={wrapRef}
      className={`collect-white-cell-wrap${photoSelected ? " is-photo-selected" : ""}${imageDeleteOnly ? " is-image-delete" : ""}`}
      data-white-id={cellId}
      onClick={selectPhoto}
    >
      <button
        type="button"
        className="collect-white-cell-del"
        aria-label={imageDeleteOnly ? "이미지 삭제" : "칸 지우기"}
        title={imageDeleteOnly ? "이미지 삭제" : "칸 삭제"}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={imageDeleteOnly ? removeSelectedImage : onRemove}
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
