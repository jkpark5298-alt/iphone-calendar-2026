/** Extra white writing cells stacked under the main editor. */

const WHITE_CELL_ATTR = "data-white-cell";

export function makeWhiteCellId() {
  return `wc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function classCellPayload(node: Element) {
  const body = node.querySelector(".collect-class-cell-body");
  const source = (body || node) as HTMLElement;
  const html = source.innerHTML;
  const text = (source.textContent || "").replace(/\u00a0/g, " ").trim();
  return { html, text };
}

export function splitWhiteCells(html: string): { main: string; extras: string[] } {
  const raw = String(html || "");
  const hasStore = raw.includes(WHITE_CELL_ATTR);
  const hasInset = raw.includes("collect-class-cell");
  if ((!hasStore && !hasInset) || typeof DOMParser === "undefined") {
    return { main: raw, extras: [] };
  }
  const doc = new DOMParser().parseFromString(`<div id="white-cell-root">${raw}</div>`, "text/html");
  const root = doc.getElementById("white-cell-root");
  if (!root) return { main: raw, extras: [] };
  const extras: string[] = [];
  root.querySelectorAll(`:scope > [${WHITE_CELL_ATTR}]`).forEach((node) => {
    extras.push((node as HTMLElement).innerHTML);
    node.remove();
  });
  root.querySelectorAll(".collect-class-cell").forEach((node) => {
    const payload = classCellPayload(node);
    if (payload.text) extras.push(payload.html);
    node.remove();
  });
  return { main: root.innerHTML, extras };
}

export function joinWhiteCells(main: string, extras: string[]) {
  if (!extras.length) return main;
  const wrapped = extras
    .map((html) => `<div class="collect-white-cell-store" ${WHITE_CELL_ATTR}="1">${html}</div>`)
    .join("");
  return `${main}${wrapped}`;
}

export function readStackedHtml(editor: HTMLElement | null) {
  if (!editor) return "";
  const wraps = editor.parentElement?.querySelectorAll(":scope > .collect-white-cell-wrap .collect-white-cell");
  const extras = Array.from(wraps || []).map((node) => (node as HTMLElement).innerHTML);
  return joinWhiteCells(editor.innerHTML || "", extras);
}

export function readStackedText(editor: HTMLElement | null) {
  if (!editor) return "";
  const wraps = editor.parentElement?.querySelectorAll(":scope > .collect-white-cell-wrap .collect-white-cell");
  const parts = [editor.innerText || "", ...Array.from(wraps || []).map((node) => (node as HTMLElement).innerText || "")];
  return parts.join("\n").replace(/\u00a0/g, " ").replace(/\n{4,}/g, "\n\n\n");
}

const CLASS_CELL_BODY_CLASS = "collect-class-cell-body";
const CLASS_CELL_DEL_CLASS = "collect-class-cell-del";

/** Removes an older inset classification card. Returns true when the click was on that card. */
export function removeClassCellFromEvent(
  editor: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  if (!editor || !(target instanceof Element)) return false;
  const del = target.closest(`.${CLASS_CELL_DEL_CLASS}`);
  if (!del || !editor.contains(del)) return false;
  const cell = del.closest(".collect-class-cell");
  if (!cell) return false;
  const text = cell.querySelector(`.${CLASS_CELL_BODY_CLASS}`)?.textContent?.replace(/\u00a0/g, " ").trim() || "";
  if (text && !window.confirm("이 분류 칸을 지울까요?")) return true;
  cell.remove();
  return true;
}
