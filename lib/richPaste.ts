import { imageFilesFromClipboard } from "./compressImageFile";
import { ensureImageSlot, removeImageSlot } from "./richImageSlots";

/** 붙여넣기 이벤트에서 동기적으로 읽어 둔 내용. (await 뒤에는 clipboardData를 읽을 수 없다) */
export type PastedClipboard = {
  text: string;
  files: File[];
  /** 복사한 웹 페이지(HTML) 안의 <img> 주소. data: 주소도 포함 */
  htmlImageSrcs: string[];
};

const MAX_PASTED_IMAGES = 8;

export function readPastedClipboard(data: DataTransfer | null): PastedClipboard {
  const text = data?.getData("text/plain") || "";
  const files = imageFilesFromClipboard(data);
  const htmlImageSrcs: string[] = [];
  const html = files.length ? "" : data?.getData("text/html") || "";
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const img of Array.from(doc.querySelectorAll("img"))) {
        const src = (img.getAttribute("src") || "").trim();
        if (/^(https?:|data:image\/)/i.test(src) && !htmlImageSrcs.includes(src)) htmlImageSrcs.push(src);
      }
    } catch {
      /* HTML을 읽지 못하면 글자만 붙여넣는다 */
    }
  }
  return { text, files, htmlImageSrcs: htmlImageSrcs.slice(0, MAX_PASTED_IMAGES) };
}

export function clipboardHasImages(clip: PastedClipboard) {
  return clip.files.length > 0 || clip.htmlImageSrcs.length > 0;
}

/**
 * 웹 페이지에서 복사한 사진 주소를 파일로 바꾼다.
 * data: 주소는 바로 파일로, 외부 주소는 내려받아 파일로(막히면 주소 그대로 넣는다).
 */
async function resolveHtmlImages(srcs: string[]): Promise<{ files: File[]; urls: string[] }> {
  const files: File[] = [];
  const urls: string[] = [];
  let index = 0;
  for (const src of srcs) {
    index += 1;
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      if (blob.type.startsWith("image/") && blob.size > 0) {
        const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
        files.push(new File([blob], `pasted-${Date.now()}-${index}.${ext}`, { type: blob.type }));
        continue;
      }
    } catch {
      /* 다른 사이트 사진은 브라우저가 막을 수 있다 */
    }
    if (/^https?:/i.test(src)) urls.push(src);
  }
  return { files, urls };
}

/**
 * 붙여넣은 사진을 편집기에 넣는다. 빈 사진 칸이 없으면 커서 위치에 만든다.
 * 넣을 사진이 하나도 없으면 방금 만든 칸을 지우고 onNone을 부른다.
 */
export function pasteClipboardImages(
  editor: HTMLElement | null,
  clip: PastedClipboard,
  insert: (files: File[], slotId: string | null, urls: string[]) => Promise<void>,
  onNone?: () => void,
) {
  if (!editor || !clipboardHasImages(clip)) return;
  const { slotId, created } = ensureImageSlot(editor);
  void (async () => {
    try {
      const resolved = clip.htmlImageSrcs.length ? await resolveHtmlImages(clip.htmlImageSrcs) : { files: [], urls: [] };
      const files = [...clip.files, ...resolved.files];
      if (!files.length && !resolved.urls.length) {
        if (created) removeImageSlot(editor, slotId);
        onNone?.();
        return;
      }
      await insert(files, slotId, resolved.urls);
    } catch (error) {
      console.error("붙여넣은 사진 처리 실패", error);
      if (created) removeImageSlot(editor, slotId);
      onNone?.();
    }
  })();
}

export const PASTE_IMAGE_FAILED_MESSAGE = "붙여넣은 사진을 가져오지 못했습니다. 사진을 길게 눌러 복사하거나 사진보관함을 이용해 주세요.";
