import { enhanceRichInlineImages } from "./richImageSlots";

/** 마지막으로 커서가 있던 칸. 도구줄 버튼을 누르면 선택이 풀리는 기기를 위해 기억해 둔다. */
let lastFocusedCell: { kind: "main" } | { kind: "white"; id: string } | null = null;

if (typeof document !== "undefined") {
  document.addEventListener("focusin", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const wrap = target.closest("[data-white-id]");
    if (wrap) {
      lastFocusedCell = { kind: "white", id: wrap.getAttribute("data-white-id") || "" };
    } else if (target.closest(".collectPaperEditor")) {
      lastFocusedCell = { kind: "main" };
    }
  });
}

/**
 * 커서가 있는 칸의 위치. 본문(첫 칸)은 -1, 아래 칸은 0부터, 알 수 없으면 null.
 */
export function activeCellIndex(ids: string[]): number | null {
  const node = window.getSelection()?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement || null;
  const wrap = el?.closest("[data-white-id]");
  if (wrap) {
    const index = ids.indexOf(wrap.getAttribute("data-white-id") || "");
    if (index >= 0) return index;
  } else if (el?.closest(".collectPaperEditor")) {
    return -1;
  }
  if (lastFocusedCell?.kind === "main") return -1;
  if (lastFocusedCell?.kind === "white") {
    const index = ids.indexOf(lastFocusedCell.id);
    if (index >= 0) return index;
  }
  return null;
}

/**
 * 서식(굵게·글자 크기·색 등)을 적용할 편집기. 커서가 있는 칸(없으면 마지막으로 커서가 있던 칸)을 돌려주고,
 * 알 수 없거나 본문 칸이면 본문 편집기를 돌려준다.
 */
export function formatTargetEditor(mainEditor: HTMLElement | null): HTMLElement | null {
  const node = window.getSelection()?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement || null;
  const cellOf = (id: string) =>
    id ? document.querySelector<HTMLElement>(`[data-white-id="${id}"] .collect-white-cell`) : null;
  const wrap = el?.closest("[data-white-id]");
  if (wrap) return cellOf(wrap.getAttribute("data-white-id") || "") || mainEditor;
  if (el?.closest(".collectPaperEditor")) return mainEditor;
  if (lastFocusedCell?.kind === "white") return cellOf(lastFocusedCell.id) || mainEditor;
  return mainEditor;
}

/** 서식을 칸에 적용한 뒤 저장되도록 input 이벤트를 알린다(span 감싸기 등은 브라우저가 알리지 않는다). */
export function notifyCellFormatted(target: HTMLElement | null, mainEditor: HTMLElement | null) {
  if (target && target !== mainEditor) target.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 새 칸을 끼워 넣을 자리. 커서가 있는 칸 바로 아래, 알 수 없으면 맨 아래. */
export function insertPositionForNewCell(ids: string[]): number {
  const index = activeCellIndex(ids);
  return index === null ? ids.length : index + 1;
}

/** 지울 칸. 커서가 아래 칸에 있으면 그 칸, 아니면 마지막 칸. */
export function removeTargetCellId(ids: string[]): string | undefined {
  const index = activeCellIndex(ids);
  return index !== null && index >= 0 ? ids[index] : ids[ids.length - 1];
}

/**
 * 칸을 위(-1)나 아래(1)로 옮긴다. 첫 번째 아래 칸을 위로 옮기면 본문 칸과 내용을 맞바꾼다.
 * 목록 순서가 바뀌었으면 새 목록을, 본문과 맞바꿨거나 옮길 수 없으면 null을 돌려준다.
 */
export function moveWhiteCell(
  ids: string[],
  id: string,
  direction: -1 | 1,
  mainEditor: HTMLElement | null,
): { ids: string[] } | { swappedWithMain: true } | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  if (direction === -1 && index === 0) {
    const cell = document.querySelector<HTMLElement>(`[data-white-id="${id}"] .collect-white-cell`);
    if (!mainEditor || !cell) return null;
    const mainHtml = mainEditor.innerHTML;
    mainEditor.innerHTML = cell.innerHTML;
    cell.innerHTML = mainHtml;
    enhanceRichInlineImages(mainEditor);
    enhanceRichInlineImages(cell);
    return { swappedWithMain: true };
  }
  const target = index + direction;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return { ids: next };
}
