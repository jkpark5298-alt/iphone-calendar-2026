"use client";

/**
 * Chapter3Info.tsx
 * Chapter 3 — 일반 정보 수집 / 분류 / 저장 (수동 Fact Check 정리함)
 * TravelDiaryApp의 "info" 탭 JSX 분리
 */

import React from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import {
  extractTitleFromPlainText,
  hasDisplayableAiReport,
  cleanFactCheckSummaryText,
} from "../lib/generalInfoHelpers";
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
  uploadInlineImageFile?: (file: File) => Promise<string>;
  // AI 기능은 일반정보수집에서 비활성화(다른 앱/API에서 재사용). 핸들러는 선택.
  handleAnalyzeGeneralInfoDraft?: () => void;
  isAnalyzingGeneralInfo?: boolean;
  handleFactCheckGeneralInfoDraft?: () => void;
  isRunningGeneralInfoFactCheck?: boolean;
  geminiApiPacketStatus?: "available" | "depleted";
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
  handleOpenGeneralInfoDetail?: (itemId: number) => void;
  handleOpenGeneralInfoAiReport?: (itemId: number) => void;
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
  geminiApiKey: _geminiApiKey,
  setGeminiApiKey: _setGeminiApiKey,
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
  uploadInlineImageFile,
  handleAnalyzeGeneralInfoDraft: _handleAnalyzeGeneralInfoDraft,
  isAnalyzingGeneralInfo: _isAnalyzingGeneralInfo = false,
  handleFactCheckGeneralInfoDraft: _handleFactCheckGeneralInfoDraft,
  isRunningGeneralInfoFactCheck: _isRunningGeneralInfoFactCheck = false,
  geminiApiPacketStatus = "available",
  handleConfirmGeneralInfo,
  handleSaveTemporaryGeneralInfoDraft,
  handleCancelEditGeneralInfo,
  generalInfoItems,
  filteredGeneralInfoItems,
  generalInfoSearchTerm,
  setGeneralInfoSearchTerm,
  generalInfoDetailId,
  setGeneralInfoDetailId,
  handleOpenGeneralInfoDetail,
  handleOpenGeneralInfoAiReport,
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
  const [showSourceUrlHelp, setShowSourceUrlHelp] = React.useState(false);
  const [copyFeedback, setCopyFeedback] = React.useState<"text" | "fact" | null>(null);

  // 일반정보수집은 수동 Fact Check 정리함 — AI/패킷·이미지 UI 비표시
  void geminiApiPacketStatus;
  void _handleAnalyzeGeneralInfoDraft;
  void _isAnalyzingGeneralInfo;
  void _handleFactCheckGeneralInfoDraft;
  void _isRunningGeneralInfoFactCheck;
  void handleGeneralInfoFileUpload;
  void handleGeneralInfoIphonePasteZonePaste;
  void handleClearGeneralInfoCoverImage;
  void handleRemoveGeneralInfoMediaItem;
  void uploadInlineImageFile;
  void normalizeGeneralInfoMediaItems;
  void getGeneralInfoDisplayMediaItems;
  void onOpenStorageImage;

  const syncTitleFromEditor = React.useCallback(() => {
    const plain = String(generalInfoRichTextRef.current?.innerText || "");
    const titleFromText = extractTitleFromPlainText(plain);
    if (titleFromText) {
      setGeneralInfoDraft((prev) =>
        prev.title === titleFromText ? prev : { ...prev, title: titleFromText },
      );
    }
  }, [generalInfoRichTextRef, setGeneralInfoDraft]);

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
    const summary = cleanFactCheckSummaryText(generalInfoDraft.factCheckSummary);
    const combined = [`[Fact Check 상태] ${status}`, summary].filter(Boolean).join("\n\n");
    void copyPlainTextToClipboard(combined, "fact");
  }, [copyPlainTextToClipboard, generalInfoDraft.factCheckStatus, generalInfoDraft.factCheckSummary]);

  const [factCleanFeedback, setFactCleanFeedback] = React.useState(false);

  const handleCleanFactCheckSummary = React.useCallback(() => {
    const raw = String(generalInfoDraft.factCheckSummary || "");
    if (!raw.trim()) {
      alert("정리할 확인 내용이 없습니다.");
      return;
    }
    const cleaned = cleanFactCheckSummaryText(raw);
    setGeneralInfoDraft((prev) => ({ ...prev, factCheckSummary: cleaned }));
    setFactCleanFeedback(true);
    window.setTimeout(() => setFactCleanFeedback(false), 1800);
  }, [generalInfoDraft.factCheckSummary, setGeneralInfoDraft]);

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

      {/* ===== 정보 수집 탭 (입력 + 수동 Fact Check) ===== */}
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
          <p style={{ margin: "4px 0 0 0" }}>
            Fact Check된 내용을 정리·분류·저장하는 보관함입니다.
          </p>
        </div>

        <Card
          number="1"
          title="일반 정보 수집"
          subtitle="Text / URL을 입력해 Fact Check 내용을 정리합니다."
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
                저장된 일반 정보를 불러왔습니다. 제목, URL, Text, 분류를
                수정한 뒤 [수정 저장]을 누르세요.
              </p>
            </div>
          )}

          <label className="generalInfoFieldLabel">
            정보 제목
            <input
              value={generalInfoDraft.title}
              readOnly
              placeholder="Text 입력 첫 줄이 제목으로 사용됩니다"
              title="Text 입력 / 편집의 첫 줄이 제목입니다"
            />
            <span className="mutedText" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
              Text 입력 / 편집 <strong>첫 줄</strong>이 제목으로 자동 반영됩니다.
            </span>
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
              className="generalInfoRichToolbar generalInfoCircledNumberToolbar"
              aria-label="원형 번호 삽입"
            >
              {["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"].map((mark) => (
                <button
                  key={mark}
                  type="button"
                  className="generalInfoCircledNumberBtn"
                  title={`${mark} 삽입`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleGeneralInfoRichCommand("insertText", mark)}
                >
                  {mark}
                </button>
              ))}
            </div>

            <div
              key={generalInfoRichTextEditorKey}
              ref={generalInfoRichTextRef}
              className="generalInfoRichTextEditor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              onInput={syncTitleFromEditor}
              onKeyUp={syncTitleFromEditor}
              onBlur={(e) => {
                // 포커스가 버튼으로 이동할 때는 sync 생략 (버튼 핸들러가 직접 최신 텍스트를 읽음)
                const rel = e.relatedTarget as HTMLElement | null;
                if (rel && (rel.tagName === "BUTTON" || rel.closest?.("button"))) return;
                syncGeneralInfoRichTextToDraft();
                syncTitleFromEditor();
              }}
              onPaste={(event) => {
                handleGeneralInfoRichPaste(event);
                requestAnimationFrame(syncTitleFromEditor);
              }}
              data-placeholder="검증된 내용, 보고서 요약, 복사한 텍스트, 메모를 입력하세요."
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

            <p className="generalInfoRichTextNote">
              저장함에는 편집된 색상/강조가 함께 표시됩니다.
              Fact Check 결과·판정·근거는 아래 카드에서 직접 입력하세요.
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
                  URL을 입력한 뒤 [URL 내용 자동 가져오기]를 누르면 제목·본문 TEXT가
                  자동 입력됩니다. 이어서 분류·키워드·Fact Check를 직접 입력하세요.
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
                외부 앱이나 웹페이지에서 복사한 Text·URL을 일반 정보 입력칸에 반영합니다.
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

          <div className="generalInfoActionRow">
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

        {/* Card 2: 분류 / 키워드 / Fact Check */}
        <Card
          number="2"
          title="분류 / 키워드 / Fact Check"
          subtitle="분류·키워드·Fact Check를 직접 입력한 뒤 Confirm 저장합니다."
        >
          <div className="generalInfoGrid">
            <label>
              1차 분류
              <select
                value={generalInfoDraft.primaryCategory}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, primaryCategory: e.target.value }))}
              >
                <option value="">분류 선택</option>
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
            <strong>키워드</strong>
            <div className="miniTags">
              {generalInfoDraft.keywords.length > 0 ? (
                generalInfoDraft.keywords.map((kw) => (
                  <span key={kw}>#{String(kw).replace(/^#+/, "")}</span>
                ))
              ) : (
                <span>위에서 키워드를 입력하면 표시됩니다.</span>
              )}
            </div>
          </div>

          <div className="generalInfoResultBox generalInfoEditableResultBox">
            <strong>요약</strong>
            <textarea
              className="generalInfoEditableTextarea"
              value={generalInfoDraft.summary}
              onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, summary: e.target.value }))}
              placeholder="요약 내용을 직접 입력하세요."
              rows={4}
            />
          </div>

          <div className="generalInfoResultBox generalInfoEditableResultBox">
            <div className="generalInfoSectionTitleRow">
              <strong>Fact Check</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="secondaryButton smallActionButton generalInfoCopyAllBtn"
                  onClick={handleCopyFactCheckResult}
                >
                  {copyFeedback === "fact" ? "✅ 복사됨" : "📋 전체 복사"}
                </button>
                <button
                  type="button"
                  className="secondaryButton smallActionButton"
                  onClick={handleCleanFactCheckSummary}
                  title="HTML·스타일 태그를 제거하고 본문만 정리합니다"
                  style={{ borderColor: "rgba(125, 211, 252, 0.45)", color: "#bae6fd" }}
                >
                  {factCleanFeedback ? "✅ 정리됨" : "✨ 정리"}
                </button>
              </div>
            </div>
            <p className="mutedText" style={{ margin: "0 0 10px", fontSize: 12 }}>
              외부에서 검증한 판정·근거를 여기에 직접 입력하세요. HTML이 보이면 <strong>정리</strong>를 눌러 깔끔한 텍스트로 바꾸세요.
            </p>
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
                  <option value="오류 가능성">오류 가능성</option>
                </select>
              </label>
              <label className="generalInfoFactSummaryLabel">
                <span className="generalInfoFactSummaryLabelRow">
                  확인 내용
                  <button
                    type="button"
                    className="secondaryButton smallActionButton"
                    onClick={handleCleanFactCheckSummary}
                    title="HTML·스타일 태그를 제거하고 본문만 정리합니다"
                    style={{
                      minHeight: 28,
                      padding: "4px 10px",
                      fontSize: 12,
                      borderColor: "rgba(125, 211, 252, 0.45)",
                      color: "#bae6fd",
                    }}
                  >
                    {factCleanFeedback ? "✅ 정리됨" : "✨ 정리"}
                  </button>
                </span>
                <textarea
                  className="generalInfoEditableTextarea"
                  value={generalInfoDraft.factCheckSummary}
                  onChange={(e) =>
                    setGeneralInfoDraft((prev) => ({
                      ...prev,
                      factCheckSummary: e.target.value,
                    }))
                  }
                  placeholder="Fact Check 결과나 확인 필요 내용을 직접 수정하세요."
                  rows={10}
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
                  onClick={() => (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id); }}
                >
                  {/* 이미지 — 2/5 */}
                  <div
                    className="generalInfoCardThumbnail"
                    onClick={() => (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id)}
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
                    onClick={() => (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id)}
                  >
                    <strong>
                      {item.isPinned && <span className="generalInfoCardPinMark">📌</span>}
                      {item.confirmed === false && (
                        <span className="generalInfoTempBadge">임시저장</span>
                      )}
                      {item.title}
                    </strong>
                    <p className="mutedText">{item.createdAt}</p>
                    <p className="cardSummary">{item.summary || "클립보드 이미지 자료"}</p>
                  </div>

                  {/* 검증 보고서 / Source DATA / 고정 */}
                  <div className="generalInfoCardActions">
                    {hasDisplayableAiReport(String(item.factCheckSummary || "")) && (
                      <button
                        className="generalInfoCardAiReportButton"
                        type="button"
                        title="검증 보고서"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenGeneralInfoAiReport?.(item.id);
                        }}
                      >
                        검증 보고서
                      </button>
                    )}
                    <button
                      className="generalInfoCardDetailButton"
                      type="button"
                      title="Source DATA"
                      onClick={(e) => {
                        e.stopPropagation();
                        (handleOpenGeneralInfoDetail ?? setGeneralInfoDetailId)(item.id);
                      }}
                    >
                      Source DATA
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
