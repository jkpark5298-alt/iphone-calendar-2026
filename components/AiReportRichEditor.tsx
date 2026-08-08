"use client";

import React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { AiReportFormatToolbar } from "./AiReportFormatToolbar";
import {
  normalizeAiReportEditorHtml,
  stepAiReportFontSize,
} from "../lib/aiReportEditor";

type Props = {
  html: string;
  onChange: (html: string) => void;
  onUploadImage?: (file: File) => Promise<string>;
};

export function AiReportRichEditor({ html, onChange, onUploadImage }: Props) {
  const onChangeRef = React.useRef(onChange);
  const lastEmittedRef = React.useRef(normalizeAiReportEditorHtml(html));
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [, bump] = React.useState(0);
  onChangeRef.current = onChange;

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
    ],
    content: normalizeAiReportEditorHtml(html || "<p></p>"),
    editorProps: {
      attributes: {
        class: "giAiReportTipTap",
      },
      handlePaste: (_view, event) => {
        const clipboard = event.clipboardData;
        if (!clipboard || !onUploadImage) return false;
        const files = Array.from(clipboard.files || []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        void (async () => {
          for (const file of files) {
            try {
              const src = await onUploadImage(file);
              if (!src || !editorRef.current) continue;
              editorRef.current
                .chain()
                .focus()
                .insertContent(`<img src="${src}" alt="${file.name || "이미지"}" />`)
                .run();
            } catch {
              // ignore single file failure
            }
          }
        })();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = normalizeAiReportEditorHtml(ed.getHTML());
      if (next === lastEmittedRef.current) return;
      lastEmittedRef.current = next;
      onChangeRef.current(next);
      bump((n) => n + 1);
    },
    onSelectionUpdate: () => bump((n) => n + 1),
    onTransaction: () => bump((n) => n + 1),
  });

  const editorRef = React.useRef<Editor | null>(null);
  editorRef.current = editor;

  React.useEffect(() => {
    if (!editor) return;
    const incoming = normalizeAiReportEditorHtml(html || "<p></p>");
    if (incoming === lastEmittedRef.current) return;
    const current = normalizeAiReportEditorHtml(editor.getHTML());
    if (incoming === current) {
      lastEmittedRef.current = incoming;
      return;
    }
    editor.commands.setContent(incoming, { emitUpdate: false });
    lastEmittedRef.current = incoming;
  }, [editor, html]);

  const currentFontPx = (() => {
    if (!editor) return 14;
    const raw = String(editor.getAttributes("textStyle").fontSize || "14px");
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 14;
  })();

  if (!editor) {
    return <div className="giAiReportEditorLoading">편집기 준비 중…</div>;
  }

  return (
    <div className="giAiReportEditorShell">
      <div className="giAiReportBodyLabel">편집 중 · 본문</div>
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
        onImage={onUploadImage ? () => fileRef.current?.click() : undefined}
      />
      <EditorContent editor={editor} />
      {onUploadImage && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void (async () => {
              for (const file of files) {
                try {
                  const src = await onUploadImage(file);
                  if (!src) continue;
                  editor.chain().focus().insertContent(
                    `<img src="${src}" alt="${file.name || "이미지"}" />`,
                  ).run();
                } catch {
                  // ignore
                }
              }
            })();
          }}
        />
      )}
      <p className="giAiReportEditorHint">
        굵게·밑줄·크기·글자색·형광·①~⑩·이미지. 이미지 붙여넣기도 가능합니다.
      </p>
    </div>
  );
}
