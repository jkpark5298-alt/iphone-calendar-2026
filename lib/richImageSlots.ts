/**
 * Inline image slot helpers.
 * Typing S. or s. creates one photo slot.
 * Photos enter that slot from the camera, the album, or a paste.
 */

export const INLINE_IMG_CLASS = "rich-inline-img";
export const INLINE_IMG_WRAP_CLASS = "rich-inline-img-wrap";
export const INLINE_IMG_DEL_CLASS = "rich-inline-img-del";
export const INLINE_IMG_RESIZE_CLASS = "rich-inline-img-resize";
export const INLINE_IMG_ROW_CLASS = "rich-inline-img-row";
/** 사진을 탭하면 나오는 작은 버튼 묶음 ([크기 조절] [2열로]) */
export const INLINE_IMG_TOOLS_CLASS = "rich-inline-img-tools";
const INLINE_IMG_TOOL_CLASS = "rich-inline-img-tool";
/** 이 표시가 붙은 사진만 크기 조절 손잡이가 보이고 움직인다 */
export const INLINE_IMG_RESIZE_MODE_CLASS = "is-resize-mode";
const INLINE_IMG_SELECTED_CLASS = "is-image-selected";
export const IMG_SLOT_CLASS = "rich-img-slot";
export const INLINE_IMG_WIDTH_VAR = "--inline-img-width";
export const INLINE_IMG_HEIGHT_VAR = "--inline-img-height";
export const MIN_INLINE_IMG_WIDTH = 80;
export const MIN_INLINE_IMG_HEIGHT = 80;
const MAX_INLINE_IMG_HEIGHT = 2400;
const INLINE_IMG_ROW_GAP = 8;

const INLINE_IMG_FRAME_SELECTOR = `.${INLINE_IMG_WRAP_CLASS}, .generalInfoInlineImageBlock`;

export function clampInlineImageWidth(width: number, maxWidth: number) {
  const max = Math.max(MIN_INLINE_IMG_WIDTH, Math.floor(maxWidth));
  return Math.min(max, Math.max(MIN_INLINE_IMG_WIDTH, Math.round(width)));
}

export function clampInlineImageHeight(height: number) {
  return Math.min(MAX_INLINE_IMG_HEIGHT, Math.max(MIN_INLINE_IMG_HEIGHT, Math.round(height)));
}

function editorContentWidth(editor: HTMLElement) {
  const style = getComputedStyle(editor);
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.max(MIN_INLINE_IMG_WIDTH, editor.clientWidth - pad);
}

function frameInImageRow(frame: HTMLElement) {
  return frame.closest(`.${INLINE_IMG_ROW_CLASS}`) as HTMLElement | null;
}

/** In a 2-col row, width follows the cell; only height is freely resized. */
function frameMaxResizeWidth(editor: HTMLElement, frame: HTMLElement) {
  const row = frameInImageRow(frame);
  if (!row) return editorContentWidth(editor);
  const rowWidth = Math.max(MIN_INLINE_IMG_WIDTH, row.clientWidth || editorContentWidth(editor));
  return Math.max(MIN_INLINE_IMG_WIDTH, Math.floor((rowWidth - INLINE_IMG_ROW_GAP) / 2));
}

type ResizeAxis = "x" | "y" | "both";

/** Remember the on-screen size. The image file itself is not recompressed. */
export function applyInlineImageDisplaySize(frame: HTMLElement, widthPx: number, heightPx: number) {
  const height = Math.round(heightPx);
  const inRow = Boolean(frameInImageRow(frame));
  const width = Math.round(widthPx);
  frame.dataset.resized = "1";
  frame.dataset.height = "1";
  frame.style.setProperty(INLINE_IMG_HEIGHT_VAR, `${height}px`);
  frame.style.setProperty("height", `${height}px`, "important");
  frame.style.setProperty("max-width", "100%", "important");
  frame.style.setProperty("box-sizing", "border-box", "important");
  if (inRow) {
    // Stay inside the 2-col cell; do not pin a pixel width that breaks the grid.
    frame.style.removeProperty(INLINE_IMG_WIDTH_VAR);
    frame.style.setProperty("display", "block", "important");
    frame.style.setProperty("width", "100%", "important");
  } else {
    frame.style.setProperty(INLINE_IMG_WIDTH_VAR, `${width}px`);
    frame.style.setProperty("display", "inline-block", "important");
    frame.style.setProperty("width", `${width}px`, "important");
  }
  const img = frame.querySelector("img");
  if (img instanceof HTMLElement) {
    img.style.setProperty("width", "100%", "important");
    img.style.setProperty("height", "100%", "important");
    img.style.setProperty("max-width", "100%", "important");
    img.style.setProperty("max-height", "none", "important");
    img.style.setProperty("object-fit", inRow ? "cover" : "fill", "important");
    img.setAttribute("draggable", "false");
  }
}

