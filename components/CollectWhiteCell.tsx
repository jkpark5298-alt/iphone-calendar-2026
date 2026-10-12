"use client";

import React from "react";
import { ClassTagSelect } from "./ClassTagSelect";
import { SlotImagePanel } from "./SlotImagePanel";
import { appendHashtagToEditor } from "../lib/contentClass";
import { imageFilesFromClipboard } from "../lib/compressImageFile";
import { IMAGE_SLOT_GUIDE, enhanceRichInlineImages, findAwaitingSlotId, handleRichImageSlotPointer, insertImagesAtSlotOrCaret, tryConsumeImageTriggerToSlot } from "../lib/richImageSlots";

/** A white writing box placed under the main editor. */
export function CollectWhiteCell({
  cellId,
  initialHtml,
  placeholder,
  onInput,
  onRemove,
  imageDeleteOnly = false,
  showClassTag = false,
  onUploadImages,
}: {
  cellId: string;
  initialHtml: string;
  placeholder: string;
  onInput: () => void;
  onRemove: () => void;
  /** 일기장: 이미지를 선택했을 때만 ×를 보여주고, 그 이미지만 지웁니다. */
  imageDeleteOnly?: boolean;
  /** 칸마다 분류를 고르면 본문에 #태그를 붙입니다. */
  showClassTag?: boolean;
  /** S. 또는 s. 로 연 사진 칸에 넣을 주소. 없으면 data URL로 넣습니다. */
  onUploadImages?: (files: File[]) => Promise<string[]>;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const selectedMediaRef = React.useRef<Element | null>(null);
  const [photoSelected, setPhotoSelected] = React.useState(false);
  const [imageSlotId, setImageSlotId] = React.useState<string | null>(null);

  const consumeImageTrigger = (notify: boolean) => {
    const slotId = tryConsumeImageTriggerToSlot(ref.current);
    if (slotId) setImageSlotId(slotId);
    else if (!findAwaitingSlotId(ref.current)) setImageSlotId(null);
    if (notify || slotId) onInput();
  };

  const insertPickedImages = async (files: File[]) => {
    const editor = ref.current;
    if (!editor || !files.length) return;
    let urls: string[] = [];
    if (onUploadImages) {
      urls = await onUploadImages(files);
    } else {
      urls = await Promise.all(
        files.map(
          (file) =>
            new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => resolve("");
              reader.readAsDataURL(file);
            }),
        ),
      );
    }
    const ready = urls.filter(Boolean);
    if (!ready.length) return;
    editor.focus();
    enhanceRichInlineImages(editor);
    const slotId = findAwaitingSlotId(editor);
    if (!slotId) {
      setImageSlotId(null);
      alert(IMAGE_SLOT_GUIDE);
      return;
    }
    if (insertImagesAtSlotOrCaret(editor, ready.map((src) => ({ src })), slotId)) {
      enhanceRichInlineImages(editor);
      onInput();
    }
    setImageSlotId(null);
  };

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
      {showClassTag && (
        <ClassTagSelect
          onSelect={(label) => {
            const editor = ref.current;
            if (!editor) return;
            appendHashtagToEditor(editor, label);
            onInput();
          }}
        />
      )}
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
        spellCheck={false}
        role="textbox"
        tabIndex={0}
        data-placeholder={placeholder}
        onClick={(event) => {
          if (handleRichImageSlotPointer(ref.current, event.target)) {
            event.preventDefault();
            if (!findAwaitingSlotId(ref.current)) setImageSlotId(null);
            onInput();
          }
        }}
        onInput={() => consumeImageTrigger(true)}
        onKeyUp={() => consumeImageTrigger(false)}
        onPaste={(event) => {
          const files = imageFilesFromClipboard(event.clipboardData);
          if (!files.length) return;
          event.preventDefault();
          if (!findAwaitingSlotId(ref.current)) {
            alert(IMAGE_SLOT_GUIDE);
            return;
          }
          void insertPickedImages(files);
        }}
      />
      {imageSlotId ? (
        <SlotImagePanel onFiles={(files) => void insertPickedImages(files)} onClose={() => setImageSlotId(null)} />
      ) : null}
    </div>
  );
}
