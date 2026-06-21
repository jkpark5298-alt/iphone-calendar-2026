"use client";

/**
 * Chapter3Info.tsx
 * Chapter 3 — 일반 정보 수집 / 분류 / 저장
 * TravelDiaryApp의 "info" 탭 JSX 분리
 */

import React from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { Card, EmptyState } from "./SharedComponents";

export interface Chapter3InfoProps {
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
  handleCancelEditGeneralInfo: () => void;
  handleStartEditGeneralInfo: (item: GeneralInfoItem) => void;

  // 저장함
  generalInfoItems: GeneralInfoItem[];
  filteredGeneralInfoItems: GeneralInfoItem[];
  generalInfoSearchTerm: string;
  setGeneralInfoSearchTerm: (value: string) => void;
  setGeneralInfoDetailId: (id: number | null) => void;
  handleTogglePinGeneralInfo: (itemId: number) => void;
  loadGeneralInfoItemsFromSupabase: () => Promise<void>;
  generalInfoSupabaseStatus: string;

  // 카테고리 & 헬퍼
  generalInfoCategories: string[];
  normalizeGeneralInfoMediaItems: (draft: GeneralInfoDraft) => GeneralInfoMediaItem[];
  getGeneralInfoDisplayMediaItems: (item: GeneralInfoItem) => GeneralInfoMediaItem[];
}

