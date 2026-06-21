const fs = require('fs');
let content = fs.readFileSync('hooks/useTravelDiaryGeneralInfoState.ts', 'utf8');

const normalizeNewlines = (str) => str.replace(/\r\n/g, '\n');
let normContent = normalizeNewlines(content);

// 1. Add handleSaveTemporaryGeneralInfoDraft above handleConfirmGeneralInfo
const handleConfirmSearch = `  const handleConfirmGeneralInfo = useCallback(async () => {`;
const saveTempDraftDef = `  const handleSaveTemporaryGeneralInfoDraft = useCallback(() => {
    const html = getCurrentGeneralInfoRichTextHtml();
    const draftToSave = {
      draft: generalInfoDraft,
      keywordText: generalInfoKeywordText,
      richTextHtml: html,
      editingId: generalInfoEditingId
    };
    localStorage.setItem("travel_diary_general_info_temp_draft", JSON.stringify(draftToSave));
    showPasteHint("💾 현재 입력 중인 내용이 임시 저장되었습니다.");
  }, [generalInfoDraft, generalInfoKeywordText, getCurrentGeneralInfoRichTextHtml, generalInfoEditingId, showPasteHint]);

`;

if (normContent.includes(handleConfirmSearch) && !normContent.includes('handleSaveTemporaryGeneralInfoDraft = useCallback')) {
  normContent = normContent.replace(handleConfirmSearch, saveTempDraftDef + handleConfirmSearch);
  console.log('Added handleSaveTemporaryGeneralInfoDraft function definition.');
} else {
  console.log('handleConfirmGeneralInfo not found or handleSaveTemporaryGeneralInfoDraft already exists.');
}

// 2. Remove draft from localStorage inside handleConfirmGeneralInfo (update case)
const oldConfirmUpdateReset = `      setGeneralInfoDraftBackup(null);
      setGeneralInfoImageLoadFailed(false);
      setGeneralInfoEditingId(null);
      setGeneralInfoKeywordText("");
      setGeneralInfoDraft(initialGeneralInfoDraft);
      resetGeneralInfoRichTextEditor("", "");
      showPasteHint("✅ 수정 저장 완료 · 새 일반 정보 입력 준비 완료");`;

const newConfirmUpdateReset = `      setGeneralInfoDraftBackup(null);
      setGeneralInfoImageLoadFailed(false);
      setGeneralInfoEditingId(null);
      setGeneralInfoKeywordText("");
      setGeneralInfoDraft(initialGeneralInfoDraft);
      resetGeneralInfoRichTextEditor("", "");
      localStorage.removeItem("travel_diary_general_info_temp_draft");
      showPasteHint("✅ 수정 저장 완료 · 새 일반 정보 입력 준비 완료");`;

if (normContent.includes(oldConfirmUpdateReset)) {
  normContent = normContent.replace(oldConfirmUpdateReset, newConfirmUpdateReset);
  console.log('Added temp draft removal in update confirm case.');
} else {
  console.log('oldConfirmUpdateReset not matched.');
}

// 3. Remove draft from localStorage inside handleConfirmGeneralInfo (create case)
const oldConfirmCreateReset = `    setGeneralInfoDraftBackup(null);
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft(initialGeneralInfoDraft);
    resetGeneralInfoRichTextEditor("", "");
    showPasteHint("✅ 저장 완료 · 새 일반 정보 입력 준비 완료");`;

const newConfirmCreateReset = `    setGeneralInfoDraftBackup(null);
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft(initialGeneralInfoDraft);
    resetGeneralInfoRichTextEditor("", "");
    localStorage.removeItem("travel_diary_general_info_temp_draft");
    showPasteHint("✅ 저장 완료 · 새 일반 정보 입력 준비 완료");`;

if (normContent.includes(oldConfirmCreateReset)) {
  normContent = normContent.replace(oldConfirmCreateReset, newConfirmCreateReset);
  console.log('Added temp draft removal in create confirm case.');
} else {
  console.log('oldConfirmCreateReset not matched.');
}

// 4. Add useEffect on mount to restore the draft
const oldPersistEffect = `  // Auto-persist generalInfoItems to localStorage whenever they change
  useEffect(() => {
    persistGeneralInfoItemsToLocalStorage(generalInfoItems);
  }, [generalInfoItems]);`;

