"use client";

import React from "react";
import type { GeneralInfoItem } from "../types/generalInfo";
import {
  downloadGeneralInfoAppFile,
  downloadGeneralInfoPdf,
  shareGeneralInfoPdfForGoodNotes,
} from "../lib/generalInfoExport";

type Props = {
  item: GeneralInfoItem;
  onClose: () => void;
  onPdfExported?: (item: GeneralInfoItem) => void;
  busyLabel?: string;
};

export function GeneralInfoExportActionsModal({ item, onClose, onPdfExported }: Props) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");

  const run = React.useCallback(
    async (label: string, action: () => Promise<unknown> | unknown) => {
      setBusy(label);
      setMessage("");
      try {
        const result = await action();
        if (label === "pdf" || label === "share") {
          onPdfExported?.(item);
        }
        if (label === "pdf") setMessage("PDF를 저장했습니다. 이미지는 잘리지 않도록 페이지에 맞춰 축소됩니다.");
        if (label === "share") {
          const mode = (result as { mode?: string } | undefined)?.mode;
          setMessage(
            mode === "share"
              ? "공유 시트를 열었습니다. GoodNotes를 선택하세요."
              : "이 기기는 파일 공유를 지원하지 않아 PDF를 다운로드했습니다. GoodNotes에서 해당 PDF를 가져오세요.",
          );
        }
        if (label === "app") setMessage("앱파일을 저장했습니다. 나중에 [앱파일 불러오기]로 복원할 수 있습니다.");
      } catch (error) {
        console.error(error);
        setMessage(error instanceof Error ? error.message : "작업에 실패했습니다.");
      } finally {
        setBusy(null);
      }
    },
    [item, onPdfExported],
  );

  return (
    <div
      className="overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(2, 6, 23, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 16,
      }}
    >
      <div
        className="modalCard"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(440px, 100%)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="modalHeader">
          <div>
            <span>저장 완료</span>
            <h3 style={{ margin: "6px 0 0", fontSize: 18 }}>{item.title}</h3>
          </div>
          <button className="iconButton" type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <div style={{ padding: "0 4px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="mutedText" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            PDF는 이미지가 잘리지 않도록 페이지에 맞춰 넣습니다. 공유는 GoodNotes에서 열 수 있는 PDF입니다.
          </p>

          <button
            type="button"
            className="primaryButton"
            disabled={!!busy}
            onClick={() => void run("pdf", () => downloadGeneralInfoPdf(item))}
          >
            {busy === "pdf" ? "PDF 작성 중…" : "PDF 저장"}
          </button>

          <button
            type="button"
            className="secondaryButton"
            disabled={!!busy}
            onClick={() => void run("share", () => shareGeneralInfoPdfForGoodNotes(item))}
          >
            {busy === "share" ? "공유 준비 중…" : "GoodNotes용 PDF 공유"}
          </button>

          <button
            type="button"
            className="secondaryButton"
            disabled={!!busy}
            onClick={() => void run("app", () => downloadGeneralInfoAppFile(item))}
          >
            {busy === "app" ? "앱파일 저장 중…" : "앱파일 저장 (.airzeta-gi.json)"}
          </button>

          {message && (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#7dd3fc", lineHeight: 1.5 }}>
              {message}
            </p>
          )}
        </div>

        <div className="modalFooter">
          <button className="secondaryButton" type="button" onClick={onClose} disabled={!!busy}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
