"use client";

import React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { AiReportFormatToolbar } from "./AiReportFormatToolbar";
import { GeneralInfoMobileFormatBubble } from "./GeneralInfoMobileFormatBubble";
import {
  normalizeAiReportEditorHtml,
  stepAiReportFontSize,
} from "../lib/aiReportEditor";
import { AiReportImage, AiReportVideo } from "../lib/aiReportTipTapMedia";
import {
  collectClipboardImageFiles,
  dedupeImageFiles,
  editorHasInlineImageTrigger,
  readFilesAsDataUrls,
} from "../lib/generalInfoHelpers";

/** builder 본문(밝은 지면)용 — 다크 팔레트 대신 가독성 있는 글자색 */
const MOBILE_PAPER_TEXT_COLORS = [
  { id: "default", color: "#1e293b", label: "기본" },
  { id: "brown", color: "#b45309", label: "갈" },
  { id: "blue", color: "#2563eb", label: "파랑" },
  { id: "red", color: "#dc2626", label: "빨강" },
  { id: "green", color: "#15803d", label: "초록" },
] as const;

const MOBILE_PAPER_HIGHLIGHTS = [
  { id: "yellow", bg: "#fef08a", label: "노랑" },
  { id: "sky", bg: "#bae6fd", label: "하늘" },
  { id: "pink", bg: "#fbcfe8", label: "분홍" },
  { id: "mint", bg: "#bbf7d0", label: "연두" },
] as const;

type Props = {
  html: string;
  onChange: (html: string) => void;
  onUploadImage?: (file: File) => Promise<string>;
  /** 이미지/동영상 삽입 직후 자동 저장용 */
  onMediaInserted?: (html: string) => void | Promise<void>;
};

const textEndsWithImageTrigger = (raw: string) => {
  const text = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "");
  const trimmedEnd = text.replace(/[ \t\n]+$/g, "");
  return /[Ss]$/.test(trimmedEnd);
};

/** 문서 끝 또는 커서 직전 S/s 감지 */
const tipTapHasImageTrigger = (ed: Editor | null) => {
  if (!ed) return false;
  try {
    if (editorHasInlineImageTrigger(ed.view.dom as HTMLElement)) return true;
  } catch {
    // view 미준비
  }
  if (textEndsWithImageTrigger(ed.getText({ blockSeparator: "\n" }))) return true;
  const { from } = ed.state.selection;
  const before = ed.state.doc.textBetween(Math.max(0, from - 8), from, "\n", "\n");
  return /[ \t]*[Ss]$/.test(before.replace(/[\u200B-\u200D\uFEFF]/g, ""));
};

const isVideoFile = (file: File) =>
  file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name || "");

const isImageFile = (file: File) =>
  file.type.startsWith("image/") ||
  /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || "");

/** 문서/커서 끝의 S·s 트리거를 지우고 그 위치에 포커스 */
const removeTrailingImageTriggerFromTipTap = (ed: Editor): boolean => {
  const endPos = ed.state.doc.content.size;
  const lookBack = Math.min(12, endPos);
  const fromProbe = endPos - lookBack;
  const slice = ed.state.doc.textBetween(fromProbe, endPos, "\n", "\n");
  const match = slice.match(/[ \t]*[Ss][ \t\n]*$/);
  if (!match) {
    const { from } = ed.state.selection;
    const before = ed.state.doc.textBetween(Math.max(0, from - 8), from, "", "");
    const caretMatch = before.match(/[ \t]*[Ss]$/);
    if (!caretMatch) return false;
    const delFrom = from - caretMatch[0].length;
    ed.chain().focus().deleteRange({ from: delFrom, to: from }).run();
    return true;
  }
  const delFrom = endPos - match[0].length;
  ed.chain().focus().deleteRange({ from: delFrom, to: endPos }).run();
  return true;
};

const resolveMediaSrc = async (
  file: File,
  upload?: (file: File) => Promise<string>,
): Promise<string> => {
  if (upload) {
    try {
      const uploaded = String((await upload(file)) || "").trim();
      if (uploaded) return uploaded;
    } catch (error) {
      console.error("report media upload failed, falling back to data URL", error);
    }
  }
  try {
    const loaded = await readFilesAsDataUrls([file]);
    return String(loaded[0]?.dataUrl || "").trim();
  } catch {
    return "";
  }
};

