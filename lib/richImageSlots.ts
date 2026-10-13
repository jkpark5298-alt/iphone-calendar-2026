/**
 * Inline image slot helpers.
 * Typing S. or s. creates one photo slot.
 * Photos enter that slot from the camera, the album, or a paste.
 */

export const INLINE_IMG_CLASS = "rich-inline-img";
export const INLINE_IMG_WRAP_CLASS = "rich-inline-img-wrap";
export const INLINE_IMG_DEL_CLASS = "rich-inline-img-del";
export const INLINE_IMG_RESIZE_CLASS = "rich-inline-img-resize";
export const IMG_SLOT_CLASS = "rich-img-slot";
export const INLINE_IMG_WIDTH_VAR = "--inline-img-width";
export const MIN_INLINE_IMG_WIDTH = 80;

const INLINE_IMG_FRAME_SELECTOR = `.${INLINE_IMG_WRAP_CLASS}, .generalInfoInlineImageBlock`;

export function clampInlineImageWidth(width: number, maxWidth: number) {
  const max = Math.max(MIN_INLINE_IMG_WIDTH, Math.floor(maxWidth));
  return Math.min(max, Math.max(MIN_INLINE_IMG_WIDTH, Math.round(width)));
}

function editorContentWidth(editor: HTMLElement) {
  const style = getComputedStyle(editor);
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.max(MIN_INLINE_IMG_WIDTH, editor.clientWidth - pad);
}

/** Remember the on-screen width. The image file itself is not recompressed. */
export function applyInlineImageDisplayWidth(frame: HTMLElement, widthPx: number) {
  frame.dataset.resized = "1";
  frame.style.setProperty(INLINE_IMG_WIDTH_VAR, `${Math.round(widthPx)}px`);
}

function ensureResizeControl(frame: HTMLElement) {
  let handle = frame.querySelector(`:scope > .${INLINE_IMG_RESIZE_CLASS}`) as HTMLElement | null;
  if (!handle) {
    handle = document.createElement("span");
    handle.className = INLINE_IMG_RESIZE_CLASS;
    frame.appendChild(handle);
  }
  handle.setAttribute("contenteditable", "false");
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "이미지 크기 조절");
  handle.title = "모서리를 끌어 크기를 조절합니다";
}

