/**
 * Inline image slot helpers — ported from insta-fact-library RichTextEditor.
 * Typing S / s / ㄴ at sentence end creates an S1… slot; paste or file fills it.
 */

export const INLINE_IMG_CLASS = "rich-inline-img";
export const INLINE_IMG_WRAP_CLASS = "rich-inline-img-wrap";
export const INLINE_IMG_DEL_CLASS = "rich-inline-img-del";
export const IMG_SLOT_CLASS = "rich-img-slot";

function ensureDeleteControl(wrap: HTMLElement, img: HTMLImageElement) {
  let del = wrap.querySelector(`:scope > .${INLINE_IMG_DEL_CLASS}`) as HTMLElement | null;
  if (!del) {
    del = document.createElement("span");
    del.className = INLINE_IMG_DEL_CLASS;
    wrap.appendChild(del);
  }
  const alt = img.getAttribute("alt") || "이미지";
  del.setAttribute("contenteditable", "false");
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", `${alt} 삭제`);
  del.textContent = "×";
}

/** Wrap a pasted/inline image so the editor can show a delete control. */
export function ensureInlineImageWrap(img: HTMLImageElement) {
  const parent = img.parentElement;
  if (parent?.classList.contains(INLINE_IMG_WRAP_CLASS)) {
    parent.setAttribute("contenteditable", "false");
    parent.classList.remove(IMG_SLOT_CLASS);
    ensureDeleteControl(parent, img);
    return parent;
  }
  if (parent?.classList.contains("generalInfoInlineImageBlock")) {
    return parent;
  }
  const wrap = document.createElement("span");
  wrap.className = INLINE_IMG_WRAP_CLASS;
  wrap.setAttribute("contenteditable", "false");
  img.replaceWith(wrap);
  wrap.appendChild(img);
  ensureDeleteControl(wrap, img);
  return wrap;
}

export function createInlineImage(src: string, alt: string, slotId?: string) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.className = `${INLINE_IMG_CLASS} generalInfoInlineImage`;
  img.setAttribute("contenteditable", "false");
  if (slotId) img.setAttribute("data-img-slot", slotId);
  return ensureInlineImageWrap(img);
}

export function nextSlotId(html: string) {
  const used = new Set<number>();
  const re = /data-img-slot=["']S(\d+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `S${n}`;
}

export function createImageSlotElement(id: string) {
  const slot = document.createElement("span");
  slot.setAttribute("data-img-slot", id);
  slot.setAttribute("contenteditable", "false");
  slot.className = IMG_SLOT_CLASS;
  slot.textContent = `${id} 이미지`;
  return slot;
}

/**
 * If caret just typed S/s/ㄴ at a sentence end, replace it with an image slot.
 * Returns the new slot id, or null if no trigger.
 */
export function tryConsumeImageTriggerToSlot(editor: HTMLElement | null): string | null {
  if (!editor) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  if (!editor.contains(node)) return null;

  const text = node.textContent || "";
  const offset = range.startOffset;
  if (offset < 1) return null;
  const ch = text[offset - 1];
  if (ch !== "S" && ch !== "s" && ch !== "ㄴ") return null;

  const before = text.slice(0, offset - 1);
  const after = text.slice(offset);
  const prev = before.slice(-1);
  const atSentenceEnd =
    before.length === 0 ||
    /[\s.。！？!?…」』”"）\]]/.test(prev) ||
    /[가-힣a-zA-Z0-9]$/.test(before);

  if (!atSentenceEnd) return null;
  if (/[a-zA-Z]/.test(prev) && (ch === "S" || ch === "s")) return null;

  node.textContent = before + after;
  const id = nextSlotId(editor.innerHTML);
  const slot = createImageSlotElement(id);

  const insertRange = document.createRange();
  insertRange.setStart(node, before.length);
  insertRange.collapse(true);
  insertRange.insertNode(slot);
  const spacer = document.createTextNode(after ? "" : " ");
  slot.after(spacer);
  const caret = document.createRange();
  caret.setStartAfter(spacer);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);

  return id;
}

/** Insert empty slot at caret (toolbar image button). */
export function insertEmptyImageSlot(editor: HTMLElement | null): string | null {
  if (!editor) return null;
  editor.focus();
  const id = nextSlotId(editor.innerHTML);
  const slot = createImageSlotElement(id);
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(slot);
    const after = document.createTextNode(" ");
    slot.after(after);
    range.setStartAfter(after);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(slot);
  }
  return id;
}

