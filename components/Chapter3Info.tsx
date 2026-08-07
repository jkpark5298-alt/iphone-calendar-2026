"use client";

/**
 * Chapter3Info.tsx
 * Chapter 3 — 일반 정보 수집 / 분류 / 저장
 * TravelDiaryApp의 "info" 탭 JSX 분리
 */

import React from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { insertInlineMediaIntoEditor, readFilesAsDataUrls, enhanceInlineImageBlocks, bindInlineImageRemoveHandler, editorHasInlineImageTrigger, removeInlineImageTrigger, dedupeImageFiles, collectClipboardImageFiles } from "../lib/generalInfoHelpers";
import { Card, EmptyState } from "./SharedComponents";

export interface Chapter3InfoProps {
  // Gemini API Key
  geminiApiKey: string;
  setGeminiApiKey: React.Dispatch<React.SetStateAction<string>>;

  // 탭
  generalInfoActiveTab: "storage" | "collect";
  setGeneralInfoActiveTab: React.Dispatch<React.SetStateAction<"storage" | "collect">>;

  // 레이아웃
  isGeneralInfoMobileLayout: boolean;

  // draft 상태
  generalInfoDraft: GeneralInfoDraft;
  setGeneralInfoDraft: React.Dispatch<React.SetStateAction<GeneralInfoDraft>>;
  generalInfoDraftBackup: GeneralInfoDraft | null;
  generalInfoEditingId: number | null;
  generalInfoImageLoadFailed: boolean;
  setGeneralInfoImageLoadFailed: (value: boolean) => void;
  generalInfoKeywordText: string;
  setGeneralInfoKeywordText: (value: string) => void;

  // Rich Text
  generalInfoRichTextEditorKey: number;
  generalInfoRichTextRef: React.RefObject<HTMLDivElement | null>;
  generalInfoRichTextInitialHtml: string;
  syncGeneralInfoRichTextToDraft: () => void;
  handleGeneralInfoRichPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  handleGeneralInfoRichCommand: (command: string, value?: string) => void;
  getGeneralInfoToolbarButtonStyle: () => React.CSSProperties;
  makeGeneralInfoHtmlFromText: (text: string) => string;

  // 핸들러
  handleUndoGeneralInfoDraft: () => void;
  handleResetGeneralInfoDraft: () => void;
  handleCollectGeneralInfoFromClipboard: () => void;
  isCollectingGeneralInfoClipboard: boolean;
  handleExtractGeneralInfoUrl: () => void;
  isExtractingGeneralInfoUrl: boolean;
  handleGeneralInfoFileUpload: (files: FileList | null) => void;
  handleGeneralInfoIphonePasteZonePaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  handleClearGeneralInfoCoverImage: () => void;
  handleRemoveGeneralInfoMediaItem: (index: number) => void;
  handleAnalyzeGeneralInfoDraft: () => void;
  isAnalyzingGeneralInfo: boolean;
  handleConfirmGeneralInfo: () => void;
  handleSaveTemporaryGeneralInfoDraft: () => void;
  handleCancelEditGeneralInfo: () => void;

  // 저장함
  generalInfoItems: GeneralInfoItem[];
  filteredGeneralInfoItems: GeneralInfoItem[];
  generalInfoSearchTerm: string;
  setGeneralInfoSearchTerm: (value: string) => void;
  generalInfoDetailId: number | null;
  setGeneralInfoDetailId: (id: number | null) => void;
  handleTogglePinGeneralInfo: (itemId: number) => void;
  loadGeneralInfoItemsFromSupabase: () => Promise<void>;
  generalInfoSupabaseStatus: string;

  // 카테고리 & 헬퍼
  generalInfoCategories: string[];
  normalizeGeneralInfoMediaItems: (draft: GeneralInfoDraft) => GeneralInfoMediaItem[];
  getGeneralInfoDisplayMediaItems: (item: GeneralInfoItem) => GeneralInfoMediaItem[];
  onOpenStorageImage?: (url: string, fileName?: string) => void;
}