export function Chapter3Info({
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
  handleCancelEditGeneralInfo,
  handleStartEditGeneralInfo,
  generalInfoItems,
  filteredGeneralInfoItems,
  generalInfoSearchTerm,
  setGeneralInfoSearchTerm,
  setGeneralInfoDetailId,
  handleTogglePinGeneralInfo,
  loadGeneralInfoItemsFromSupabase,
  generalInfoSupabaseStatus,
  generalInfoCategories,
  normalizeGeneralInfoMediaItems,
  getGeneralInfoDisplayMediaItems,
}: Chapter3InfoProps) {
  React.useEffect(() => {
    if (generalInfoRichTextRef && "current" in generalInfoRichTextRef && generalInfoRichTextRef.current) {
      // Only set initial HTML on mount/reset to prevent React cursor jumps during typing
      generalInfoRichTextRef.current.innerHTML = generalInfoRichTextInitialHtml;
    }
  }, [generalInfoRichTextEditorKey, generalInfoRichTextInitialHtml, generalInfoRichTextRef]);

  return (
    <div
      className={`layoutGrid generalInfoLayoutGrid ch3HalfLayout ${isGeneralInfoMobileLayout ? "ch3MobileOneColumn" : "ch3PcHalfLayout"}`}
      style={{
        display: "grid",
        gridTemplateColumns: isGeneralInfoMobileLayout
          ? "minmax(0, 1fr)"
          : "minmax(0, calc(50% - 11px)) minmax(0, calc(50% - 11px))",
        columnGap: isGeneralInfoMobileLayout ? 0 : 22,
        rowGap: isGeneralInfoMobileLayout ? 14 : 22,
        alignItems: "start",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflowX: "hidden",
      }}
    >
      <section className="leftColumn">
        <div className="chapterTitleBox">
          <span>Chapter 3</span>
          <h2>일반 정보 수집 / 분류 / 저장</h2>
          <p>
            여행 정보와 별도로 정치·경제·사회·기술·국제 등 일반 정보를
            수집하고 AI 분류, Fact Check, 검색 관리를 진행합니다.
          </p>
        </div>

        <Card
          number="1"
          title="일반 정보 수집"
          subtitle="Text / 이미지 / 동영상 / URL을 단독 또는 복수로 입력합니다."
        >
          <div className="generalInfoInputRecoveryBar">
            <div>
              <strong>입력 오류 대응</strong>
              <p>이미지/Text/URL 입력이 잘못되었을 때 현재 입력을 삭제하거나 직전 상태로 되돌립니다.</p>
            </div>
            <div className="generalInfoInputRecoveryActions">
              <button
                className="secondaryButton"
                type="button"
                onClick={handleUndoGeneralInfoDraft}
                disabled={!generalInfoDraftBackup}
              >
                ↩️ 직전 입력 되돌리기
              </button>
              <button className="dangerButton" type="button" onClick={handleResetGeneralInfoDraft}>
                🧹 현재 입력 삭제
              </button>
            </div>
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

          {generalInfoEditingId && (
            <div className="generalInfoEditNotice">
              <strong>수정 모드</strong>
              <p>
                저장된 일반 정보를 불러왔습니다. 제목, URL, Text, 이미지, 분류를
                수정한 뒤 [수정 저장]을 누르세요.
              </p>
            </div>
          )}

          <div className="generalInfoGrid">
            <label>
              정보 제목
              <input
                value={generalInfoDraft.title}
                onChange={(e) => setGeneralInfoDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="예: 반도체 공급망 정책 자료"
              />
            </label>
            <label>
              출처 URL
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
            </label>
          </div>

          <div className="generalInfoAutoGuide">
            <strong>자동 입력 안내</strong>
            <p>
              URL을 입력한 뒤 [URL 내용 자동 가져오기]를 누르면 제목, 본문 Text,
              대표 이미지가 자동 입력됩니다. 이후 [AI 자동분류]로 분류와 키워드를 생성하세요.
            </p>
          </div>

          {/* Rich Text Editor */}
          <div className="generalInfoTextBox generalInfoRichTextBox">
            <div className="generalInfoRichTextHeader">
              <strong>Text 입력 / 편집</strong>
              <span>아래 큰 입력칸에 내용을 입력하세요. 줄바꿈, 띄어쓰기, 글자색, 굵게, 밑줄 편집 가능</span>
            </div>

            <div
              className="generalInfoRichToolbar"
              aria-label="Text 편집 도구"
            >
              <button type="button" onClick={() => handleGeneralInfoRichCommand("bold")}>B 굵게</button>
              <button type="button" onClick={() => handleGeneralInfoRichCommand("underline")}>U 밑줄</button>
              <button
                type="button"
                style={getGeneralInfoToolbarButtonStyle()}
                onClick={() => handleGeneralInfoRichCommand("removeFormat")}
              >
                서식 지우기
              </button>
              <button type="button" className="generalInfoRichColorDefault" onClick={() => handleGeneralInfoRichCommand("foreColor", "#e2e8f0")}>● 기본</button>
              <button type="button" className="generalInfoRichColorRed" onClick={() => handleGeneralInfoRichCommand("foreColor", "#f87171")}>● 빨강</button>
              <button type="button" className="generalInfoRichColorYellow" onClick={() => handleGeneralInfoRichCommand("foreColor", "#facc15")}>● 노랑</button>
              <button type="button" className="generalInfoRichColorBlue" onClick={() => handleGeneralInfoRichCommand("foreColor", "#60a5fa")}>● 파랑</button>
              <button type="button" className="generalInfoRichColorGreen" onClick={() => handleGeneralInfoRichCommand("foreColor", "#4ade80")}>● 초록</button>
            </div>

            <div
              key={generalInfoRichTextEditorKey}
              ref={generalInfoRichTextRef}
              className="generalInfoRichTextEditor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              onInput={syncGeneralInfoRichTextToDraft}
              onBlur={syncGeneralInfoRichTextToDraft}
              onKeyUp={syncGeneralInfoRichTextToDraft}
              onPaste={handleGeneralInfoRichPaste}
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

            <p className="generalInfoRichTextNote">
              AI 분석에는 서식을 제외한 순수 Text가 사용되고, 저장함에는 편집된 색상/강조가 함께 표시됩니다.
            </p>
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
          >
            <strong>📱 아이폰 이미지/인스타 링크 붙여넣기</strong>
            <p>
              인스타·카카오톡·Safari에서 이미지나 링크를 복사한 뒤 이 박스를 길게 눌러
              [붙여넣기]를 선택하세요. 이미지가 직접 들어오지 않으면 사진 앱에 저장 후
              [이미지/동영상 선택]을 사용하세요.
            </p>
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
                {normalizeGeneralInfoMediaItems(generalInfoDraft).map((media, index) => (
                  <div className="generalInfoDraftMediaCard" key={media.id || index}>
                    <div className="generalInfoDraftMediaBadge">
                      {index === 0 ? "대표" : `추가 ${index}`}
                    </div>
                    {media.type === "video" ? (
                      <video src={media.preview} controls />
                    ) : generalInfoImageLoadFailed && index === 0 ? (
                      <div className="generalInfoImageFallback">
                        <strong>이미지 로드 실패</strong>
                        <p>
                          외부 사이트 이미지가 직접 표시를 막았을 수 있습니다.
                          이미지를 다시 복사해 [클립보드에서 일반 정보 붙여넣기]로 교체하세요.
                        </p>
                      </div>
                    ) : (
                      <img
                        src={media.preview}
                        alt={media.name || `자료 이미지 ${index + 1}`}
                        onError={() => { if (index === 0) setGeneralInfoImageLoadFailed(true); }}
                      />
                    )}
                    <span>{media.name || `자료 이미지 ${index + 1}`}</span>
                    <button
                      className="secondaryButton smallActionButton dangerSmallButton"
                      type="button"
                      onClick={() => handleRemoveGeneralInfoMediaItem(index)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
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
            <strong>Fact Check</strong>
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

      {/* Right Column: 저장함 */}
      <aside className="rightColumn generalInfoRightColumn">
        <Card
          number="3"
          title="일반 정보 저장함 / 검색"
          subtitle="Confirm 저장된 정보를 분류·키워드·본문 기준으로 검색합니다."
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
                  className={`generalInfoCard ${item.isPinned ? "pinned" : ""}`}
                  key={item.id}
                  onClick={() => setGeneralInfoDetailId(item.id)}
                >
                  <div className="generalInfoCardThumbnail" style={{ width: "60px", height: "60px", flexShrink: 0, borderRadius: "8px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#1e293b" }}>
                    {getGeneralInfoDisplayMediaItems(item).length > 0 ? (
                      <img
                        src={getGeneralInfoDisplayMediaItems(item)[0].preview}
                        alt={item.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => { e.currentTarget.src = "/placeholder.png"; }}
                      />
                    ) : (
                      <div className="generalInfoCardPlaceholder" style={{ fontSize: "24px" }}>📄</div>
                    )}
                  </div>
                  <div className="generalInfoCardContent">
                    <strong>
                      {item.isPinned && <span style={{ marginRight: "4px" }}>📌</span>}
                      {item.title}
                    </strong>
                    <p className="mutedText">{item.createdAt}</p>
                    <p className="cardSummary">{item.summary || "클립보드 이미지 자료"}</p>
                  </div>
                  <button
                    className={`generalInfoCardPinButton ${item.isPinned ? "pinned" : ""}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePinGeneralInfo(item.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "14px",
                      padding: "6px",
                      marginLeft: "auto",
                      opacity: item.isPinned ? 1 : 0.3,
                      transition: "opacity 0.2s",
                    }}
                    title={item.isPinned ? "고정 해제" : "상단 고정"}
                  >
                    📌
                  </button>
                  <button
                    className="generalInfoCardEditButton"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEditGeneralInfo(item);
                    }}
                    title="자료 수정"
                  >
                    ✏️ 수정
                  </button>
                  <button className="generalInfoCardDetailButton" type="button" style={{ marginLeft: "4px" }}>
                    상세보기
                  </button>
                </article>
              ))}
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}