/** 직접 바꾼 크기를 지운다 (2열로 묶거나 풀 때 칸에 맞게 다시 그리기 위해). */
export function clearInlineImageDisplaySize(frame: HTMLElement) {
  delete frame.dataset.resized;
  delete frame.dataset.height;
  for (const prop of [INLINE_IMG_WIDTH_VAR, INLINE_IMG_HEIGHT_VAR, "width", "height", "display", "max-width", "box-sizing"]) {
    frame.style.removeProperty(prop);
  }
  if (!frame.getAttribute("style")) frame.removeAttribute("style");
  const img = frame.querySelector("img");
  if (img instanceof HTMLElement) {
    for (const prop of ["width", "height", "max-width", "max-height", "object-fit"]) img.style.removeProperty(prop);
    if (!img.getAttribute("style")) img.removeAttribute("style");
  }
}

/** Re-apply saved CSS vars after HTML reload (width:100% editor rules otherwise win). */
function restoreInlineImageDisplaySize(frame: HTMLElement) {
  if (frame.dataset.resized !== "1") return;
  const width = parseFloat(frame.style.getPropertyValue(INLINE_IMG_WIDTH_VAR));
  const height = parseFloat(frame.style.getPropertyValue(INLINE_IMG_HEIGHT_VAR));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  applyInlineImageDisplaySize(frame, width, height);
}

const RESIZE_HANDLE_COPY: Record<ResizeAxis, { label: string; title: string }> = {
  x: { label: "가로 크기 조절", title: "오른쪽 선을 좌우로 끌어 가로를 조절합니다" },
  y: { label: "세로 크기 조절", title: "아래 선을 상하로 끌어 세로를 조절합니다" },
  both: { label: "이미지 크기 조절", title: "모서리 선을 끌어 가로와 세로를 함께 조절합니다" },
};

function paintResizeHandle(frame: HTMLElement, axis: ResizeAxis) {
  let handle = frame.querySelector(`:scope > .${INLINE_IMG_RESIZE_CLASS}[data-axis="${axis}"]`) as HTMLElement | null;
  if (!handle) {
    handle = document.createElement("span");
    handle.className = INLINE_IMG_RESIZE_CLASS;
    handle.dataset.axis = axis;
    frame.appendChild(handle);
  }
  const copy = RESIZE_HANDLE_COPY[axis];
  handle.setAttribute("contenteditable", "false");
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", copy.label);
  handle.title = copy.title;
}

function ensureResizeControl(frame: HTMLElement) {
  frame.querySelectorAll(`:scope > .${INLINE_IMG_RESIZE_CLASS}`).forEach((node) => {
    const axis = (node as HTMLElement).dataset.axis;
    if (axis !== "x" && axis !== "y" && axis !== "both") node.remove();
  });
  paintResizeHandle(frame, "x");
  paintResizeHandle(frame, "y");
  paintResizeHandle(frame, "both");
}

function refreshImageTools(frame: HTMLElement) {
  const tools = frame.querySelector(`:scope > .${INLINE_IMG_TOOLS_CLASS}`);
  if (!tools) return;
  const resize = tools.querySelector('[data-act="resize"]');
  const pair = tools.querySelector('[data-act="pair"]');
  const resizing = frame.classList.contains(INLINE_IMG_RESIZE_MODE_CLASS);
  if (resize) resize.textContent = resizing ? "완료" : "크기 조절";
  if (pair) pair.textContent = frameInImageRow(frame) ? "1열로" : "2열로";
}

