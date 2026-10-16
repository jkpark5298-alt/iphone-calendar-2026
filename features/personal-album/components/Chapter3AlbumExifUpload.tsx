"use client";

import { useRef, useState } from "react";
import {
  ALBUM_UPLOAD_MAX_FILES,
  ALBUM_UPLOAD_MAX_ROUNDS,
} from "../utils/albumUploadBatch";
import type { AddAlbumPhotosResult } from "../hooks/useTravelDiaryChapter3State";

export function Chapter3AlbumExifUpload({
  completedRounds,
  canSave,
  onUploaded,
  onSaveDraft,
  onConfirm,
}: {
  completedRounds: number;
  canSave: boolean;
  onUploaded: (
    files: File[],
    reportProgress: (percent: number) => void,
  ) => Promise<AddAlbumPhotosResult>;
  onSaveDraft: () => void;
  onConfirm: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const finished = completedRounds >= ALBUM_UPLOAD_MAX_ROUNDS;
  const roundLabel = finished
    ? `${ALBUM_UPLOAD_MAX_ROUNDS}회를 모두 올렸습니다`
    : `이번 ${completedRounds + 1}회 / ${ALBUM_UPLOAD_MAX_ROUNDS}회`;

  return (
    <div className="chapter3AlbumExifUpload">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        disabled={busy || finished}
        onChange={(event) => {
          const files = event.target.files;
          if (!files?.length || busy || finished) return;
          const selected = Array.from(files);
          event.target.value = "";
          setUploadPercent(0);
          setBusy(true);
          void Promise.resolve(onUploaded(selected, setUploadPercent)).finally(() => {
            setBusy(false);
            setUploadPercent(0);
          });
        }}
      />
      <button
        type="button"
        className="gradientButton"
        disabled={busy || finished}
        onClick={() => inputRef.current?.click()}
      >
        {finished ? "10회 완료" : busy ? `올리는 중 ${uploadPercent}%` : "사진 올리기"}
      </button>
      <p className="chapter3AlbumExifUploadCount">
        {busy ? `진행 ${uploadPercent}% · ` : ""}
        {roundLabel} · 1회 최대 {ALBUM_UPLOAD_MAX_FILES}장
      </p>
      <p>
        1회에 {ALBUM_UPLOAD_MAX_FILES}장까지, {ALBUM_UPLOAD_MAX_ROUNDS}회로 나눠 올립니다. 같은
        사진은 한 장만 들어갑니다. 촬영일이 있으면 날짜가 만들어지고, 같은 날은 시간순으로
        정렬됩니다. {ALBUM_UPLOAD_MAX_ROUNDS}회를 다 채우지 않아도 확정할 수 있습니다.
      </p>
      <div className="chapter3AlbumExifUploadActions">
        <button type="button" className="secondaryButton" disabled={!canSave} onClick={onSaveDraft}>
          작업 중 저장
        </button>
        <button type="button" className="gradientButton" disabled={!canSave} onClick={onConfirm}>
          확정
        </button>
      </div>
    </div>
  );
}