const newPersistEffect = `  // Auto-persist generalInfoItems to localStorage whenever they change
  useEffect(() => {
    persistGeneralInfoItemsToLocalStorage(generalInfoItems);
  }, [generalInfoItems]);

  // Load temporary draft from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("travel_diary_general_info_temp_draft");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.draft) {
            setGeneralInfoDraft(parsed.draft);
            if (parsed.keywordText !== undefined) setGeneralInfoKeywordText(parsed.keywordText);
            if (parsed.editingId !== undefined) setGeneralInfoEditingId(parsed.editingId);
            if (parsed.richTextHtml !== undefined) {
              resetGeneralInfoRichTextEditor(parsed.draft.text || "", parsed.richTextHtml);
            }
            showPasteHint("📂 이전에 임시 저장된 내용을 불러왔습니다.");
          }
        } catch (e) {
          console.error("Failed to parse temp draft", e);
        }
      }
    }
  }, [resetGeneralInfoRichTextEditor, showPasteHint]);`;

if (normContent.includes(oldPersistEffect)) {
  normContent = normContent.replace(oldPersistEffect, newPersistEffect);
  console.log('Added mount useEffect for restoring temp draft.');
} else {
  console.log('oldPersistEffect not matched.');
}

// 5. Expose handleSaveTemporaryGeneralInfoDraft in return statement
const oldReturnPart = `    handleUndoGeneralInfoDraft,
    handleResetGeneralInfoDraft,`;

const newReturnPart = `    handleUndoGeneralInfoDraft,
    handleResetGeneralInfoDraft,
    handleSaveTemporaryGeneralInfoDraft,`;

if (normContent.includes(oldReturnPart)) {
  normContent = normContent.replace(oldReturnPart, newReturnPart);
  console.log('Exposed handleSaveTemporaryGeneralInfoDraft in return statement.');
} else {
  console.log('oldReturnPart not matched.');
}

// 6. Make handleGeneralInfoIphonePasteZonePaste more robust
const oldPasteZonePaste = `  const handleGeneralInfoIphonePasteZonePaste = useCallback((
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();

    const clipboardData = event.clipboardData;
    const pastedFiles = Array.from(clipboardData.files || []).filter((file) =>
      file.type.startsWith("image/") || file.type.startsWith("video/"),
    );

    if (pastedFiles.length > 0) {
      const transfer = new DataTransfer();
      pastedFiles.forEach((file) => transfer.items.add(file));
      handleGeneralInfoFileUpload(transfer.files);
    }

    const pastedText =
      clipboardData.getData("text/plain") ||
      clipboardData.getData("text/uri-list") ||
      clipboardData.getData("text/html") ||
      "";

    if (pastedText.trim()) {
      applyGeneralInfoPastedText(pastedText, "아이폰 붙여넣기");
    }

    if (pastedFiles.length === 0 && !pastedText.trim()) {
      showPasteHint("⚠️ 이미지/동영상을 복사해 다시 시도하세요.");
    }
  }, [handleGeneralInfoFileUpload, applyGeneralInfoPastedText, showPasteHint]);`;

const newPasteZonePaste = `  const handleGeneralInfoIphonePasteZonePaste = useCallback((
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();

    const clipboardData = event.clipboardData;
    const pastedFiles = [];

    if (clipboardData.files && clipboardData.files.length > 0) {
      Array.from(clipboardData.files).forEach((file) => {
        if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
          pastedFiles.push(file);
        }
      });
    } else if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))) {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
    }

    if (pastedFiles.length > 0) {
      const transfer = new DataTransfer();
      pastedFiles.forEach((file) => transfer.items.add(file));
      handleGeneralInfoFileUpload(transfer.files);
    }

    const pastedText =
      clipboardData.getData("text/plain") ||
      clipboardData.getData("text/uri-list") ||
      clipboardData.getData("text/html") ||
      "";

    if (pastedText.trim()) {
      applyGeneralInfoPastedText(pastedText, "아이폰 붙여넣기");
    }

    if (pastedFiles.length === 0 && !pastedText.trim()) {
      showPasteHint("⚠️ 이미지/동영상을 복사해 다시 시도하세요.");
    }
  }, [handleGeneralInfoFileUpload, applyGeneralInfoPastedText, showPasteHint]);`;

let normOldPaste = normalizeNewlines(oldPasteZonePaste);
let normNewPaste = normalizeNewlines(newPasteZonePaste);

if (normContent.includes(normOldPaste)) {
  normContent = normContent.replace(normOldPaste, normNewPaste);
  console.log('Made handleGeneralInfoIphonePasteZonePaste robust.');
} else {
  console.log('oldPasteZonePaste not matched.');
}

fs.writeFileSync('hooks/useTravelDiaryGeneralInfoState.ts', normContent.replace(/\n/g, '\r\n'), 'utf8');
console.log('Done patching hook file!');