export function Chapter3Info({
  geminiApiKey,
  setGeminiApiKey,
  generalInfoActiveTab,
  setGeneralInfoActiveTab,
  isGeneralInfoMobileLayout,
  generalInfoDraft,
  setGeneralInfoDraft,
  generalInfoDraftBackup,
  generalInfoEditingId,
  generalInfoImageLoadFailed,
  setGeneralInfoImageLoadFailed,
  generalInfoKeywordText,
  setGeneralInfoKeywordText,
  generalInfoRichTextEditorKey,
  generalInfoRichTextRef,
  generalInfoRichTextInitialHtml,
  syncGeneralInfoRichTextToDraft,
  handleGeneralInfoRichPaste,
  handleGeneralInfoRichCommand,
  getGeneralInfoToolbarButtonStyle,
  makeGeneralInfoHtmlFromText,
  handleUndoGeneralInfoDraft,
  handleResetGeneralInfoDraft,
  handleCollectGeneralInfoFromClipboard,
  isCollectingGeneralInfoClipboard,
  handleExtractGeneralInfoUrl,
  isExtractingGeneralInfoUrl,
  handleGeneralInfoFileUpload,
  handleGeneralInfoIphonePasteZonePaste,
  handleClearGeneralInfoCoverImage,
  handleRemoveGeneralInfoMediaItem,
  handleAnalyzeGeneralInfoDraft,
  isAnalyzingGeneralInfo,
  handleConfirmGeneralInfo,
  handleSaveTemporaryGeneralInfoDraft,
  handleCancelEditGeneralInfo,
  generalInfoItems,
  filteredGeneralInfoItems,
  generalInfoSearchTerm,
  setGeneralInfoSearchTerm,
  generalInfoDetailId,
  setGeneralInfoDetailId,
  handleTogglePinGeneralInfo,
  loadGeneralInfoItemsFromSupabase,
  generalInfoSupabaseStatus,
  generalInfoCategories,
  normalizeGeneralInfoMediaItems,
  getGeneralInfoDisplayMediaItems,
  onOpenStorageImage,
}: Chapter3InfoProps) {
  const activeTab = generalInfoActiveTab;
  const setActiveTab = setGeneralInfoActiveTab;
  const [memoEditIndex, setMemoEditIndex] = React.useState<number | null>(null);
  const [isConfigOpen, setIsConfigOpen] = React.useState(false);

  // 미디어 아이템 메모 업데이트
  const handleUpdateMediaMemo = React.useCallback((index: number, memo: string) => {
    setGeneralInfoDraft(prev => {
      const items = normalizeGeneralInfoMediaItems(prev);
      const updated = items.map((m, i) => i === index ? { ...m, memo } : m);
      const main = updated[0];
      return {
        ...prev,
        fileName: main?.name || prev.fileName,
        filePreview: main?.preview || prev.filePreview,
        fileType: main?.type || prev.fileType,
        mediaItems: updated,
      };
    });
  }, [normalizeGeneralInfoMediaItems, setGeneralInfoDraft]);

  // 대표 미디어 아이템 설정 (Swap 방식)
  const handleSetMediaAsRepresentative = React.useCallback((index: number) => {
    setGeneralInfoDraft(prev => {
      const items = normalizeGeneralInfoMediaItems(prev);
      if (index <= 0 || index >= items.length) return prev;
      
      const updated = [...items];
      const temp = updated[0];
      updated[0] = updated[index];
      updated[index] = temp;
      
      const main = updated[0];
      return {
        ...prev,
        fileName: main?.name || prev.fileName,
        filePreview: main?.preview || prev.filePreview,
        fileType: main?.type || prev.fileType,
        mediaItems: updated,
      };
    });
  }, [normalizeGeneralInfoMediaItems, setGeneralInfoDraft]);
  const [tempApiKey, setTempApiKey] = React.useState(geminiApiKey);
  const [keyValidationStatus, setKeyValidationStatus] = React.useState<"idle" | "validating" | "valid" | "invalid">("idle");
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [showSourceUrlHelp, setShowSourceUrlHelp] = React.useState(false);
  const [showTextImageInsert, setShowTextImageInsert] = React.useState(false);
  const [copyFeedback, setCopyFeedback] = React.useState<"text" | "fact" | null>(null);
  const textImageFileRef = React.useRef<HTMLInputElement | null>(null);

  // Sync tempApiKey and validate on mount if geminiApiKey exists
  React.useEffect(() => {
    setTempApiKey(geminiApiKey);
    if (geminiApiKey) {
      const verifyOnMount = async () => {
        setKeyValidationStatus("validating");
        try {
          const res = await fetch("/api/test", {
            headers: {
              "x-gemini-api-key": geminiApiKey
            }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.geminiApiTest?.ok) {
              setKeyValidationStatus("valid");
              setValidationError(null);
            } else {
              setKeyValidationStatus("invalid");
              setValidationError(data.geminiApiTest?.details || data.geminiApiTest?.message || "유효하지 않은 키입니다.");
            }
          } else {
            setKeyValidationStatus("invalid");
            setValidationError(`HTTP error: ${res.status}`);
          }
        } catch (err: any) {
          setKeyValidationStatus("invalid");
          setValidationError(err.message || "네트워크 오류");
        }
      };
      void verifyOnMount();
    } else {
      setKeyValidationStatus("idle");
      setValidationError(null);
    }
  }, [geminiApiKey]);

  const handleVerifyAndSaveKey = async () => {
    if (!tempApiKey.trim()) {
      setKeyValidationStatus("idle");
      setValidationError("API Key를 입력해주세요.");
      return;
    }
    setKeyValidationStatus("validating");
    setValidationError(null);
    try {
      const res = await fetch("/api/test", {
        headers: {
          "x-gemini-api-key": tempApiKey.trim()
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.geminiApiTest?.ok) {
          setKeyValidationStatus("valid");
          setGeminiApiKey(tempApiKey.trim());
          setIsConfigOpen(false); // Close config and return to original screen
        } else {
          setKeyValidationStatus("invalid");
          setValidationError(data.geminiApiTest?.details || data.geminiApiTest?.message || "유효하지 않은 키입니다.");
        }
      } else {
        setKeyValidationStatus("invalid");
        setValidationError(`HTTP error: ${res.status}`);
      }
    } catch (err: any) {
      setKeyValidationStatus("invalid");
      setValidationError(err.message || "네트워크 오류");
    }
  };

  const handleClearKey = () => {
    setGeminiApiKey("");
    setTempApiKey("");
    setKeyValidationStatus("idle");
    setValidationError(null);
  };

  React.useEffect(() => {
    if (generalInfoRichTextRef && "current" in generalInfoRichTextRef && generalInfoRichTextRef.current) {
      // Only set initial HTML on mount/reset to prevent React cursor jumps during typing
      generalInfoRichTextRef.current.innerHTML = generalInfoRichTextInitialHtml;
      enhanceInlineImageBlocks(generalInfoRichTextRef.current);
      bindInlineImageRemoveHandler(generalInfoRichTextRef.current);
    }
  }, [generalInfoRichTextEditorKey, generalInfoRichTextInitialHtml, generalInfoRichTextRef]);

  const textEndsWithImageTrigger = React.useCallback((raw: string) => {
    const text = String(raw || "").replace(/\u00a0/g, " ").replace(/\r/g, "");
    const trimmedEnd = text.replace(/[ \t\n]+$/g, "");
    // 문자 끝에 S/s를 붙이면 이미지 붙여넣기 패널 표시
    return /[Ss]$/.test(trimmedEnd);
  }, []);

  const removeTrailingImageTrigger = React.useCallback(() => {
    return removeInlineImageTrigger(generalInfoRichTextRef.current);
  }, [generalInfoRichTextRef]);

  const checkTextImageTrigger = React.useCallback(() => {
    const editor = generalInfoRichTextRef.current;
    const plain = String(editor?.innerText || "");
    setShowTextImageInsert(
      editorHasInlineImageTrigger(editor) || textEndsWithImageTrigger(plain),
    );
  }, [generalInfoRichTextRef, textEndsWithImageTrigger]);

  const insertImageFilesFromTextTrigger = React.useCallback((files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const afterNode = removeTrailingImageTrigger();

    const list = dedupeImageFiles(files instanceof FileList ? Array.from(files) : files);
    const mediaFiles = list.filter(
      (file) =>
        file.type.startsWith("image/") ||
        file.type.startsWith("video/") ||
        /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov|webm)$/i.test(file.name || ""),
    );
    if (!mediaFiles.length) {
      alert("이미지/동영상 파일을 선택해 주세요.");
      return;
    }

    void (async () => {
      try {
        const loaded = await readFilesAsDataUrls(mediaFiles);
        const editor = generalInfoRichTextRef.current;
        if (editor) {
          insertInlineMediaIntoEditor(
            editor,
            loaded
              .filter((item) => item.dataUrl)
              .map(({ file, dataUrl }) => ({
                src: dataUrl,
                name: file.name,
                type: file.type.startsWith("video/") ? "video" : "image",
              })),
            { afterNode },
          );
          syncGeneralInfoRichTextToDraft();
        }

        // 본문 인라인 삽입만 수행 (갤러리 중복 추가하지 않음)
      } catch (error) {
        console.error("inline image insert failed", error);
        alert("이미지를 본문 TEXT에 넣지 못했습니다. 다시 시도해 주세요.");
      } finally {
        setShowTextImageInsert(false);
      }
    })();
  }, [generalInfoRichTextRef, removeTrailingImageTrigger, syncGeneralInfoRichTextToDraft]);

  const handleTextImageInsertPaste = React.useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const pastedFiles = collectClipboardImageFiles(event.clipboardData);
    if (pastedFiles.length > 0) {
      insertImageFilesFromTextTrigger(pastedFiles);
    }
  }, [insertImageFilesFromTextTrigger]);

  const copyPlainTextToClipboard = React.useCallback(async (text: string, kind: "text" | "fact") => {
    const value = String(text || "").replace(/\u00a0/g, " ").trim();
    if (!value) {
      alert(kind === "text" ? "복사할 Text가 없습니다." : "복사할 Fact Check 결과가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(kind);
      window.setTimeout(() => {
        setCopyFeedback((prev) => (prev === kind ? null : prev));
      }, 1800);
    } catch {
      alert("클립보드 복사에 실패했습니다.");
    }
  }, []);

  const handleCopyGeneralInfoText = React.useCallback(() => {
    syncGeneralInfoRichTextToDraft();
    const fromEditor = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");
    void copyPlainTextToClipboard(fromEditor || generalInfoDraft.text || "", "text");
  }, [copyPlainTextToClipboard, generalInfoDraft.text, generalInfoRichTextRef, syncGeneralInfoRichTextToDraft]);

  const handleCopyFactCheckResult = React.useCallback(() => {
    const status = String(generalInfoDraft.factCheckStatus || "확인 전").trim();
    const summary = String(generalInfoDraft.factCheckSummary || "").trim();
    const combined = [`[Fact Check 상태] ${status}`, summary].filter(Boolean).join("\n\n");
    void copyPlainTextToClipboard(combined, "fact");
  }, [copyPlainTextToClipboard, generalInfoDraft.factCheckStatus, generalInfoDraft.factCheckSummary]);

  const renderGeminiKeyButton = () => {
    if (keyValidationStatus === "valid") {
      return (
        <button
          type="button"
          onClick={() => setIsConfigOpen(!isConfigOpen)}
          style={{
            padding: "4px 10px",
            fontSize: "12px",
            borderRadius: "6px",
            background: "rgba(74, 222, 128, 0.15)",
            color: "#4ade80",
            border: "1px solid rgba(74, 222, 128, 0.3)",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ● Gemini API Key 등록 완료
        </button>
      );
    }
    if (keyValidationStatus === "invalid") {
      return (
        <button
          type="button"
          onClick={() => setIsConfigOpen(!isConfigOpen)}
          style={{
            padding: "4px 10px",
            fontSize: "12px",
            borderRadius: "6px",
            background: "rgba(248, 113, 113, 0.15)",
            color: "#f87171",
            border: "1px solid rgba(248, 113, 113, 0.3)",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ● Gemini API Key 불일치 (재등록)
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setIsConfigOpen(!isConfigOpen)}
        style={{
          padding: "4px 10px",
          fontSize: "12px",
          borderRadius: "6px",
          background: "rgba(56, 189, 248, 0.15)",
          color: "#38bdf8",
          border: "1px solid rgba(56, 189, 248, 0.3)",
          cursor: "pointer",
          fontWeight: "bold",
        }}
      >
        🔑 Gemini API Key 등록
      </button>
    );
  };

  const renderGeminiConfigBox = () => (
    isConfigOpen ? (
      <div
        className="geminiKeyBox"
        style={{
          marginBottom: "20px",
          padding: "15px 18px",
          borderRadius: "14px",
          border: keyValidationStatus === "invalid" ? "1px solid rgba(248, 113, 113, 0.4)" : "1px solid rgba(56, 189, 248, 0.3)",
          background: keyValidationStatus === "invalid" ? "rgba(248, 113, 113, 0.04)" : "rgba(14, 165, 233, 0.04)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
          <strong style={{ color: "#38bdf8", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
            🤖 Google Gemini API Key 설정
          </strong>
          <span style={{ fontSize: "11px", color: keyValidationStatus === "valid" ? "#4ade80" : keyValidationStatus === "invalid" ? "#f87171" : keyValidationStatus === "validating" ? "#38bdf8" : "#94a3b8", fontWeight: "bold" }}>
            {keyValidationStatus === "valid" && "● API 키 등록 완료"}
            {keyValidationStatus === "invalid" && "● API 키 오류 (불일치)"}
            {keyValidationStatus === "validating" && "● 검증 중..."}
            {keyValidationStatus === "idle" && "○ API 키 등록 필요"}
          </span>
        </div>
        <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0, lineHeight: 1.5 }}>
          AI 이미지 텍스트 추출(OCR), 자동 분류, 요약, Fact Check 기능은 Gemini API Key를 통해 동작합니다.
        </p>
        <div style={{ display: "flex", gap: "8px", width: "100%", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
            <input
              type="password"
              value={tempApiKey}
              onChange={(e) => setTempApiKey(e.target.value)}
              placeholder="AI 기능을 사용하려면 여기에 Gemini API Key를 입력하세요"
              style={{
                flex: 1,
                borderRadius: "10px",
                border: keyValidationStatus === "invalid" ? "1px solid rgba(248, 113, 113, 0.4)" : "1px solid rgba(56, 189, 248, 0.2)",
                background: "#020617",
                color: "#e2e8f0",
                padding: "8px 12px",
                fontSize: "13px",
              }}
            />
            <button
              type="button"
              className="primaryButton"
              onClick={handleVerifyAndSaveKey}
              disabled={keyValidationStatus === "validating"}
              style={{
                padding: "0 14px",
                fontSize: "13px",
                fontWeight: 700,
                borderRadius: "10px",
                cursor: "pointer",
              }}
            >
              {keyValidationStatus === "validating" ? "검증 중..." : "확인"}
            </button>
            {geminiApiKey && (
              <button
                type="button"
                className="secondaryButton"
                onClick={handleClearKey}
                style={{
                  padding: "0 12px",
                  fontSize: "12px",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  borderRadius: "10px",
                  borderColor: "rgba(248, 113, 113, 0.3)",
                  background: "rgba(248, 113, 113, 0.1)",
                  color: "#f87171",
                  cursor: "pointer",
                }}
              >
                삭제
              </button>
            )}
          </div>
          {validationError && (
            <div style={{ fontSize: "12px", color: "#f87171", marginTop: "4px" }}>
              ⚠️ {validationError}
            </div>
          )}
        </div>
      </div>
    ) : null
  );

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "hidden" }}>
      {/* ===== 탭 버튼 ===== */}
      <div className="ch3TabBar">
        <button
          type="button"
          className={`ch3TabBtn ${activeTab === "storage" ? "active" : ""}`}
          onClick={() => {
            setShowTextImageInsert(false);
            setActiveTab("storage");
          }}
        >
          🗂️ 정보 창고
        </button>
        <button
          type="button"
          className={`ch3TabBtn ${activeTab === "collect" ? "active" : ""}`}
          onClick={() => setActiveTab("collect")}
        >
          ✍️ 일반 정보 수집
        </button>
      </div>

      {/* ===== 정보 수집 탭 (입력 + AI 분류) ===== */}
      {activeTab === "collect" && (
      <section className="leftColumn generalInfoLeftColumn" style={{ position: "relative", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        {/* Scroll to Top Button */}
        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            if (window.innerWidth <= 1100) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              e.currentTarget.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="맨위로"
        >맨 위로 ↑</button>

        <div className="chapterTitleBox" style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {renderGeminiKeyButton()}
          </div>
          <p style={{ margin: "4px 0 0 0" }}>
            일반 정보 수집하고 AI 분류, Fact Check, 검색 기능 수행
          </p>
        </div>
        {renderGeminiConfigBox()}

        <Card
          number="1"
          title="일반 정보 수집"
          subtitle="Text / 이미지 / 동영상 / URL을 단독 또는 복수로 입력합니다."
          actions={
            <>
              <button
                className="secondaryButton cardHeaderActionBtn"
                type="button"
                onClick={handleUndoGeneralInfoDraft}
                disabled={!generalInfoDraftBackup}
                style={{
                  borderColor: generalInfoDraftBackup ? "rgba(234, 179, 8, 0.4)" : "rgba(148, 163, 184, 0.2)",
                  background: generalInfoDraftBackup ? "rgba(234, 179, 8, 0.15)" : "rgba(148, 163, 184, 0.05)",
                  color: generalInfoDraftBackup ? "#facc15" : "#64748b",
                  cursor: generalInfoDraftBackup ? "pointer" : "not-allowed",
                }}
              >
                되돌리기
              </button>
              <button
                className="dangerButton cardHeaderActionBtn"
                type="button"
                onClick={handleResetGeneralInfoDraft}
              >
                삭제
              </button>
            </>
          }
        >
          {generalInfoEditingId && (
            <div className="generalInfoEditNotice">
              <strong>수정 모드</strong>
              <p>
                저장된 일반 정보를 불러왔습니다. 제목, URL, Text, 이미지, 분류를
                수정한 뒤 [수정 저장]을 누르세요.
              </p>
            </div>
          )}

          <label className="generalInfoFieldLabel">
            정보 제목
            <input
              value={generalInfoDraft.title}
              onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="예: 반도체 공급망 정책 자료"
            />
          </label>

          {/* Rich Text Editor */}
          <div className="generalInfoTextBox generalInfoRichTextBox">
            <div className="generalInfoRichTextHeader">
              <div className="generalInfoSectionTitleRow">
                <strong>Text 입력 / 편집</strong>
                <button
                  type="button"
                  className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                  onClick={handleCopyGeneralInfoText}
                >
                  {copyFeedback === "text" ? "✅ 복사됨" : "📋 전체 복사"}
                </button>
              </div>
              <span>아래 큰 입력칸에 내용을 입력하세요. 줄바꿈, 띄어쓰기, 글자색, 굵게, 밑줄 편집 가능</span>
            </div>

            <div
              className="generalInfoRichToolbar"
              aria-label="Text 편집 도구"
            >
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGeneralInfoRichCommand("bold")}>B 굵게</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGeneralInfoRichCommand("underline")}>U 밑줄</button>
              <button
                type="button"
                style={getGeneralInfoToolbarButtonStyle()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleGeneralInfoRichCommand("removeFormat")}
              >
                서식 지우기
              </button>
              <button type="button" className="generalInfoRichColorDefault" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGeneralInfoRichCommand("foreColor", "#e2e8f0")}>● 기본</button>
              <button type="button" className="generalInfoRichColorRed" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGeneralInfoRichCommand("foreColor", "#f87171")}>● 빨강</button>
              <button type="button" className="generalInfoRichColorYellow" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGeneralInfoRichCommand("foreColor", "#facc15")}>● 노랑</button>
              <button type="button" className="generalInfoRichColorBlue" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGeneralInfoRichCommand("foreColor", "#60a5fa")}>● 파랑</button>
              <button type="button" className="generalInfoRichColorGreen" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGeneralInfoRichCommand("foreColor", "#4ade80")}>● 초록</button>
            </div>

            <div
              key={generalInfoRichTextEditorKey}
              ref={generalInfoRichTextRef}
              className="generalInfoRichTextEditor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              onInput={checkTextImageTrigger}
              onKeyUp={checkTextImageTrigger}
              onBlur={(e) => {
                // 포커스가 버튼으로 이동할 때는 sync 생략 (버튼 핸들러가 직접 최신 텍스트를 읽음)
                const rel = e.relatedTarget as HTMLElement | null;
                if (rel && (rel.tagName === "BUTTON" || rel.closest?.("button"))) return;
                syncGeneralInfoRichTextToDraft();
                checkTextImageTrigger();
              }}
              onPaste={(event) => {
                handleGeneralInfoRichPaste(event);
                requestAnimationFrame(checkTextImageTrigger);
              }}
              data-placeholder="기사 내용, 보고서 요약, 복사한 텍스트, 메모를 입력하세요."
              style={{
                display: "block",
                width: "100%",
                minHeight: 260,
                maxHeight: 560,
                overflowY: "auto",
                boxSizing: "border-box",
                borderRadius: 14,
                border: "1px solid rgba(56, 189, 248, 0.45)",
                background: "#020617",
                color: "#e2e8f0",
                padding: "14px 15px",
                fontSize: 15,
                lineHeight: 1.8,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            />

            {showTextImageInsert && (
              <div className="generalInfoTextImageInsertPanel">
                <div className="generalInfoTextImageInsertHead">
                  <strong>이미지 붙여넣기</strong>
                  <span>문자 끝 S 감지 · 본문 TEXT 안에 이미지가 들어갑니다</span>
                  <button
                    type="button"
                    className="secondaryButton smallActionButton"
                    onClick={() => {
                      removeTrailingImageTrigger();
                      setShowTextImageInsert(false);
                    }}
                  >
                    닫기
                  </button>
                </div>
                <div className="generalInfoTextImageInsertActions">
                  <label className="primaryLabel generalInfoTextImageFileLabel">
                    🖼 사진첩 · 파일 선택
                    <input
                      ref={textImageFileRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={(e) => {
                        insertImageFilesFromTextTrigger(e.target.files);
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
                    onPaste={handleTextImageInsertPaste}
                  >
                    📋 아이폰·PC 이미지 여기 붙여넣기 (Ctrl+V / ⌘V)
                  </div>
                </div>
              </div>
            )}

            <p className="generalInfoRichTextNote">
              AI 분석에는 서식을 제외한 순수 Text가 사용되고, 저장함에는 편집된 색상/강조가 함께 표시됩니다.
              문장 끝에 <strong>S</strong>를 붙이면 이미지 붙여넣기가 열리고, 선택한 이미지는 본문 TEXT 안에 들어갑니다.
            </p>
          </div>

          <div className="generalInfoSourceUrlBlock">
            <div className="generalInfoSourceUrlLabelRow">
              <label className="generalInfoFieldLabel" style={{ flex: 1, marginBottom: 0 }}>
                출처 URL
              </label>
              <button
                type="button"
                className={`secondaryButton smallActionButton ${showSourceUrlHelp ? "activeHelpBtn" : ""}`}
                onClick={() => setShowSourceUrlHelp((prev) => !prev)}
                aria-expanded={showSourceUrlHelp}
              >
                {showSourceUrlHelp ? "설명 닫기" : "설명"}
              </button>
            </div>
            {showSourceUrlHelp && (
              <div className="generalInfoAutoGuide">
                <strong>자동 입력 안내</strong>
                <p>
                  URL을 입력한 뒤 [URL 내용 자동 가져오기]를 누르면 제목, 본문 Text,
                  대표 이미지가 자동 입력됩니다. 이후 [AI 자동분류]로 분류와 키워드를 생성하세요.
                </p>
              </div>
            )}
            <input
              value={generalInfoDraft.sourceUrl}
              onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleExtractGeneralInfoUrl();
                }
              }}
              placeholder="https://..."
            />
            <button
              className="secondaryButton urlExtractButton"
              type="button"
              onClick={handleExtractGeneralInfoUrl}
              disabled={isExtractingGeneralInfoUrl}
            >
              {isExtractingGeneralInfoUrl ? "URL 가져오는 중..." : "URL 내용 자동 가져오기"}
            </button>
          </div>

          <div className="generalInfoClipboardBox">
            <div>
              <strong>복사 붙여넣기 자동 수집</strong>
              <p>
                외부 앱이나 웹페이지에서 복사한 Text, URL, 이미지를 자동으로
                일반 정보 입력칸에 반영합니다.
              </p>
            </div>
            <button
              className="secondaryButton"
              type="button"
              onClick={handleCollectGeneralInfoFromClipboard}
              disabled={isCollectingGeneralInfoClipboard}
            >
              {isCollectingGeneralInfoClipboard ? "클립보드 확인 중..." : "📋 클립보드에서 일반 정보 붙여넣기"}
            </button>
          </div>

          {/* 이미지/동영상 업로드 */}
          <div className="generalInfoUploadBox">
            <div>
              <strong>이미지 / 동영상 자료</strong>
              <p>이미지+Text, 동영상+Text, URL+Text 조합으로 저장할 수 있습니다. 동영상 AI 분석은 2차 단계에서 연결합니다.</p>
            </div>
            <label className="primaryLabel">
              이미지/동영상 선택
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(e) => handleGeneralInfoFileUpload(e.target.files)}
              />
            </label>
          </div>

          {/* 아이폰 붙여넣기 존 */}
          <div
            className="generalInfoIphonePasteZone"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            tabIndex={0}
            onPaste={handleGeneralInfoIphonePasteZonePaste}
            style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", padding: "15px", cursor: "pointer" }}
          >
            <strong>📱 아이폰 이미지/인스타 링크 붙여넣기</strong>
          </div>

          {/* 대표 이미지 */}
          <div className="generalInfoCoverImageBox">
            <div className="generalInfoCoverImageHeader">
              <strong>대표 이미지 / 자료</strong>
              {normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0 && (
                <span className="generalInfoMediaCount">
                  총 {normalizeGeneralInfoMediaItems(generalInfoDraft).length}개
                </span>
              )}
              {normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0 && (
                <button
                  className="secondaryButton smallActionButton"
                  type="button"
                  onClick={handleClearGeneralInfoCoverImage}
                >
                  전체 삭제
                </button>
              )}
            </div>

            {normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0 ? (
              <div className="generalInfoDraftMediaGrid">
                {normalizeGeneralInfoMediaItems(generalInfoDraft).map((media, index) => {
                  const isEditingMemo = memoEditIndex === index;
                  const hasMemo = !!media.memo?.trim();
                  return (
                    <div className={`generalInfoDraftMediaCard ${index === 0 ? "representative-card" : ""}`} key={media.id || index}>
                      {index === 0 ? (
                        <div className="generalInfoDraftMediaBadge representative">
                          ★ 대표
                        </div>
                      ) : (
                        <div
                          className="generalInfoDraftMediaBadge select-representative"
                          onClick={() => handleSetMediaAsRepresentative(index)}
                          title="대표 이미지로 설정"
                        >
                          ★ 대표 설정
                        </div>
                      )}
                      {/* 이미지/동영상 — 클릭 시 메모 입력 토글 */}
                      <div
                        className="generalInfoDraftMediaThumb"
                        onClick={() => setMemoEditIndex(isEditingMemo ? null : index)}
                        title="클릭하면 메모 입력/수정"
                      >
                        {media.type === "video" ? (
                          <video src={media.preview} controls onClick={e => e.stopPropagation()} />
                        ) : generalInfoImageLoadFailed && index === 0 ? (
                          <div className="generalInfoImageFallback">
                            <strong>이미지 로드 실패</strong>
                            <p>이미지를 다시 복사해 붙여넣기로 교체하세요.</p>
                          </div>
                        ) : (
                          <img
                            src={media.preview}
                            alt={media.name || `자료 이미지 ${index + 1}`}
                            onError={() => { if (index === 0) setGeneralInfoImageLoadFailed(true); }}
                            onClick={(e) => {
                              if (!onOpenStorageImage || media.type === "video") return;
                              e.stopPropagation();
                              onOpenStorageImage(media.preview, media.name || `general_info_${index + 1}.jpg`);
                            }}
                            style={{ cursor: onOpenStorageImage ? "zoom-in" : undefined }}
                          />
                        )}
                        <div className="generalInfoDraftMediaHint">
                          {isEditingMemo ? "▲ 닫기" : (hasMemo ? "✏️ 메모 수정" : "＋ 메모 추가")}
                        </div>
                      </div>

                      {/* 메모 입력 영역 */}
                      {isEditingMemo && (
                        <div className="generalInfoMediaMemoEdit">
                          <textarea
                            className="generalInfoMediaMemoTextarea"
                            value={media.memo || ""}
                            onChange={e => handleUpdateMediaMemo(index, e.target.value)}
                            placeholder="이미지에 대한 간단한 메모를 입력하세요..."
                            rows={3}
                            autoFocus
                          />
                          <div className="generalInfoMediaMemoEditActions">
                            <button
                              type="button"
                              className="generalInfoMediaMemoBtnOk"
                              onClick={() => setMemoEditIndex(null)}
                            >
                              ✓ 완료
                            </button>
                            {hasMemo && (
                              <button
                                type="button"
                                className="generalInfoMediaMemoBtnDelete"
                                onClick={() => { handleUpdateMediaMemo(index, ""); setMemoEditIndex(null); }}
                              >
                                ✕ 메모 삭제
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 저장된 메모 표시 (편집 모드 아닐 때) */}
                      {!isEditingMemo && hasMemo && (
                        <div className="generalInfoMediaMemoDisplay">
                          <span className="generalInfoMediaMemoText">{media.memo}</span>
                          <div className="generalInfoMediaMemoActions">
                            <button
                              type="button"
                              className="generalInfoMediaMemoBtn generalInfoMediaMemoBtnEdit"
                              onClick={() => setMemoEditIndex(index)}
                              title="메모 수정"
                            >
                              (0)
                            </button>
                            <button
                              type="button"
                              className="generalInfoMediaMemoBtn generalInfoMediaMemoBtnDel"
                              onClick={() => handleUpdateMediaMemo(index, "")}
                              title="메모 삭제"
                            >
                              (-)
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 파일명 + 삭제 버튼 */}
                      <div className="generalInfoDraftMediaFooter">
                        <span className="generalInfoDraftMediaName">{media.name || `자료 이미지 ${index + 1}`}</span>
                        <button
                          className="secondaryButton smallActionButton dangerSmallButton"
                          type="button"
                          onClick={() => handleRemoveGeneralInfoMediaItem(index)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="generalInfoNoCoverImage">
                <strong>대표 이미지 없음</strong>
                <p>
                  URL에서 대표 이미지를 찾지 못했거나 아직 이미지를 추가하지 않았습니다.
                  웹페이지나 사진앱에서 이미지를 복사한 뒤
                  [클립보드에서 일반 정보 붙여넣기]를 누르면 대표 이미지로 등록됩니다.
                </p>
              </div>
            )}
          </div>

          <div className="generalInfoActionRow">
            <button
              className="primaryButton"
              onClick={handleAnalyzeGeneralInfoDraft}
              disabled={isAnalyzingGeneralInfo}
            >
              {isAnalyzingGeneralInfo ? "🤖 Gemini 분석 중..." : "🤖 AI 자동분류"}
            </button>
            <button className="gradientButton" onClick={handleConfirmGeneralInfo}>
              {generalInfoEditingId ? "수정 저장" : "Confirm 저장"}
            </button>
            <button
              className="secondaryButton"
              type="button"
              onClick={handleSaveTemporaryGeneralInfoDraft}
              style={{ background: "rgba(122, 184, 255, 0.12)", color: "#7ab8ff", border: "1px solid rgba(122, 184, 255, 0.25)" }}
            >
              💾 임시 저장
            </button>
            {generalInfoEditingId && (
              <button className="secondaryButton" type="button" onClick={handleCancelEditGeneralInfo}>
                수정 취소
              </button>
            )}
          </div>
        </Card>

        {/* Card 2: AI 분류 / 키워드 / Fact Check */}
        <Card
          number="2"
          title="AI 분류 / 키워드 / Fact Check"
          subtitle="자동분류 결과를 확인하고 필요하면 수정한 뒤 Confirm 저장합니다."
        >
          <div className="generalInfoGrid">
            <label>
              1차 분류
              <select
                value={generalInfoDraft.primaryCategory}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, primaryCategory: e.target.value }))}
              >
                <option value="">자동분류 전</option>
                {generalInfoCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
                {!generalInfoCategories.includes("기타") && <option value="기타">기타</option>}
              </select>
            </label>
            <label>
              2차 분류
              <input
                className="generalInfoEditableInput"
                value={generalInfoDraft.secondaryCategory}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, secondaryCategory: e.target.value }))}
                placeholder="예: 외교/해외동향"
              />
            </label>
            <label>
              3차 분류
              <input
                className="generalInfoEditableInput"
                value={generalInfoDraft.thirdCategory}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, thirdCategory: e.target.value }))}
                placeholder="예: 반도체 / 공급망"
              />
            </label>
          </div>

          <div className="generalInfoResultBox generalInfoKeywordInputBox">
            <strong>키워드 직접 입력</strong>
            <input
              value={generalInfoKeywordText}
              onChange={(e) => {
                const value = e.target.value;
                const parsedKeywords = Array.from(
                  new Set(
                    value
                      .split(/[,#\n]+/)
                      .map((kw) => kw.replace(/^#+/, "").trim())
                      .filter(Boolean),
                  ),
                ).slice(0, 12);
                setGeneralInfoKeywordText(value);
                setGeneralInfoDraft((prev) => ({ ...prev, keywords: parsedKeywords }));
              }}
              placeholder="예: #npm, #run, #dev 또는 npm, run, dev"
            />
            <p className="mutedText">
              쉼표, #, 줄바꿈으로 여러 키워드를 입력할 수 있습니다. 입력창에는 원문이 유지되고, 아래 태그에는 분리되어 표시됩니다.
            </p>
          </div>

          <div className="generalInfoResultBox">
            <strong>AI 키워드</strong>
            <div className="miniTags">
              {generalInfoDraft.keywords.length > 0 ? (
                generalInfoDraft.keywords.map((kw) => (
                  <span key={kw}>#{String(kw).replace(/^#+/, "")}</span>
                ))
              ) : (
                <span>자동분류 후 표시됩니다.</span>
              )}
            </div>
          </div>

          <div className="generalInfoResultBox generalInfoEditableResultBox">
            <strong>요약</strong>
            <textarea
              className="generalInfoEditableTextarea"
              value={generalInfoDraft.summary}
              onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, summary: e.target.value }))}
              placeholder="자동분류 후 요약이 표시됩니다. 필요하면 직접 수정하세요."
              rows={4}
            />
          </div>

          <div className="generalInfoResultBox generalInfoEditableResultBox">
            <div className="generalInfoSectionTitleRow">
              <strong>Fact Check</strong>
              <button
                type="button"
                className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                onClick={handleCopyFactCheckResult}
              >
                {copyFeedback === "fact" ? "✅ 복사됨" : "📋 전체 복사"}
              </button>
            </div>
            <div className="generalInfoFactEditGrid">
              <label>
                상태
                <select
                  value={generalInfoDraft.factCheckStatus}
                  onChange={(e) =>
                    setGeneralInfoDraft((prev) => ({
                      ...prev,
                      factCheckStatus: e.target.value as GeneralInfoDraft["factCheckStatus"],
                    }))
                  }
                >
                  <option value="확인 전">확인 전</option>
                  <option value="확인 완료">확인 완료</option>
                  <option value="확인 필요">확인 필요</option>
                  <option value="오류 가능">오류 가능</option>
                </select>
              </label>
              <label>
                확인 내용
                <textarea
                  className="generalInfoEditableTextarea"
                  value={generalInfoDraft.factCheckSummary}
                  onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, factCheckSummary: e.target.value }))}
                  placeholder="Fact Check 결과나 확인 필요 내용을 직접 수정하세요."
                  rows={4}
                />
              </label>
            </div>
          </div>
        </Card>
      </section>
      )} {/* end activeTab === "collect" */}

      {/* ===== 정보 창고 탭 (저장함) ===== */}
      {activeTab === "storage" && (
      <aside className="rightColumn generalInfoRightColumn" style={{ position: "relative", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        {/* Scroll to Top Button */}
        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            if (window.innerWidth <= 1100) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              const listEl = e.currentTarget.parentElement?.querySelector('.generalInfoList');
              if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="맨위로"
        >맨 위로 ↑</button>
        <Card
          number="3"
          title="정보 창고"
          subtitle="저장된 정보를 분류·키워드·본문 기준으로 검색합니다."
        >
          <div className="searchBox" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                value={generalInfoSearchTerm}
                onChange={(e) => setGeneralInfoSearchTerm(e.target.value)}
                placeholder="제목, 본문, URL, 분류, 키워드, 요약, Fact Check 검색"
                style={{ flex: 1 }}
              />
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  void loadGeneralInfoItemsFromSupabase();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "0 12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  borderRadius: "10px",
                  borderColor: "rgba(56, 189, 248, 0.4)",
                  background: "linear-gradient(180deg, rgba(30,41,59,0.98), rgba(15,23,42,0.98))",
                  color: "#38bdf8",
                  cursor: "pointer",
                }}
                title="Supabase에서 최신 데이터 불러오기"
              >
                🔄 동기화
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
              <p className="mutedText" style={{ margin: 0 }}>
                검색 결과 {filteredGeneralInfoItems.length}건 / 전체 {generalInfoItems.length}건
              </p>
              <span className="mutedText" style={{ fontSize: "11px", color: "#38bdf8" }}>
                {generalInfoSupabaseStatus}
              </span>
            </div>
          </div>

          {filteredGeneralInfoItems.length === 0 ? (
            <EmptyState icon="🗂️" text="저장된 일반 정보가 없습니다." />
          ) : (
            <div className="generalInfoList">
              {filteredGeneralInfoItems.map((item) => (
                <article
                  className={`generalInfoCard ${item.isPinned ? "pinned" : ""} ${generalInfoDetailId === item.id ? "active" : ""}`}
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setGeneralInfoDetailId(item.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setGeneralInfoDetailId(item.id); }}
                >
                  {/* 이미지 — 2/5 */}
                  <div
                    className="generalInfoCardThumbnail"
                    onClick={() => setGeneralInfoDetailId(item.id)}
                  >
                    {getGeneralInfoDisplayMediaItems(item).length > 0 ? (
                      <img
                        src={getGeneralInfoDisplayMediaItems(item)[0].preview}
                        alt={item.title}
                        onError={(e) => { e.currentTarget.src = "/placeholder.png"; }}
                        onClick={(e) => {
                          if (!onOpenStorageImage) return;
                          const media = getGeneralInfoDisplayMediaItems(item)[0];
                          if (!media?.preview || media.type === "video") return;
                          e.stopPropagation();
                          onOpenStorageImage(media.preview, media.name || `${item.title || "general_info"}.jpg`);
                        }}
                        style={{ cursor: onOpenStorageImage ? "zoom-in" : undefined }}
                      />
                    ) : (
                      <div className="generalInfoCardPlaceholder">📄</div>
                    )}
                  </div>

                  {/* 제목/날짜/요약 — 2/5 */}
                  <div
                    className="generalInfoCardContent"
                    onClick={() => setGeneralInfoDetailId(item.id)}
                  >
                    <strong>
                      {item.isPinned && <span className="generalInfoCardPinMark">📌</span>}
                      {item.title}
                    </strong>
                    <p className="mutedText">{item.createdAt}</p>
                    <p className="cardSummary">{item.summary || "클립보드 이미지 자료"}</p>
                  </div>

                  {/* 상세보기/고정 버튼 */}
                  <div className="generalInfoCardActions">
                    <button
                      className="generalInfoCardDetailButton"
                      type="button"
                      title="상세보기"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGeneralInfoDetailId(item.id);
                      }}
                    >
                      상세보기
                    </button>
                    <button
                      className={`generalInfoCardPinButton ${item.isPinned ? "pinned" : ""}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePinGeneralInfo(item.id);
                      }}
                      title={item.isPinned ? "고정 해제" : "상단 고정"}
                    >
                      📌
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </aside>
      )} {/* end activeTab === "storage" */}
    </div>
  );
}
