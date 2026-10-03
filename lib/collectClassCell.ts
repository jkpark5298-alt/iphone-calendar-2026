/** A separate classification cell inside the rich editor. Not an image slot. */

export const CLASS_CELL_CLASS = "collect-class-cell";
const CLASS_CELL_BODY_CLASS = "collect-class-cell-body";
const CLASS_CELL_DEL_CLASS = "collect-class-cell-del";

export function insertClassCell(editor: HTMLElement | null): HTMLElement | null {
  if (!editor) return null;
  editor.focus();

  const cell = document.createElement("div");
  cell.className = CLASS_CELL_CLASS;
  cell.setAttribute("data-class-cell", "1");
  cell.setAttribute("contenteditable", "false");

  const label = document.createElement("div");
  label.className = "collect-class-cell-label";
  label.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = CLASS_CELL_BODY_CLASS;
  body.setAttribute("contenteditable", "true");
  body.setAttribute("data-placeholder", "이 분류 칸에 내용을 입력하세요");
  body.appendChild(document.createElement("br"));

  const del = document.createElement("span");
  del.className = CLASS_CELL_DEL_CLASS;
  del.setAttribute("role", "button");
  del.setAttribute("aria-label", "분류 칸 지우기");

  cell.append(label, body, del);

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(cell);
    const after = document.createElement("div");
    after.appendChild(document.createElement("br"));
    cell.after(after);
  } else {
    editor.appendChild(cell);
  }

  const caret = document.createRange();
  caret.selectNodeContents(body);
  caret.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caret);
  body.focus();
  return cell;
}

/** Returns true when the click removed a classification cell. */
export function removeClassCellFromEvent(
  editor: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  if (!editor || !(target instanceof Element)) return false;
  const del = target.closest(`.${CLASS_CELL_DEL_CLASS}`);
  if (!del || !editor.contains(del)) return false;
  const cell = del.closest(`.${CLASS_CELL_CLASS}`);
  if (!cell) return false;
  const text = cell.querySelector(`.${CLASS_CELL_BODY_CLASS}`)?.textContent?.replace(/\u00a0/g, " ").trim() || "";
  if (text && !window.confirm("이 분류 칸을 지울까요?")) return true;
  cell.remove();
  return true;
}