export function findAwaitingSlotId(editor: HTMLElement | null): string | null {
  if (!editor) return null;
  const slots = editor.querySelectorAll(`.${IMG_SLOT_CLASS}[data-img-slot]`);
  if (!slots.length) return null;
  return slots[slots.length - 1].getAttribute("data-img-slot");
}

/**
 * Fill awaiting slot with uploaded image URLs, or insert at caret.
 * Returns true if something was inserted.
 */
export function insertImagesAtSlotOrCaret(
  editor: HTMLElement | null,
  urls: Array<{ src: string; alt?: string }>,
  slotId?: string | null,
): boolean {
  if (!editor || !urls.length) return false;
  editor.focus();

  const awaitId = slotId || findAwaitingSlotId(editor);
  if (awaitId) {
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(awaitId)
        : awaitId.replace(/"/g, '\\"');
    const slot = editor.querySelector(
      `.${IMG_SLOT_CLASS}[data-img-slot="${escaped}"]`,
    );
    if (slot) {
      const wrap = createInlineImage(urls[0].src, urls[0].alt || awaitId, awaitId);
      slot.replaceWith(wrap);
      let last: HTMLElement = wrap;
      for (let i = 1; i < urls.length; i += 1) {
        const extra = createInlineImage(
          urls[i].src,
          urls[i].alt || `S${awaitId.replace(/\D/g, "") || "1"}-${i + 1}`,
        );
        last.after(extra);
        last = extra;
      }
      return true;
    }
  }

  const sel = window.getSelection();
  for (const item of urls) {
    const wrap = createInlineImage(item.src, item.alt || "이미지");
    if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(wrap);
      range.setStartAfter(wrap);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(wrap);
    }
  }
  return true;
}

/** Handle click on x (image wrap) or empty slot. Returns true if handled. */
export function handleRichImageSlotPointer(
  editor: HTMLElement | null,
  target: EventTarget | null,
  options?: { confirmSlot?: boolean; confirmImage?: boolean },
): boolean {
  if (!editor || !(target instanceof Element)) return false;

  const del = target.closest(`.${INLINE_IMG_DEL_CLASS}`) as HTMLElement | null;
  if (del && editor.contains(del)) {
    const wrap = del.closest(`.${INLINE_IMG_WRAP_CLASS}`) as HTMLElement | null;
    if (!wrap) return false;
    const img = wrap.querySelector("img");
    const alt = img?.getAttribute("alt") || "이미지";
    if (options?.confirmImage !== false) {
      if (!window.confirm(`${alt}을(를) 지울까요?`)) return true;
    }
    wrap.remove();
    return true;
  }

  const slot = target.closest(`.${IMG_SLOT_CLASS}`) as HTMLElement | null;
  if (slot && editor.contains(slot) && !slot.classList.contains(INLINE_IMG_WRAP_CLASS)) {
    const id = slot.getAttribute("data-img-slot") || "이미지 칸";
    if (options?.confirmSlot !== false) {
      if (!window.confirm(`${id} 칸을 지울까요?`)) return true;
    }
    slot.remove();
    return true;
  }

  return false;
}

/** Ensure rich wraps have delete controls. */
export function enhanceRichInlineImages(editor: HTMLElement | null) {
  if (!editor) return;
  editor.querySelectorAll(`img.${INLINE_IMG_CLASS}, img.generalInfoInlineImage`).forEach((node) => {
    const img = node as HTMLImageElement;
    if (!editor.contains(img)) return;
    if (img.closest(".generalInfoInlineImageBlock")) return;
    img.classList.add(INLINE_IMG_CLASS, "generalInfoInlineImage");
    img.setAttribute("contenteditable", "false");
    ensureInlineImageWrap(img);
  });
  editor.querySelectorAll(`.${IMG_SLOT_CLASS}[data-img-slot]`).forEach((slot) => {
    (slot as HTMLElement).setAttribute("contenteditable", "false");
  });
}
