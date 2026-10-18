"use client";

import type { CSSProperties } from "react";
import { imageFilesFromClipboard } from "../lib/compressImageFile";

function imageFiles(list: FileList | null) {
  return Array.from(list || []).filter((file) => {
    if (file.type.startsWith("image/")) return true;
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name);
  });
}

/** S. 또는 s. 로 만든 사진 칸에 사진찍기, 사진첩, 붙여넣기로 넣는 창. */
export function SlotImagePanel({
  onFiles,
  onClose,
  style,
}: {
  onFiles: (files: File[]) => void;
  onClose: () => void;
  style?: CSSProperties;
}) {
  const pick = (list: FileList | null) => {
    const files = imageFiles(list);
    if (list && list.length && !files.length) {
      alert("이미지 파일만 넣을 수 있습니다.");
      return;
    }
    if (!files.length) return;
    onFiles(files);
  };

  return (
    <div className="collectSlotImagePanel" role="dialog" aria-label="이미지 넣기" style={style}>
      <div className="collectSlotImagePanelHead">
        <strong>사진</strong>
        <span>이 칸에 사진을 찍거나, 사진첩에서 고르거나, 복사한 이미지를 붙여넣으세요.</span>
        <button type="button" className="secondaryButton" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="collectImageSourceRow">
        <label className="collectImageSourceBtn">
          사진찍기
          <input
            type="file"
            accept="image/*"
            capture="environment"
            title="카메라로 사진을 찍습니다"
            onChange={(event) => {
              pick(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className="collectImageSourceBtn">
          사진보관함
          <input
            type="file"
            accept="image/*"
            multiple
            title="사진보관함에서 여러 장을 선택할 수 있습니다"
            onChange={(event) => {
              pick(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <div
          className="collectImageSourceBtn slotImagePasteZone"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          tabIndex={0}
          aria-label="복사한 이미지 붙여넣기"
          onPaste={(event) => {
            const files = imageFilesFromClipboard(event.clipboardData);
            event.preventDefault();
            if (!files.length) {
              alert("복사한 이미지가 없습니다. 이미지를 복사한 뒤 여기에 붙여넣으세요.");
              return;
            }
            onFiles(files);
          }}
        >
          복사한 이미지 붙여넣기
        </div>
      </div>
    </div>
  );
}