export function AiReportRichEditor({
  html,
  onChange,
  onUploadImage,
  onMediaInserted,
}: Props) {
  const onChangeRef = React.useRef(onChange);
  const onUploadImageRef = React.useRef(onUploadImage);
  const onMediaInsertedRef = React.useRef(onMediaInserted);
  const lastEmittedRef = React.useRef(normalizeAiReportEditorHtml(html));
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const triggerFileRef = React.useRef<HTMLInputElement | null>(null);
  const editorDomRef = React.useRef<HTMLElement | null>(null);
  const editorRef = React.useRef<Editor | null>(null);
  const imageInsertPanelRef = React.useRef<HTMLDivElement | null>(null);
  const [showImageInsert, setShowImageInsert] = React.useState(false);
  const [keyboardInset, setKeyboardInset] = React.useState(0);
  const [, bump] = React.useState(0);
  onChangeRef.current = onChange;
  onUploadImageRef.current = onUploadImage;
  onMediaInsertedRef.current = onMediaInserted;

  const syncImageTrigger = React.useCallback((ed: Editor | null) => {
    const next = tipTapHasImageTrigger(ed);
    setShowImageInsert(next);
    return next;
  }, []);

  const emitHtml = React.useCallback((ed: Editor) => {
    const next = normalizeAiReportEditorHtml(ed.getHTML());
    if (next !== lastEmittedRef.current) {
      lastEmittedRef.current = next;
      onChangeRef.current(next);
    }
    return next;
  }, []);

  const insertMediaFiles = React.useCallback(
    async (files: FileList | File[] | null, opts?: { removeTrigger?: boolean }) => {
      const ed = editorRef.current;
      if (!ed) return;
      if (!files || (files instanceof FileList ? files.length === 0 : files.length === 0)) return;

      if (opts?.removeTrigger) {
        removeTrailingImageTriggerFromTipTap(ed);
      }

      const list = dedupeImageFiles(files instanceof FileList ? Array.from(files) : files);
      const mediaFiles = list.filter((file) => isImageFile(file) || isVideoFile(file));
      if (!mediaFiles.length) {
        alert("이미지/동영상 파일을 선택해 주세요.");
        return;
      }

      let inserted = 0;
      try {
        for (const file of mediaFiles) {
          const src = await resolveMediaSrc(file, onUploadImageRef.current);
          if (!src) continue;
          if (isVideoFile(file)) {
            ed.chain()
              .focus()
              .insertContent({
                type: "video",
                attrs: { src, controls: true },
              })
              .run();
          } else {
            ed.chain()
              .focus()
              .insertContent({
                type: "image",
                attrs: { src, alt: file.name || "보고서 이미지" },
              })
              .run();
          }
          inserted += 1;
        }
        if (!inserted) {
          alert("미디어를 넣지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
          return;
        }
        const next = emitHtml(ed);
        await onMediaInsertedRef.current?.(next);
      } finally {
        setShowImageInsert(false);
      }
    },
    [emitHtml],
  );

  const insertMediaFilesRef = React.useRef(insertMediaFiles);
  insertMediaFilesRef.current = insertMediaFiles;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      FontSize,
      AiReportImage,
      AiReportVideo,
    ],
    content: normalizeAiReportEditorHtml(html || "<p></p>"),
    editorProps: {
      attributes: {
        class: "giAiReportTipTap",
        spellcheck: "false",
      },
      handlePaste: (_view, event) => {
        const pasted = collectClipboardImageFiles(event.clipboardData);
        if (!pasted.length) return false;
        event.preventDefault();
        void insertMediaFilesRef.current(pasted, {
          removeTrigger: tipTapHasImageTrigger(editorRef.current),
        });
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      emitHtml(ed);
      syncImageTrigger(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      bump((n) => n + 1);
      syncImageTrigger(ed);
    },
  });

  editorRef.current = editor;

  React.useEffect(() => {
    editorDomRef.current = editor?.view?.dom ?? null;
  }, [editor]);

  // 아이폰 키보드 높이 — 패널을 키보드·서식바 위에 고정
  React.useEffect(() => {
    if (!showImageInsert) {
      setKeyboardInset(0);
      return;
    }
    const update = () => {
      const vv = window.visualViewport;
      if (!vv) {
        setKeyboardInset(0);
        return;
      }
      setKeyboardInset(Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)));
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [showImageInsert]);

  React.useEffect(() => {
    if (!showImageInsert) return;
    const el = imageInsertPanelRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [showImageInsert]);

  // iOS: keyup/compositionend에서도 S 재검사
  React.useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const recheck = () => syncImageTrigger(editor);
    dom.addEventListener("keyup", recheck);
    dom.addEventListener("compositionend", recheck);
    dom.addEventListener("input", recheck);
    return () => {
      dom.removeEventListener("keyup", recheck);
      dom.removeEventListener("compositionend", recheck);
      dom.removeEventListener("input", recheck);
    };
  }, [editor, syncImageTrigger]);

  React.useEffect(() => {
    if (!editor) return;
    const incoming = normalizeAiReportEditorHtml(html || "<p></p>");
    if (incoming === lastEmittedRef.current) return;
    const current = normalizeAiReportEditorHtml(editor.getHTML());
    if (incoming === current) {
      lastEmittedRef.current = incoming;
      return;
    }
    // 외부에서 온 내용만 반영 (타이핑 중 setContent로 패널이 꺼지지 않게)
    const edFocused = editor.isFocused;
    editor.commands.setContent(incoming, { emitUpdate: false });
    lastEmittedRef.current = incoming;
    if (!edFocused) syncImageTrigger(editor);
  }, [editor, html, syncImageTrigger]);

  const currentFontPx = (() => {
    if (!editor) return 14;
    const raw = String(editor.getAttributes("textStyle").fontSize || "14px");
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 14;
  })();

  const runMobileCommand = React.useCallback((command: string, value?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (command === "bold") {
      ed.chain().focus().toggleBold().run();
      return;
    }
    if (command === "underline") {
      ed.chain().focus().toggleUnderline().run();
      return;
    }
    if (command === "fontSizeStep") {
      const raw = String(ed.getAttributes("textStyle").fontSize || "14px");
      const n = Number.parseInt(raw, 10);
      const current = Number.isFinite(n) ? n : 14;
      const next = stepAiReportFontSize(current, Number(value || 0));
      ed.chain().focus().setFontSize(`${next}px`).run();
      return;
    }
    if (command === "foreColor" && value) {
      ed.chain().focus().setColor(value).run();
      return;
    }
    if (command === "hiliteColor" && value) {
      ed.chain().focus().toggleHighlight({ color: value }).run();
      return;
    }
    if (command === "removeFormat") {
      ed.chain().focus().unsetAllMarks().run();
    }
  }, []);

  const insertChar = React.useCallback((ch: string) => {
    editorRef.current?.chain().focus().insertContent(ch).run();
  }, []);

  const openImagePicker = React.useCallback(() => {
    fileRef.current?.click();
  }, []);

  const handleTriggerPaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const pastedFiles = collectClipboardImageFiles(event.clipboardData);
      if (pastedFiles.length > 0) {
        void insertMediaFiles(pastedFiles, { removeTrigger: true });
      }
    },
    [insertMediaFiles],
  );

  if (!editor) {
    return <div className="giAiReportEditorLoading">편집기 준비 중…</div>;
  }

  return (
    <div className="giAiReportEditorShell">
      <div className="giAiReportBodyLabel">편집 중 · 본문</div>
      <p className="giAiReportMobileFormatHint">
        본문을 탭하면 키보드 위에 서식 바가 나타납니다. 문장 끝에{" "}
        <strong>S</strong>를 붙이면 이미지/동영상 붙여넣기가 열립니다.
      </p>
      <div className="giAiReportDesktopToolbarWrap">
        <AiReportFormatToolbar
          canUndo={editor.can().undo()}
          canRedo={editor.can().redo()}
          onUndo={() => editor.chain().focus().undo().run()}
          onRedo={() => editor.chain().focus().redo().run()}
          onBold={() => editor.chain().focus().toggleBold().run()}
          onUnderline={() => editor.chain().focus().toggleUnderline().run()}
          onFontSize={(px) => editor.chain().focus().setFontSize(`${px}px`).run()}
          onFontSizeStep={(delta) => {
            const next = stepAiReportFontSize(currentFontPx, delta);
            editor.chain().focus().setFontSize(`${next}px`).run();
          }}
          onColor={(color) => editor.chain().focus().setColor(color).run()}
          onHighlight={(bg) => editor.chain().focus().toggleHighlight({ color: bg }).run()}
          onInsertChar={(ch) => editor.chain().focus().insertContent(ch).run()}
          onRemoveFormat={() => editor.chain().focus().unsetAllMarks().run()}
          onImage={openImagePicker}
        />
      </div>

      {showImageInsert && (
        <div
          ref={imageInsertPanelRef}
          className="generalInfoTextImageInsertPanel giAiReportImageInsertPanel giAiReportImageInsertDock"
          style={{
            bottom: `calc(${keyboardInset}px + var(--gi-mobile-format-bar-h, 0px) + 8px)`,
          }}
        >
          <div className="generalInfoTextImageInsertHead">
            <strong>이미지·동영상 붙여넣기</strong>
            <span>S 감지 · 사진첩 또는 붙여넣기</span>
            <button
              type="button"
              className="secondaryButton smallActionButton"
              onClick={() => {
                removeTrailingImageTriggerFromTipTap(editor);
                setShowImageInsert(false);
              }}
            >
              닫기
            </button>
          </div>
          <div className="generalInfoTextImageInsertActions">
            <label className="primaryLabel generalInfoTextImageFileLabel">
              🖼 사진첩 · 파일 선택
              <input
                ref={triggerFileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(e) => {
                  void insertMediaFiles(e.target.files, { removeTrigger: true });
                  e.target.value = "";
                }}
              />
            </label>
            <div
              className="generalInfoTextImagePasteZone"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              onPaste={handleTriggerPaste}
            >
              📋 여기 붙여넣기 (Ctrl+V / ⌘V)
            </div>
          </div>
        </div>
      )}

      <EditorContent editor={editor} className="giAiReportEditorContent" />

      <GeneralInfoMobileFormatBubble
        active
        editorRef={editorDomRef}
        onCommand={runMobileCommand}
        onInsertChar={insertChar}
        textColors={MOBILE_PAPER_TEXT_COLORS}
        highlightColors={MOBILE_PAPER_HIGHLIGHTS}
        onImage={openImagePicker}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void insertMediaFiles(files, { removeTrigger: false });
        }}
      />
      <p className="giAiReportEditorHint">
        문장 끝에 <strong>S</strong> → 이미지/동영상. 이미지 위 <strong>×</strong>로 삭제.
        굵게·밑줄·크기·색·형광·①~⑩·서식 지우기도 사용할 수 있습니다.
      </p>
    </div>
  );
}