function ensureImageTools(frame: HTMLElement) {
  let tools = frame.querySelector(`:scope > .${INLINE_IMG_TOOLS_CLASS}`) as HTMLElement | null;
  if (!tools) {
    tools = document.createElement("span");
    tools.className = INLINE_IMG_TOOLS_CLASS;
    for (const act of ["resize", "pair"]) {
      const button = document.createElement("span");
      button.className = INLINE_IMG_TOOL_CLASS;
      button.dataset.act = act;
      button.setAttribute("role", "button");
      tools.appendChild(button);
    }
    frame.appendChild(tools);
  }
  tools.setAttribute("contenteditable", "false");
  refreshImageTools(frame);
}

/** 저장할 HTML에서 화면 전용 표시(버튼 묶음, 선택·조절 중 표시)를 뺀다. */
export function stripTransientImageUiHtml(html: string) {
  if (!html) return html;
  return html
    .replace(
      /<span class="rich-inline-img-tools"[^>]*>(?:<span[^>]*>[^<]*<\/span>)*<\/span>/g,
      "",
    )
    .replace(/ ?\b(?:is-image-selected|is-resize-mode|is-resizing)\b/g, "");
}

function resizeHandleAtPoint(editor: HTMLElement, x: number, y: number) {
  // 「크기 조절」을 누른 사진의 손잡이만 본다. (예전에는 모든 사진의 손잡이가 항상 켜져 있어서
  //  아이폰에서 스크롤하거나 사진 근처를 누르기만 해도 크기가 바뀌었다.)
  const handles = Array.from(
    editor.querySelectorAll(`.${INLINE_IMG_RESIZE_MODE_CLASS} > .${INLINE_IMG_RESIZE_CLASS}`),
  ).reverse();
  for (const node of handles) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue; // 숨겨진 손잡이
    const slop = 12;
    if (
      x >= rect.left - slop &&
      x <= rect.right + slop &&
      y >= rect.top - slop &&
      y <= rect.bottom + slop
    ) {
      return node as HTMLElement;
    }
  }
  return null;
}

function resizeAxisOf(handle: HTMLElement): ResizeAxis {
  const axis = handle.dataset.axis;
  if (axis === "x" || axis === "y") return axis;
  return "both";
}

