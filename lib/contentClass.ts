/** 일기장·테마 칸 분류. 선택하면 본문에 #태그가 붙고, 본문에도 직접 입력할 수 있습니다. */

export const CONTENT_CLASSES = [
  "애플",
  "과학",
  "경제",
  "사회",
  "기술",
  "AI",
  "국제",
  "건강",
  "뇌과학",
  "마케팅",
  "화장품",
  "책",
  "영화",
  "기타",
  "1인 기업",
  "코딩",
] as const;

export type ContentClassLabel = (typeof CONTENT_CLASSES)[number];

export function contentClassTag(label: string) {
  return `#${label}`;
}

/** 칸 끝에 없는 #태그만 붙입니다. 이미 있으면 그대로 둡니다. */
export function appendHashtagToEditor(editor: HTMLElement, label: string) {
  const tag = contentClassTag(label);
  const current = (editor.innerText || "").replace(/\u00a0/g, " ");
  if (current.includes(tag)) return false;

  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const needsBreak = current.trim().length > 0 && !current.endsWith("\n");
  const prefix = needsBreak ? "\n" : "";
  document.execCommand("insertText", false, `${prefix}${tag} `);
  return true;
}
