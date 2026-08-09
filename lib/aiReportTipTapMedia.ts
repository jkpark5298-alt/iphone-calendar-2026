import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import Image from "@tiptap/extension-image";

function makeMediaRemoveButton(onDelete: () => void) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "generalInfoInlineImageRemove";
  btn.setAttribute("contenteditable", "false");
  btn.setAttribute("aria-label", "미디어 삭제");
  btn.textContent = "×";
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  });
  return btn;
}

/** TipTap 이미지 — × 삭제가 있는 블록 */
export const AiReportImage = Image.extend({
  name: "image",
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current: ProseMirrorNode = node;
      const wrapper = document.createElement("div");
      wrapper.className = "generalInfoInlineImageBlock giAiReportInlineImageBlock";
      wrapper.setAttribute("data-gi-media", "1");
      wrapper.setAttribute("contenteditable", "false");

      const img = document.createElement("img");
      img.src = String(current.attrs.src || "");
      img.alt = String(current.attrs.alt || "보고서 이미지");
      img.className = "giAiReportInlineImage generalInfoInlineImage";
      img.setAttribute("draggable", "false");
      img.setAttribute("loading", "eager");

      const remove = () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos !== "number") return;
        editor.commands.deleteRange({ from: pos, to: pos + current.nodeSize });
      };

      wrapper.appendChild(img);
      wrapper.appendChild(makeMediaRemoveButton(remove));

      return {
        dom: wrapper,
        update: (updated) => {
          if (updated.type.name !== "image") return false;
          current = updated;
          img.src = String(updated.attrs.src || "");
          img.alt = String(updated.attrs.alt || "보고서 이미지");
          return true;
        },
      };
    };
  },
}).configure({
  inline: false,
  allowBase64: true,
  HTMLAttributes: {
    class: "giAiReportInlineImage",
  },
});

/** TipTap 동영상 — × 삭제가 있는 블록 */
export const AiReportVideo = Node.create({
  name: "video",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
    };
  },

  parseHTML() {
    return [
      {
        tag: "video[src]",
        getAttrs: (el) => {
          const video = el as HTMLVideoElement;
          return { src: video.getAttribute("src"), controls: true };
        },
      },
      {
        tag: 'div[data-gi-video="1"] video[src]',
        getAttrs: (el) => {
          const video = el as HTMLVideoElement;
          return { src: video.getAttribute("src"), controls: true };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      {
        class: "generalInfoInlineImageBlock giAiReportInlineVideoBlock",
        "data-gi-media": "1",
        "data-gi-video": "1",
      },
      [
        "video",
        mergeAttributes(HTMLAttributes, {
          controls: "true",
          playsinline: "true",
          "webkit-playsinline": "true",
          class: "giAiReportInlineVideo generalInfoInlineVideo",
        }),
      ],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current: ProseMirrorNode = node;
      const wrapper = document.createElement("div");
      wrapper.className = "generalInfoInlineImageBlock giAiReportInlineVideoBlock";
      wrapper.setAttribute("data-gi-media", "1");
      wrapper.setAttribute("data-gi-video", "1");
      wrapper.setAttribute("contenteditable", "false");

      const video = document.createElement("video");
      video.src = String(current.attrs.src || "");
      video.controls = true;
      video.className = "giAiReportInlineVideo generalInfoInlineVideo";
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.setAttribute("draggable", "false");

      const remove = () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos !== "number") return;
        editor.commands.deleteRange({ from: pos, to: pos + current.nodeSize });
      };

      wrapper.appendChild(video);
      wrapper.appendChild(makeMediaRemoveButton(remove));

      return {
        dom: wrapper,
        update: (updated) => {
          if (updated.type.name !== "video") return false;
          current = updated;
          video.src = String(updated.attrs.src || "");
          return true;
        },
      };
    };
  },
});