function bindInlineImageResize(editor: HTMLElement) {
  type ResizeBoundEditor = HTMLElement & {
    __inlineImageResizeAbort?: AbortController;
  };
  const flagged = editor as ResizeBoundEditor;
  flagged.__inlineImageResizeAbort?.abort();
  const abort = new AbortController();
  flagged.__inlineImageResizeAbort = abort;
  const { signal } = abort;

  let drag: {
    kind: "pointer" | "touch";
    pointerId: number;
    frame: HTMLElement;
    axis: ResizeAxis;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    maxWidth: number;
  } | null = null;

  const applyDrag = (clientX: number, clientY: number) => {
    if (!drag) return;
    const nextWidth = drag.axis === "y" ? drag.startWidth : drag.startWidth + (clientX - drag.startX);
    const nextHeight = drag.axis === "x" ? drag.startHeight : drag.startHeight + (clientY - drag.startY);
    applyInlineImageDisplaySize(
      drag.frame,
      clampInlineImageWidth(nextWidth, drag.maxWidth),
      clampInlineImageHeight(nextHeight),
    );
  };

  const endDrag = (commit: boolean) => {
    if (!drag) return;
    const frame = drag.frame;
    drag = null;
    frame.classList.remove("is-resizing");
    if (commit) editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const beginDrag = (
    handle: HTMLElement,
    kind: "pointer" | "touch",
    pointerId: number,
    clientX: number,
    clientY: number,
  ) => {
    const frame = handle.closest(INLINE_IMG_FRAME_SELECTOR) as HTMLElement | null;
    const img = frame?.querySelector("img");
    if (!frame || !img) return false;
    if (drag) endDrag(false);
    frame.classList.add("is-image-selected", "is-resizing");
    const rect = frame.getBoundingClientRect();
    drag = {
      kind,
      pointerId,
      frame,
      axis: resizeAxisOf(handle),
      startX: clientX,
      startY: clientY,
      startWidth: Math.max(rect.width, MIN_INLINE_IMG_WIDTH),
      startHeight: Math.max(rect.height, MIN_INLINE_IMG_HEIGHT),
      maxWidth: frameMaxResizeWidth(editor, frame),
    };
    return true;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.kind !== "pointer" || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    applyDrag(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || drag.kind !== "pointer" || event.pointerId !== drag.pointerId) return;
    endDrag(true);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!drag || drag.kind !== "touch") return;
    const touch = Array.from(event.touches).find((item) => item.identifier === drag?.pointerId);
    if (!touch) return;
    event.preventDefault();
    applyDrag(touch.clientX, touch.clientY);
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (!drag || drag.kind !== "touch") return;
    const ended = Array.from(event.changedTouches).some((item) => item.identifier === drag?.pointerId);
    if (!ended) return;
    endDrag(true);
  };

  rememberEditorCaret(editor, signal);

  // Window/document listeners stay for the editor lifetime; abort removes them on rebind.
  window.addEventListener("pointermove", onPointerMove, { passive: false, signal });
  window.addEventListener("pointerup", onPointerUp, { signal });
  window.addEventListener("pointercancel", onPointerUp, { signal });
  document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false, signal });
  document.addEventListener("touchend", onTouchEnd, { capture: true, signal });
  document.addEventListener("touchcancel", onTouchEnd, { capture: true, signal });
  window.addEventListener("blur", () => endDrag(false), { signal });

  editor.addEventListener(
    "touchstart",
    (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const handle = resizeHandleAtPoint(editor, touch.clientX, touch.clientY);
      if (!handle || !editor.contains(handle)) return;
      if (!beginDrag(handle, "touch", touch.identifier, touch.clientX, touch.clientY)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, passive: false, signal },
  );

  editor.addEventListener(
    "pointerdown",
    (event: PointerEvent) => {
      // iOS contentEditable: prefer the touchstart path to avoid double-drags.
      if (event.pointerType === "touch") return;
      const handle = resizeHandleAtPoint(editor, event.clientX, event.clientY);
      if (!handle || !editor.contains(handle)) return;
      if (!beginDrag(handle, "pointer", event.pointerId, event.clientX, event.clientY)) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* capture is optional */
      }
    },
    { capture: true, signal },
  );

  editor.addEventListener(
    "lostpointercapture",
    (event: PointerEvent) => {
      if (!drag || drag.kind !== "pointer" || event.pointerId !== drag.pointerId) return;
      endDrag(true);
    },
    { capture: true, signal },
  );

  const exitResizeMode = (except?: HTMLElement | null) => {
    let changed = false;
    editor.querySelectorAll(`.${INLINE_IMG_RESIZE_MODE_CLASS}`).forEach((node) => {
      if (node === except) return;
      node.classList.remove(INLINE_IMG_RESIZE_MODE_CLASS);
      refreshImageTools(node as HTMLElement);
      changed = true;
    });
    return changed;
  };

  const selectFrame = (frame: HTMLElement) => {
    editor.querySelectorAll(`.${INLINE_IMG_SELECTED_CLASS}`).forEach((node) => {
      if (node !== frame) node.classList.remove(INLINE_IMG_SELECTED_CLASS);
    });
    frame.classList.add(INLINE_IMG_SELECTED_CLASS);
  };

  editor.addEventListener(
    "click",
    (event: MouseEvent) => {
      if (resizeHandleAtPoint(editor, event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const tool = target?.closest(`.${INLINE_IMG_TOOL_CLASS}`) as HTMLElement | null;
      if (tool && editor.contains(tool)) {
        event.preventDefault();
        event.stopPropagation();
        const frame = tool.closest(INLINE_IMG_FRAME_SELECTOR) as HTMLElement | null;
        if (!frame) return;
        if (tool.dataset.act === "resize") {
          const wasResizing = frame.classList.contains(INLINE_IMG_RESIZE_MODE_CLASS);
          exitResizeMode(frame);
          if (wasResizing) {
            frame.classList.remove(INLINE_IMG_RESIZE_MODE_CLASS);
            editor.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            // 처음 조절할 때는 지금 보이는 크기에서 시작한다 (손잡이가 사진 가장자리에 붙도록)
            const img = frame.querySelector("img");
            if (img && frame.dataset.resized !== "1" && !frameInImageRow(frame)) {
              const rect = img.getBoundingClientRect();
              applyInlineImageDisplaySize(frame, rect.width, rect.height);
            }
            frame.classList.add(INLINE_IMG_RESIZE_MODE_CLASS);
          }
          selectFrame(frame);
          refreshImageTools(frame);
        } else if (tool.dataset.act === "pair") {
          exitResizeMode();
          if (toggleImagePair(editor, frame)) editor.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      // 사진 밖(또는 다른 사진)을 누르면 크기 조절을 끝낸다
      const frame = target?.closest(INLINE_IMG_FRAME_SELECTOR) as HTMLElement | null;
      const activeFrame = frame && editor.contains(frame) && frame.querySelector("img") ? frame : null;
      if (exitResizeMode(activeFrame)) editor.dispatchEvent(new Event("input", { bubbles: true }));
      if (activeFrame) selectFrame(activeFrame);
    },
    { capture: true, signal },
  );

  // 편집 칸 밖을 누르면 선택과 크기 조절을 끝낸다
  document.addEventListener(
    "click",
    (event: MouseEvent) => {
      if (event.target instanceof Node && editor.contains(event.target)) return;
      const changed = exitResizeMode();
      editor.querySelectorAll(`.${INLINE_IMG_SELECTED_CLASS}`).forEach((node) => node.classList.remove(INLINE_IMG_SELECTED_CLASS));
      if (changed) editor.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { signal },
  );
}

function isImageFrame(node: Element | null): node is HTMLElement {
  return Boolean(node && node instanceof HTMLElement && node.matches(INLINE_IMG_FRAME_SELECTOR) && node.querySelector("img"));
}

/** a와 b 사이에 글자·다른 사진이 없으면 붙어 있는 사진으로 본다. */
function framesAreAdjacent(a: HTMLElement, b: HTMLElement) {
  const range = document.createRange();
  range.setStartAfter(a);
  range.setEndBefore(b);
  const between = range.cloneContents();
  if ((between.textContent || "").replace(/\u00a0/g, " ").trim()) return false;
  return !between.querySelector(`img, video, .${IMG_SLOT_CLASS}, .${INLINE_IMG_ROW_CLASS}`);
}

function removeIfBlank(node: HTMLElement | null, editor: HTMLElement) {
  if (!node || node === editor || !editor.contains(node)) return;
  if (node.querySelector("img, video")) return;
  if ((node.textContent || "").replace(/\u00a0/g, " ").trim()) return;
  node.remove();
}

/**
 * 「2열로」: 바로 앞이나 뒤의 사진과 나란히 놓는다.
 * 「1열로」: 나란히 놓인 두 장을 다시 한 줄에 한 장씩 놓는다.
 */
export function toggleImagePair(editor: HTMLElement, frame: HTMLElement): boolean {
  const row = frameInImageRow(frame);
  if (row) {
    const frames = Array.from(row.children).filter(isImageFrame);
    frames.forEach((item) => {
      clearInlineImageDisplaySize(item);
      row.before(item);
      refreshImageTools(item);
    });
    row.remove();
    return true;
  }

  const frames = Array.from(editor.querySelectorAll(INLINE_IMG_FRAME_SELECTOR)).filter(
    (node): node is HTMLElement => isImageFrame(node) && !frameInImageRow(node as HTMLElement),
  );
  const index = frames.indexOf(frame);
  const next = frames[index + 1];
  const prev = frames[index - 1];
  let first: HTMLElement | null = null;
  let second: HTMLElement | null = null;
  if (next && framesAreAdjacent(frame, next)) {
    first = frame;
    second = next;
  } else if (prev && framesAreAdjacent(prev, frame)) {
    first = prev;
    second = frame;
  }
  if (!first || !second) {
    window.alert("바로 앞이나 뒤에 붙어 있는 사진이 없습니다. 사진 두 장을 연달아 넣은 뒤 「2열로」를 눌러 주세요.");
    return false;
  }

  const secondParent = second.parentElement;
  const pair = document.createElement("div");
  pair.className = INLINE_IMG_ROW_CLASS;
  pair.setAttribute("contenteditable", "false");
  pair.setAttribute("data-img-row", "2");
  first.before(pair);
  for (const item of [first, second]) {
    clearInlineImageDisplaySize(item);
    pair.appendChild(item);
    refreshImageTools(item);
  }
  removeIfBlank(secondParent, editor);
  return true;
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
  img.setAttribute("draggable", "false");
  if (parent?.classList.contains(INLINE_IMG_WRAP_CLASS)) {
    parent.setAttribute("contenteditable", "false");
    parent.classList.remove(IMG_SLOT_CLASS);
    ensureDeleteControl(parent, img);
    ensureResizeControl(parent);
    ensureImageTools(parent);
    restoreInlineImageDisplaySize(parent);
    return parent;
  }
  if (parent?.classList.contains("generalInfoInlineImageBlock")) {
    parent.setAttribute("contenteditable", "false");
    ensureResizeControl(parent);
    ensureImageTools(parent);
    restoreInlineImageDisplaySize(parent);
    return parent;
  }
  const wrap = document.createElement("span");
  wrap.className = INLINE_IMG_WRAP_CLASS;
  wrap.setAttribute("contenteditable", "false");
  img.replaceWith(wrap);
  wrap.appendChild(img);
  ensureDeleteControl(wrap, img);
  ensureResizeControl(wrap);
  ensureImageTools(wrap);
  return wrap;
}

export function createInlineImage(src: string, alt: string, slotId?: string) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.className = `${INLINE_IMG_CLASS} generalInfoInlineImage`;
  img.setAttribute("contenteditable", "false");
  img.setAttribute("draggable", "false");
  if (slotId) img.setAttribute("data-img-slot", slotId);
  return ensureInlineImageWrap(img);
}

/** One image stays full width; two or more go into a 2-column row. */
export function createInlineImageInsert(urls: Array<{ src: string; alt?: string }>, slotId?: string | null) {
  const nodes = urls.map((item, index) =>
    createInlineImage(
      item.src,
      item.alt || (slotId ? (index === 0 ? slotId : `${slotId}-${index + 1}`) : "이미지"),
      index === 0 && slotId ? slotId : undefined,
    ),
  );
  if (nodes.length <= 1) return nodes[0] || null;
  const row = document.createElement("div");
  row.className = INLINE_IMG_ROW_CLASS;
  row.setAttribute("contenteditable", "false");
  row.setAttribute("data-img-row", "2");
  nodes.forEach((node) => row.appendChild(node));
  return row;
}

function compactImageRowAfterRemove(row: HTMLElement | null) {
  if (!row || !row.classList.contains(INLINE_IMG_ROW_CLASS)) return;
  const left = Array.from(row.children).filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    return (
      node.classList.contains(INLINE_IMG_WRAP_CLASS) ||
      node.classList.contains("generalInfoInlineImageBlock")
    );
  }) as HTMLElement[];
  if (left.length >= 2) return;
  if (left.length === 1) {
    row.replaceWith(left[0]);
    return;
  }
  row.remove();
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

/** S. 또는 s. (s1., s2., S1. 등 포함) 한 묶음이 사진 칸 하나 */
const IMAGE_TRIGGER_AT_CARET = /(?:^|[^A-Za-z0-9가-힣])([Ss]\d*\.\s*)$/;

/** date. 한 묶음이 그 순간의 년월일시분 */
const DATE_TRIGGER_AT_CARET = /(?:^|[^A-Za-z])(date\.)$/i;
const DATE_STAMP_CLASS = "body-datetime";
const DATE_STAMP_COLOR = "#eab308";

export function formatSystemDateTime(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 커서 앞이 date. 이면 그 글자를 지우고, 그 순간의 년.월.일 시:분을 노란 글씨로 넣습니다.
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

export const IMAGE_SLOT_GUIDE =
  "본문에 s. (또는 s1., s2., S.)를 입력하면 사진 칸이 생깁니다. 그 칸에서 사진찍기, 사진첩 또는 복사한 이미지 붙여넣기로 넣으세요. 여러 장을 한 번에 넣으면 두 열로 보입니다.";

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
  const allocSlotId = (preferredNumber?: number) => {
    if (preferredNumber && !used.has(`S${preferredNumber}`)) {
      const id = `S${preferredNumber}`;
      used.add(id);
      return id;
    }
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
    const numMatch = consumed.match(/\d+/);
    const preferredNum = numMatch ? parseInt(numMatch[0], 10) : undefined;
    ids.push(allocSlotId(preferredNum));
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

type CaretMemoryEditor = HTMLElement & { __lastCaret?: Range };

/** 편집 칸 안의 마지막 커서 위치. 도구줄 버튼을 누르는 순간 커서가 빠져도 그 자리에 넣기 위해 기억한다. */
function rememberEditorCaret(editor: HTMLElement, signal: AbortSignal) {
  document.addEventListener(
    "selectionchange",
    () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        (editor as CaretMemoryEditor).__lastCaret = range.cloneRange();
      }
    },
    { signal },
  );
}

/** Insert empty slot at caret (toolbar image button). */
export function insertEmptyImageSlot(editor: HTMLElement | null): string | null {
  if (!editor) return null;
  editor.focus();
  // 버튼을 누르느라 커서가 빠졌으면 마지막 커서 위치로 되돌린다
  const saved = (editor as CaretMemoryEditor).__lastCaret;
  const current = window.getSelection();
  if (
    saved &&
    current &&
    editor.contains(saved.commonAncestorContainer) &&
    !(current.rangeCount > 0 && editor.contains(current.getRangeAt(0).commonAncestorContainer))
  ) {
    current.removeAllRanges();
    current.addRange(saved);
  }
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

/**
 * 도구줄 사진 버튼용: 빈 사진 칸이 있으면 그 칸을, 없으면 커서 위치에 새 칸을 만들어 돌려준다.
 * (s. 를 먼저 입력하지 않아도 도구줄 버튼만으로 사진을 넣을 수 있게)
 */
export function ensureImageSlot(editor: HTMLElement | null): { slotId: string | null; created: boolean } {
  if (!editor) return { slotId: null, created: false };
  const existing = findAwaitingSlotId(editor);
  if (existing) return { slotId: existing, created: false };
  const slotId = insertEmptyImageSlot(editor);
  return { slotId, created: Boolean(slotId) };
}

/** 자동으로 만든 칸에 넣을 사진이 없으면(붙여넣기 실패 등) 그 칸을 지운다. */
export function removeImageSlot(editor: HTMLElement | null, slotId: string | null) {
  if (!editor || !slotId) return;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(slotId) : slotId.replace(/"/g, '\\"');
  const slot = editor.querySelector(`.${IMG_SLOT_CLASS}[data-img-slot="${escaped}"]`);
  if (slot && !slot.querySelector("img")) slot.remove();
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
      const node = createInlineImageInsert(urls, awaitId);
      if (!node) return false;
      slot.replaceWith(node);
      return true;
    }
    if (slotId) return false;
  }

  const node = createInlineImageInsert(urls, null);
  if (!node) return false;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(node);
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
    const row = frameInImageRow(wrap);
    wrap.remove();
    compactImageRowAfterRemove(row);
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
    img.setAttribute("draggable", "false");
    ensureInlineImageWrap(img);
  });
  editor.querySelectorAll(`.${IMG_SLOT_CLASS}[data-img-slot]`).forEach((node) => {
    const slot = node as HTMLElement;
    slot.setAttribute("contenteditable", "false");
    if (slot.classList.contains(INLINE_IMG_WRAP_CLASS)) return;
    if (slot.querySelector("img")) return;
    paintEmptyImageSlot(slot);
  });
  editor.querySelectorAll(`.${INLINE_IMG_ROW_CLASS}`).forEach((node) => {
    const row = node as HTMLElement;
    row.setAttribute("contenteditable", "false");
    row.setAttribute("data-img-row", "2");
    compactImageRowAfterRemove(row);
  });
  editor.querySelectorAll(".generalInfoInlineImageBlock").forEach((node) => {
    const frame = node as HTMLElement;
    if (!frame.querySelector("img")) return;
    frame.setAttribute("contenteditable", "false");
    ensureResizeControl(frame);
    ensureImageTools(frame);
    restoreInlineImageDisplaySize(frame);
  });
  bindInlineImageResize(editor);
}
