"use client";

import React from "react";
import { ClassTagSelect } from "./ClassTagSelect";
import { SlotImagePanel } from "./SlotImagePanel";
import { appendHashtagToEditor } from "../lib/contentClass";
import { PASTE_IMAGE_FAILED_MESSAGE, clipboardHasImages, pasteClipboardImages, readPastedClipboard } from "../lib/richPaste";
import { IMAGE_SLOT_GUIDE, enhanceRichInlineImages, findAwaitingSlotId, handleRichImageSlotPointer, insertImagesAtSlotOrCaret, tryConsumeDateTimeTrigger, tryConsumeImageTriggerToSlot } from "../lib/richImageSlots";

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
  onMove,
  canMoveDown = true,
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
  /** 칸을 위(-1)나 아래(1)로 옮긴다. 없으면 이동 버튼을 숨긴다. */
  onMove?: (direction: -1 | 1) => void;
  canMoveDown?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const selectedMediaRef = React.useRef<Element | null>(null);
  const [photoSelected, setPhotoSelected] = React.useState(false);
  const [imageSlotId, setImageSlotId] = React.useState<string | null>(null);

  const consumeImageTrigger = (notify: boolean) => {
    const stamped = tryConsumeDateTimeTrigger(ref.current);
    const slotId = tryConsumeImageTriggerToSlot(ref.current);
    if (slotId) setImageSlotId(slotId);
    else if (!findAwaitingSlotId(ref.current)) setImageSlotId(null);
    if (notify || slotId || stamped) onInput();
  };

  const insertPickedImages = async (files: File[], extraUrls: string[] = []) => {
    const editor = ref.current;
    if (!editor || (!files.length && !extraUrls.length)) return;
    let urls: string[] = [];
    if (!files.length) {
      urls = [];
    } else if (onUploadImages) {
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
    const ready = [...urls, ...extraUrls].filter(Boolean);
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

  // 칸을 위아래로 옮길 때 효과가 다시 실행되어 입력한 내용이 지워지지 않도록, 처음 값이 바뀐 때만 채운다.
  const appliedHtmlRef = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = initialHtml || "";
    if (appliedHtmlRef.current === html) return;
    appliedHtmlRef.current = html;
    el.innerHTML = html;
    enhanceRichInlineImages(el);
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
      {onMove ? (
        <div className="collect-white-cell-move">
          {([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              aria-label={direction === -1 ? "칸을 위로" : "칸을 아래로"}
              title={direction === -1 ? "칸을 위로" : "칸을 아래로"}
              disabled={direction === 1 && !canMoveDown}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => onMove(direction)}
            >
              {direction === -1 ? "↑" : "↓"}
            </button>
          ))}
        </div>
      ) : null}
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
          const clip = readPastedClipboard(event.clipboardData);
          // 서식 있는 내용(HTML)을 브라우저에 맡기면 아이폰에서 AI 앱 글이 깨질 수 있어 항상 글자만 넣는다.
          if (!clip.text && !clipboardHasImages(clip)) return;
          event.preventDefault();
          if (clip.text) document.execCommand("insertText", false, clip.text);
          onInput();
          pasteClipboardImages(
            ref.current,
            clip,
            (files, _slotId, urls) => insertPickedImages(files, urls),
            () => alert(PASTE_IMAGE_FAILED_MESSAGE),
          );
        }}
      />
      {imageSlotId ? (
        <SlotImagePanel onFiles={(files) => void insertPickedImages(files)} onClose={() => setImageSlotId(null)} />
      ) : null}
    </div>
  );
}
