/** builder FormatToolbar용 contentEditable 서식 헬퍼 (execCommand + font-size span) */

export function wrapSelectionWithSpan(
  editor: HTMLElement | null,
  styles: Record<string, string>,
): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    const span = document.createElement("span");
    Object.assign(span.style, styles);
    span.appendChild(document.createTextNode("\u200b"));
    range.insertNode(span);
    range.setStart(span.firstChild!, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  try {
    const span = document.createElement("span");
    Object.assign(span.style, styles);
    range.surroundContents(span);
    return true;
  } catch {
    document.execCommand("styleWithCSS", false, "true");
    if (styles.fontSize) {
      document.execCommand("fontSize", false, "7");
      editor?.querySelectorAll('font[size="7"]').forEach((node) => {
        const el = node as HTMLElement;
        const span = document.createElement("span");
        span.style.fontSize = styles.fontSize!;
        while (el.firstChild) span.appendChild(el.firstChild);
        el.replaceWith(span);
      });
      return true;
    }
    return false;
  }
}

/**
 * CollectFormatToolbar 명령 실행.
 * - bold / underline / undo / redo / removeFormat
 * - foreColor / highlight / fontSizePx / insertText
 */
export function runCollectRichCommand(
  editor: HTMLElement | null,
  command: string,
  value?: string,
): void {
  editor?.focus();

  if (command === "insertText" && value) {
    const ok = document.execCommand("insertText", false, value);
    if (!ok) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(value));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else if (editor) {
        editor.appendChild(document.createTextNode(value));
      }
    }
    return;
  }

  if (command === "fontSizePx" && value) {
    wrapSelectionWithSpan(editor, { fontSize: `${value}px` });
    return;
  }

  if (command === "highlight" && value) {
    document.execCommand("styleWithCSS", false, "true");
    const ok =
      document.execCommand("hiliteColor", false, value) ||
      document.execCommand("backColor", false, value);
    if (!ok) wrapSelectionWithSpan(editor, { backgroundColor: value });
    return;
  }

  if (command === "foreColor" && value) {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, value);
    return;
  }

  document.execCommand(command, false, value);
}

/** 아이폰/브라우저 클립보드에서 이미지 File[] 읽기 */
export async function readClipboardImageFiles(): Promise<File[]> {
  if (!navigator.clipboard?.read) {
    throw new Error("unsupported");
  }
  const items = await navigator.clipboard.read();
  const files: File[] = [];
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (!type) continue;
    const blob = await item.getType(type);
    files.push(new File([blob], `clipboard-${Date.now()}.png`, { type }));
  }
  return files;
}

/** data URL → File (인라인 이미지 삽입용) */
export async function dataUrlToImageFile(dataUrl: string, name: string): Promise<File | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const type = blob.type || "image/png";
    return new File([blob], name, { type });
  } catch {
    return null;
  }
}