function bindInlineImageResize(editor: HTMLElement) {
  const flagged = editor as HTMLElement & { __inlineImageResizeBound?: boolean };
  if (flagged.__inlineImageResizeBound) return;
  flagged.__inlineImageResizeBound = true;

  let drag: {
    pointerId: number;
    frame: HTMLElement;
    startX: number;
    startWidth: number;
    maxWidth: number;
  } | null = null;

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const next = drag.startWidth + (event.clientX - drag.startX);
    applyInlineImageDisplayWidth(drag.frame, clampInlineImageWidth(next, drag.maxWidth));
  };

  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.frame.classList.remove("is-resizing");
    drag = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  editor.addEventListener(
    "pointerdown",
    (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const handle = target?.closest(`.${INLINE_IMG_RESIZE_CLASS}`) as HTMLElement | null;
      if (!handle || !editor.contains(handle) || drag) return;
      const frame = handle.closest(INLINE_IMG_FRAME_SELECTOR) as HTMLElement | null;
      const img = frame?.querySelector("img");
      if (!frame || !img) return;
      event.preventDefault();
      event.stopPropagation();
      frame.classList.add("is-image-selected", "is-resizing");
      drag = {
        pointerId: event.pointerId,
        frame,
        startX: event.clientX,
        startWidth: frame.getBoundingClientRect().width,
        maxWidth: editorContentWidth(editor),
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    true,
  );

  editor.addEventListener(
    "click",
    (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(`.${INLINE_IMG_RESIZE_CLASS}`) || !editor.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}

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
    ensureResizeControl(parent);
    return parent;
  }
  if (parent?.classList.contains("generalInfoInlineImageBlock")) {
    parent.setAttribute("contenteditable", "false");
    ensureResizeControl(parent);
    return parent;
  }
  const wrap = document.createElement("span");
  wrap.className = INLINE_IMG_WRAP_CLASS;
  wrap.setAttribute("contenteditable", "false");
  img.replaceWith(wrap);
  wrap.appendChild(img);
  ensureDeleteControl(wrap, img);
  ensureResizeControl(wrap);
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

const SLOT_DEL_CLASS = "rich-img-slot-del";

/** Empty image cell. The internal id stays on the element; the card does not show "S1". */
export function paintEmptyImageSlot(slot: HTMLElement, id?: string) {
  const slotId = id || slot.getAttribute("data-img-slot") || "S1";
  slot.setAttribute("data-img-slot", slotId);
  slot.setAttribute("contenteditable", "false");
  slot.setAttribute("aria-label", "사진 칸");
  slot.classList.add(IMG_SLOT_CLASS);
  slot.replaceChildren();

  const hint = document.createElement("span");
  hint.className = "rich-img-slot-hint";
  hint.textContent = "이 칸에 사진 넣기";

  const del = document.createElement("span");
  del.className = SLOT_DEL_CLASS;
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", "사진 칸 지우기");
  del.textContent = "×";

  slot.append(hint, del);
}

export function createImageSlotElement(id: string) {
  const slot = document.createElement("span");
  paintEmptyImageSlot(slot, id);
  return slot;
}

/** S. 또는 s. 한 묶음이 사진 칸 하나 */
const IMAGE_TRIGGER_AT_CARET = /(?:^|[^A-Za-z])([Ss]\.)$/;

/** data. 한 묶음이 그 순간의 년월일시분 */
const DATE_TRIGGER_AT_CARET = /(?:^|[^A-Za-z])(data\.)$/i;
const DATE_STAMP_CLASS = "body-datetime";
const DATE_STAMP_COLOR = "#eab308";

export function formatSystemDateTime(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 커서 앞이 data. 이면 그 글자를 지우고, 그 순간의 년.월.일 시:분을 노란 글씨로 넣습니다.
 */
export function tryConsumeDateTimeTrigger(editor: HTMLElement | null): boolean {
  if (!editor) return false;
  const sel = window.getSelection();
  const located = caretText(editor);
  if (!sel || !located) return false;

  const text = located.node.textContent || "";
  const offset = Math.min(located.offset, text.length);
  const before = text.slice(0, offset);
  const match = before.match(DATE_TRIGGER_AT_CARET);
  if (!match) return false;

  const consumed = match[1];
  const start = before.length - consumed.length;
  located.node.textContent = `${text.slice(0, start)}${text.slice(offset)}`;

  const stamp = document.createElement("span");
  stamp.className = DATE_STAMP_CLASS;
  stamp.style.color = DATE_STAMP_COLOR;
  stamp.textContent = formatSystemDateTime();

  const range = document.createRange();
  range.setStart(located.node, Math.min(start, (located.node.textContent || "").length));
  range.collapse(true);
  range.insertNode(stamp);
  const spacer = document.createTextNode(" ");
  stamp.after(spacer);

  const caret = document.createRange();
  caret.setStart(spacer, spacer.length);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
  return true;
}

export const IMAGE_SLOT_GUIDE = "본문에 S. 또는 s. 를 입력하면 사진 칸이 생깁니다. 그 칸에서 사진찍기, 사진첩 또는 붙여넣기로 넣으세요.";

function caretText(editor: HTMLElement): { node: Text; offset: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    return { node: range.startContainer as Text, offset: range.startOffset };
  }

  if (range.startContainer.nodeType !== Node.ELEMENT_NODE) return null;
  const el = range.startContainer as HTMLElement;
  const previous = el.childNodes[range.startOffset - 1] || null;
  if (previous?.nodeType === Node.TEXT_NODE) {
    const text = previous as Text;
    return { node: text, offset: (text.textContent || "").length };
  }
  const next = el.childNodes[range.startOffset] || null;
  if (next?.nodeType === Node.TEXT_NODE) {
    return { node: next as Text, offset: 0 };
  }
  return null;
}

/**
 * Caret 앞이 S. 또는 s. 이면 그 글자를 사진 칸 하나로 바꿉니다.
 * 한 번에 S.s. 를 붙이면 칸이 두 개 생깁니다.
 */
export function tryConsumeImageTriggerToSlot(editor: HTMLElement | null): string | null {
  if (!editor) return null;
  const sel = window.getSelection();
  const located = caretText(editor);
  if (!sel || !located) return null;

  let text = located.node.textContent || "";
  let offset = Math.min(located.offset, text.length);
  const ids: string[] = [];
  const used = new Set<string>();
  editor.querySelectorAll("[data-img-slot]").forEach((node) => {
    const id = node.getAttribute("data-img-slot");
    if (id) used.add(id);
  });
  const allocSlotId = () => {
    let n = 1;
    while (used.has(`S${n}`)) n += 1;
    const id = `S${n}`;
    used.add(id);
    return id;
  };

  for (let guard = 0; guard < 8; guard += 1) {
    const before = text.slice(0, offset);
    const match = before.match(IMAGE_TRIGGER_AT_CARET);
    if (!match) break;
    const consumed = match[1];
    const start = before.length - consumed.length;
    text = `${text.slice(0, start)}${text.slice(offset)}`;
    offset = start;
    ids.push(allocSlotId());
  }

  if (!ids.length) return null;
  ids.reverse();
  located.node.textContent = text;

  let anchor: Node = located.node;
  let anchorOffset = Math.min(offset, (located.node.textContent || "").length);
  ids.forEach((id) => {
    const slot = createImageSlotElement(id);
    const insertRange = document.createRange();
    insertRange.setStart(anchor, anchorOffset);
    insertRange.collapse(true);
    insertRange.insertNode(slot);
    const spacer = document.createTextNode(" ");
    slot.after(spacer);
    anchor = spacer;
    anchorOffset = spacer.length;
  });

  const caret = document.createRange();
  caret.setStart(anchor, anchorOffset);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);

  const lastId = ids[ids.length - 1];
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(lastId)
      : lastId.replace(/"/g, '\\"');
  editor.querySelector(`[data-img-slot="${escaped}"]`)?.scrollIntoView({ block: "nearest" });
  return lastId;
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
      const fragment = document.createDocumentFragment();
      urls.forEach((item, index) => {
        fragment.appendChild(
          createInlineImage(
            item.src,
            item.alt || (index === 0 ? awaitId : `${awaitId}-${index + 1}`),
            index === 0 ? awaitId : undefined,
          ),
        );
      });
      slot.replaceWith(fragment);
      return true;
    }
    if (slotId) return false;
  }

  const fragment = document.createDocumentFragment();
  urls.forEach((item) => {
    fragment.appendChild(createInlineImage(item.src, item.alt || "이미지"));
  });
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(fragment);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(fragment);
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

  const slotDel = target.closest(`.${SLOT_DEL_CLASS}`) as HTMLElement | null;
  if (slotDel && editor.contains(slotDel)) {
    const slot = slotDel.closest(`.${IMG_SLOT_CLASS}`) as HTMLElement | null;
    if (!slot) return false;
    if (options?.confirmSlot !== false) {
      if (!window.confirm("이 사진 칸을 지울까요?")) return true;
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
  editor.querySelectorAll(`.${IMG_SLOT_CLASS}[data-img-slot]`).forEach((node) => {
    const slot = node as HTMLElement;
    slot.setAttribute("contenteditable", "false");
    if (slot.classList.contains(INLINE_IMG_WRAP_CLASS)) return;
    if (slot.querySelector("img")) return;
    paintEmptyImageSlot(slot);
  });
  editor.querySelectorAll(".generalInfoInlineImageBlock").forEach((node) => {
    const frame = node as HTMLElement;
    if (!frame.querySelector("img")) return;
    frame.setAttribute("contenteditable", "false");
    ensureResizeControl(frame);
  });
  bindInlineImageResize(editor);
}
