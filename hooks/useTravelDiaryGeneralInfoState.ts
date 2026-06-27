import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { initialGeneralInfoDraft, generalInfoCategories, mockAnalyzeGeneralInfo } from "../lib/generalInfoMock";
import { persistGeneralInfoItemsToLocalStorage, readGeneralInfoItemsFromLocalStorage } from "../lib/generalInfoStorage";

import { supabase } from "../lib/supabaseClient";


import { filterGeneralInfoItemsBySearch, getGeneralInfoCategoryPath, getGeneralInfoDisplayMediaItems, normalizeGeneralInfoMediaItems, makeGeneralInfoMediaItem, makeGeneralInfoHtmlFromText, getGeneralInfoInputCountText, getGeneralInfoFactLabel, extractMarkdownReport } from "../lib/generalInfoHelpers";


const TRAVEL_DIARY_BUCKET = "info-photos";
const nowText = () => new Date().toLocaleString("ko-KR");

const uploadFileToSupabaseStorage = async (file: File): Promise<{ storagePath: string; fileUrl: string }> => {
  if (!supabase) throw new Error("Supabase가 연결되지 않았습니다.");
  
  const originalName = file.name || "upload-file";
  const extensionMatch = originalName.match(/\.([a-zA-Z0-9]{1,10})$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || "jpg";
  const storagePath = `general-info/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extension}`;

  const { error } = await supabase!.storage
    .from(TRAVEL_DIARY_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase!.storage.from(TRAVEL_DIARY_BUCKET).getPublicUrl(storagePath);
  return { storagePath, fileUrl: data.publicUrl };
};

export interface UseTravelDiaryGeneralInfoStateProps {
  showPasteHint: (msg: string) => void;
}

export function useTravelDiaryGeneralInfoState({
  showPasteHint
}: UseTravelDiaryGeneralInfoStateProps) {
  

  const [generalInfoDraft, setGeneralInfoDraft] = useState<GeneralInfoDraft>(initialGeneralInfoDraft);
  const [isGeneralInfoMobileLayout, setIsGeneralInfoMobileLayout] = useState(false);
  const generalInfoRichTextRef = useRef<HTMLDivElement | null>(null);
  const [generalInfoRichTextInitialHtml, setGeneralInfoRichTextInitialHtml] = useState("");
  const [generalInfoRichTextEditorKey, setGeneralInfoRichTextEditorKey] = useState(0);
  const [generalInfoKeywordText, setGeneralInfoKeywordText] = useState("");
  const [generalInfoItems, setGeneralInfoItems] = useState<GeneralInfoItem[]>(() => {
    return readGeneralInfoItemsFromLocalStorage();
  });
  const generalInfoItemsLocalStorageReadyRef = useRef(false);
  const [generalInfoSearchTerm, setGeneralInfoSearchTerm] = useState("");
  const [isExtractingGeneralInfoUrl, setIsExtractingGeneralInfoUrl] = useState(false);
  const [generalInfoDetailId, setGeneralInfoDetailId] = useState<number | null>(null);
  const [generalInfoActiveTab, setGeneralInfoActiveTab] = useState<"storage" | "collect">("storage");
  const [generalInfoEditingId, setGeneralInfoEditingId] = useState<number | null>(null);
  const [isCollectingGeneralInfoClipboard, setIsCollectingGeneralInfoClipboard] = useState(false);
  const [generalInfoImageLoadFailed, setGeneralInfoImageLoadFailed] = useState(false);
  const [generalInfoSupabaseStatus, setGeneralInfoSupabaseStatus] = useState("일반 정보 Supabase 연결 준비");
  const generalInfoSupabaseStatusRef = useRef(generalInfoSupabaseStatus);
  generalInfoSupabaseStatusRef.current = generalInfoSupabaseStatus;
  const [generalInfoDraftBackup, setGeneralInfoDraftBackup] = useState<GeneralInfoDraft | null>(null);
  const [isAnalyzingGeneralInfo, setIsAnalyzingGeneralInfo] = useState(false);

  // AI 보고서 및 Fact Check
  const [generalInfoReportItem, setGeneralInfoReportItem] = useState<GeneralInfoItem | null>(null);
  const [generalInfoReportText, setGeneralInfoReportText] = useState("");
  const [isGeneratingGeneralInfoReport, setIsGeneratingGeneralInfoReport] = useState(false);
  const [generalInfoFactCheckItem, setGeneralInfoFactCheckItem] = useState<GeneralInfoItem | null>(null);
  const [generalInfoFactCheckResult, setGeneralInfoFactCheckResult] = useState("");
  const [isRunningGeneralInfoFactCheck, setIsRunningGeneralInfoFactCheck] = useState(false);

  const syncGeneralInfoItemToSupabase = useCallback(async (
    item: GeneralInfoItem,
    method: "POST" | "PUT",
  ) => {
    try {
      const nextStatus = method === "POST" ? "일반 정보 Supabase 저장 중" : "일반 정보 Supabase 수정 중";
      if (generalInfoSupabaseStatusRef.current !== nextStatus) {
        setGeneralInfoSupabaseStatus(nextStatus);
      }

      const response = await fetch("/api/general-info", {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(item),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || "일반 정보 Supabase 저장 실패");
      }

      if (data.item) {
        setGeneralInfoItems((prev) =>
          prev.map((prevItem) => {
            if (prevItem.id === data.item.id) {
              const mergedMediaItems = (data.item.mediaItems || []).map((newMedia: any, idx: number) => {
                const oldMedia = prevItem.mediaItems?.[idx];
                return {
                  ...newMedia,
                  preview: oldMedia?.preview || newMedia.preview || ""
                };
              });
              return {
                ...data.item,
                mediaItems: mergedMediaItems,
                isPinned: prevItem.isPinned || data.item.isPinned
              };
            }
            return prevItem;
          }),
        );
      }

      const successStatus = method === "POST" ? "일반 정보 Supabase 저장 완료" : "일반 정보 Supabase 수정 완료";
      if (generalInfoSupabaseStatusRef.current !== successStatus) {
        setGeneralInfoSupabaseStatus(successStatus);
      }
      showPasteHint(`✅ ${successStatus}`);
    } catch (error) {
      console.error("travel-diary general info sync failed", error);
      const failStatus = method === "POST"
        ? "이 기기에는 저장됨 · Supabase 저장 실패"
        : "이 기기에는 수정됨 · Supabase 수정 실패";
      if (generalInfoSupabaseStatusRef.current !== failStatus) {
        setGeneralInfoSupabaseStatus(failStatus);
      }
      showPasteHint(`⚠️ ${failStatus} · 인터넷 연결 및 API 권한을 확인하세요.`);
    }
  }, [showPasteHint]);

  // --- Chapter 3 일반 정보 Supabase CRUD 헬퍼 (API Router 호출 복원) ---
  const loadGeneralInfoItemsFromSupabase = useCallback(async () => {
    try {
      if (generalInfoSupabaseStatusRef.current !== "일반 정보 Supabase 불러오는 중") {
        setGeneralInfoSupabaseStatus("일반 정보 Supabase 불러오는 중");
      }

      const response = await fetch("/api/general-info", {
        method: "GET",
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || "일반 정보 불러오기 실패");
      }

      const remoteItems = Array.isArray(data.items) ? data.items : [];

      // 이미지 복원 로직: storagePath가 있으면 공개 URL로 복원 (영구 URL, 새로고침 후에도 유지)
      const restoredItems: GeneralInfoItem[] = remoteItems.map((item: GeneralInfoItem) => {
        const mediaItems = item.mediaItems || [];
        
        const restoredMediaItems = mediaItems.map((media) => {
          // preview가 없거나 blob: (임시 URL)이면 storagePath/fileUrl로 복원
          const preview = String(media.preview || "").trim();
          const fileUrl = String(media.fileUrl || "").trim();
          const storagePath = String(media.storagePath || "").trim();

          if ((!preview || preview.startsWith("blob:")) && storagePath) {
            try {
              const { data } = supabase!.storage
                .from(TRAVEL_DIARY_BUCKET)
                .getPublicUrl(storagePath);
              const publicUrl = data?.publicUrl || fileUrl || "";
              return { ...media, preview: publicUrl, fileUrl: publicUrl };
            } catch (error) {
              console.error("일반 정보 미디어 공개 URL 복원 실패:", error);
            }
          }
          
          // preview가 이미 있거나 storagePath가 없으면 그대로 반환
          if ((!preview || preview.startsWith("blob:")) && fileUrl) {
            return { ...media, preview: fileUrl };
          }
          
          return media;
        });
        
        return { ...item, mediaItems: restoredMediaItems };
      });

      setGeneralInfoItems((prev) => {
        const map = new Map<number, GeneralInfoItem>();

        const remoteIdsSet = new Set(restoredItems.map((r) => r.id));
        const minRemoteId = restoredItems.length > 0
          ? Math.min(...restoredItems.map((r) => r.id))
          : Infinity;
        const now = Date.now();
        const FIVE_MINUTES = 5 * 60 * 1000;

        // 1. Register existing local items first, but filter out those that were deleted from Supabase.
        // Keep them if: they exist on remote, they are newly created locally (< 5 min ago), or they might be beyond the 300-limit.
        prev.forEach((item) => {
          if (item && typeof item.id === "number") {
            const isRemotePresent = remoteIdsSet.has(item.id);
            const isNewLocalItem = (now - item.id) < FIVE_MINUTES;
            const isPossiblyBeyondLimit = remoteItems.length >= 300 && item.id < minRemoteId;

            if (isRemotePresent || isNewLocalItem || isPossiblyBeyondLimit) {
              map.set(item.id, item);
            } else {
              console.log(`Filtering out deleted general info item locally: ID=${item.id}, Title="${item.title}"`);
            }
          }
        });

        // 2. Overwrite local items with remote items from Supabase (preserving isPinned UI state)
        restoredItems.forEach((remoteItem) => {
          if (remoteItem && typeof remoteItem.id === "number") {
            const localItem = map.get(remoteItem.id);
            if (localItem) {
              const isPinned = !!(localItem.isPinned || remoteItem.isPinned);
              
              const remoteHasMedia = !!(remoteItem.mediaItems && remoteItem.mediaItems.length > 0 && remoteItem.mediaItems[0].preview);
              const localHasMedia = !!(localItem.mediaItems && localItem.mediaItems.length > 0 && localItem.mediaItems[0].preview);
              
              let mediaItems = remoteItem.mediaItems;
              if (!remoteHasMedia && localHasMedia) {
                mediaItems = localItem.mediaItems;
              }

              map.set(remoteItem.id, {
                ...remoteItem,
                isPinned,
                mediaItems,
                filePreview: remoteItem.filePreview || localItem.filePreview,
              });
            } else {
              map.set(remoteItem.id, remoteItem);
            }
          }
        });

        const sortedResult = Array.from(map.values()).sort((a, b) => b.id - a.id);
        
        // Sync to LocalStorage immediately
        persistGeneralInfoItemsToLocalStorage(sortedResult);

        return sortedResult;
      });

      const nextStatus = remoteItems.length > 0
        ? `일반 정보 Supabase 불러오기 완료 ${remoteItems.length}건`
        : "일반 정보 Supabase 저장자료 없음";
        
      if (generalInfoSupabaseStatusRef.current !== nextStatus) {
        setGeneralInfoSupabaseStatus(nextStatus);
      }
    } catch (error) {
      console.error("travel-diary general info load failed", error);
      if (generalInfoSupabaseStatusRef.current !== "일반 정보 Supabase 불러오기 실패 · 이 기기 자료 유지") {
        setGeneralInfoSupabaseStatus("일반 정보 Supabase 불러오기 실패 · 이 기기 자료 유지");
      }
    }
  }, []);



  const deleteGeneralInfoItemFromSupabase = useCallback(async (itemId: number) => {
    try {
      if (generalInfoSupabaseStatusRef.current !== "일반 정보 Supabase 삭제 중") {
        setGeneralInfoSupabaseStatus("일반 정보 Supabase 삭제 중");
      }

      const response = await fetch("/api/general-info", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: itemId }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || "일반 정보 Supabase 삭제 실패");
      }

      if (generalInfoSupabaseStatusRef.current !== "일반 정보 Supabase 삭제 완료") {
        setGeneralInfoSupabaseStatus("일반 정보 Supabase 삭제 완료");
      }
    } catch (error) {
      console.error("travel-diary general info delete failed", error);
      if (generalInfoSupabaseStatusRef.current !== "이 기기에는 삭제됨 · Supabase 삭제 실패") {
        setGeneralInfoSupabaseStatus("이 기기에는 삭제됨 · Supabase 삭제 실패");
      }
    }
  }, []);

  // --- 일반 정보 백업 및 취소/리셋 핸들러 ---
  const backupCurrentGeneralInfoDraft = useCallback(() => {
    setGeneralInfoDraftBackup({ ...generalInfoDraft });
  }, [generalInfoDraft]);

  const resetGeneralInfoRichTextEditor = useCallback((text = "", html = "") => {
    setGeneralInfoRichTextInitialHtml(
      html && html.trim() ? html : makeGeneralInfoHtmlFromText(text),
    );
    setGeneralInfoRichTextEditorKey((prev) => prev + 1);
  }, []);

  const handleResetGeneralInfoDraft = useCallback(() => {
    backupCurrentGeneralInfoDraft();
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoEditingId(null);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft(initialGeneralInfoDraft);
    resetGeneralInfoRichTextEditor("", "");
    showPasteHint("🧹 일반 정보 현재 입력을 삭제했습니다. 필요하면 [직전 입력 되돌리기]로 복원할 수 있습니다.");
  }, [backupCurrentGeneralInfoDraft, resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleUndoGeneralInfoDraft = useCallback(() => {
    if (!generalInfoDraftBackup) {
      showPasteHint("되돌릴 직전 입력 내용이 없습니다.");
      return;
    }

    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoDraft(generalInfoDraftBackup);
    resetGeneralInfoRichTextEditor(
      generalInfoDraftBackup.text || "",
      String(generalInfoDraftBackup.formattedTextHtml || ""),
    );
    setGeneralInfoDraftBackup(null);
    showPasteHint("↩️ 직전 입력 상태로 되돌렸습니다.");
  }, [generalInfoDraftBackup, resetGeneralInfoRichTextEditor, showPasteHint]);

  // --- URL 추출 및 편집기 도우미 ---
  const applyExtractedGeneralInfoUrlResult = useCallback((
    result: {
      url?: string;
      title?: string;
      text?: string;
      description?: string;
      image?: string;
      siteName?: string;
    },
    fallbackUrl: string,
  ) => {
    const title = String(result.title || "").trim();
    const text = String(result.text || result.description || "").trim();
    const image = String(result.image || "").trim();
    const siteName = String(result.siteName || "").trim();

    if (image) {
      setGeneralInfoImageLoadFailed(false);
    }

    const nextText = [generalInfoDraft.text, text].filter(Boolean).join(generalInfoDraft.text && text ? "\n\n" : "");

    setGeneralInfoDraft((prev) => ({
      ...prev,
      title: prev.title || title || siteName || fallbackUrl,
      text: nextText,
      sourceUrl: String(result.url || fallbackUrl),
      fileName: image ? title || siteName || "URL 대표 이미지" : prev.fileName,
      filePreview: image || prev.filePreview,
      fileType: image ? "image" : prev.fileType,
      mediaItems: image
        ? [
            ...normalizeGeneralInfoMediaItems(prev),
            makeGeneralInfoMediaItem(title || siteName || "URL 대표 이미지", "image", image),
          ]
        : normalizeGeneralInfoMediaItems(prev),
      summary: text ? text.slice(0, 160) : prev.summary,
    }));

    resetGeneralInfoRichTextEditor(nextText, "");

    showPasteHint(
      image
        ? "✅ URL 대표 이미지와 본문을 안전하게 가져왔습니다."
        : "✅ URL 본문 텍스트를 가져왔습니다.",
    );
  }, [generalInfoDraft.text, resetGeneralInfoRichTextEditor, showPasteHint]);

  const extractGeneralInfoUrl = useCallback(async (targetUrl: string) => {
    const response = await fetch("/api/extract-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: targetUrl }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      console.error("travel-diary extract url failed", data);
      throw new Error(
        data.detail
          ? `URL 가져오기 실패: ${String(data.detail).slice(0, 120)}`
          : data.error || "URL 내용을 가져오지 못했습니다.",
      );
    }

    applyExtractedGeneralInfoUrlResult(data.result || {}, targetUrl);
  }, [applyExtractedGeneralInfoUrlResult]);

  const getCurrentGeneralInfoRichTextHtml = useCallback(() => {
    const html = String(generalInfoRichTextRef.current?.innerHTML || "").trim();
    if (html) return html;
    if (generalInfoRichTextInitialHtml.trim()) return generalInfoRichTextInitialHtml;
    return makeGeneralInfoHtmlFromText(generalInfoDraft.text || "");
  }, [generalInfoDraft.text, generalInfoRichTextInitialHtml]);

  const syncGeneralInfoRichTextToDraft = useCallback(() => {
    const plainText = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");

    setGeneralInfoDraft((prev) => ({
      ...prev,
      text: plainText,
    }));
  }, []);

  const getGeneralInfoToolbarButtonStyle = useCallback((
    color = "#e5e7eb",
    borderColor = "rgba(56, 189, 248, 0.42)",
  ): React.CSSProperties => ({
    appearance: "none",
    WebkitAppearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
    minWidth: 76,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid " + borderColor,
    background: "linear-gradient(180deg, rgba(30,41,59,0.98), rgba(15,23,42,0.98))",
    color,
    fontSize: 12,
    fontWeight: 900,
    lineHeight: 1.2,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 6px 14px rgba(0,0,0,0.18)",
  }), []);

  const handleGeneralInfoRichCommand = useCallback((command: string, value?: string) => {
    generalInfoRichTextRef.current?.focus();
    document.execCommand(command, false, value);
    syncGeneralInfoRichTextToDraft();
  }, [syncGeneralInfoRichTextToDraft]);

  const decodeGeneralInfoPastedText = useCallback((value: string) => {
    const rawValue = String(value || "");
    const basicDecoded = rawValue
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\\u0026/g, "&")
      .replace(/\\n/g, "\n")
      .replace(/[\u200B-\u200D\uFEFF]/g, "");

    return basicDecoded
      .normalize("NFKC")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }, []);

  const handleGeneralInfoFileUpload = useCallback((files: FileList | null) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    let loadedCount = 0;
    const loadedItems: Array<{
      id: number;
      name: string;
      type: "none" | "image" | "video";
      preview: string;
    }> = [];

    fileList.forEach((file) => {
      const fileType = file.type.startsWith("video/") ? "video" : "image";
      const reader = new FileReader();

      reader.onload = (event) => {
        const preview = String(event.target?.result || "");
        if (preview) {
          loadedItems.push(makeGeneralInfoMediaItem(file.name, fileType, preview));
        }

        loadedCount += 1;

        if (loadedCount === fileList.length) {
          setGeneralInfoImageLoadFailed(false);
          setGeneralInfoDraft((prev) => {
            const previousItems = normalizeGeneralInfoMediaItems(prev);
            const nextMediaItems = [...previousItems, ...loadedItems];
            const mainMedia = nextMediaItems[0];

            return {
              ...prev,
              fileName: mainMedia?.name || "",
              fileType: mainMedia?.type || "none",
              filePreview: mainMedia?.preview || "",
              mediaItems: nextMediaItems,
            };
          });

          showPasteHint(
            fileList.length > 1
              ? `✅ 이미지/동영상 자료 ${fileList.length}개 추가`
              : loadedItems[0]?.type === "video"
                ? "✅ 동영상 자료 추가"
                : "✅ 이미지 자료 추가",
          );
        }
      };

      reader.readAsDataURL(file);
    });
  }, [showPasteHint]);

  const handleGeneralInfoRichPaste = useCallback((
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => {
    const clipboardData = event.clipboardData;
    const pastedFiles: File[] = [];

    if (clipboardData?.files && clipboardData.files.length > 0) {
      Array.from(clipboardData.files).forEach((file) => {
        if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
          pastedFiles.push(file);
        }
      });
    }

    if (pastedFiles.length > 0) {
      event.preventDefault();
      const transfer = new DataTransfer();
      pastedFiles.forEach((file) => transfer.items.add(file));
      handleGeneralInfoFileUpload(transfer.files);
      return;
    }

    event.preventDefault();

    const pastedText =
      clipboardData?.getData("text/plain") ||
      clipboardData?.getData("text/uri-list") ||
      clipboardData?.getData("text/html") ||
      "";

    if (!pastedText.trim()) {
      showPasteHint("붙여넣은 내용이 없습니다.");
      return;
    }

    const cleanedText = decodeGeneralInfoPastedText(pastedText);

    document.execCommand("insertText", false, cleanedText);
    syncGeneralInfoRichTextToDraft();
    showPasteHint("✅ Text를 편집기에 붙여넣었습니다.");
  }, [decodeGeneralInfoPastedText, syncGeneralInfoRichTextToDraft, showPasteHint, handleGeneralInfoFileUpload]);

  const handleExtractGeneralInfoUrl = useCallback(async () => {
    const targetUrl = generalInfoDraft.sourceUrl.trim();

    if (!targetUrl) {
      showPasteHint("⚠️ 출처 URL을 먼저 입력하세요.");
      return;
    }

    if (!/^https?:\/\//i.test(targetUrl)) {
      showPasteHint("⚠️ http 또는 https로 시작하는 URL을 입력하세요.");
      return;
    }

    try {
      setIsExtractingGeneralInfoUrl(true);
      showPasteHint("🔎 URL 내용을 자동으로 가져오는 중입니다.");
      await extractGeneralInfoUrl(targetUrl);
    } catch (error) {
      console.error("travel-diary extract url error", error);
      showPasteHint("⚠️ URL 자동 가져오기 중 오류가 발생했습니다.");
    } finally {
      setIsExtractingGeneralInfoUrl(false);
    }
  }, [generalInfoDraft.sourceUrl, extractGeneralInfoUrl, showPasteHint]);

  const applyGeneralInfoPastedText = useCallback(async (rawText: string, sourceLabel = "외부 앱") => {
    const text = rawText.trim();
    if (!text) {
      showPasteHint("⚠️ 붙여넣은 내용이 없습니다.");
      return;
    }

    backupCurrentGeneralInfoDraft();

    const urlMatch = text.match(/https?:\/\/\S+/i);
    const firstUrl = urlMatch?.[0]?.replace(/[),.\]]+$/g, "") || "";

    if (firstUrl) {
      setGeneralInfoDraft((prev) => ({
        ...prev,
        sourceUrl: firstUrl,
        text:
          text === firstUrl
            ? prev.text
            : [prev.text, text].filter(Boolean).join(prev.text ? "\n\n" : ""),
        title: prev.title || text.split(/\r?\n/).find(Boolean)?.slice(0, 80) || "URL 자료",
      }));

      try {
        await extractGeneralInfoUrl(firstUrl);
        showPasteHint("✅ URL을 붙여넣어 자동 수집했습니다.");
      } catch (error) {
        console.error("travel-diary pasted url extract failed", error);
        showPasteHint("⚠️ URL은 입력했지만 자동 가져오기는 실패했습니다.");
      }
      return;
    }

    const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
    const nextText = [generalInfoDraft.text, text].filter(Boolean).join(generalInfoDraft.text ? "\n\n" : "");

    setGeneralInfoDraft((prev) => ({
      ...prev,
      title: prev.title || firstLine.slice(0, 80) || "붙여넣은 Text 자료",
      text: nextText,
      summary: prev.summary || text.slice(0, 160),
    }));

    resetGeneralInfoRichTextEditor(nextText, "");

    showPasteHint("✅ Text를 일반 정보 자료로 붙여넣었습니다.");
  }, [generalInfoDraft.text, backupCurrentGeneralInfoDraft, extractGeneralInfoUrl, resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleGeneralInfoManualPaste = useCallback(async (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.trim()) return;

    event.preventDefault();
    await applyGeneralInfoPastedText(text);
  }, [applyGeneralInfoPastedText]);

  // --- 클립보드 자동 수집 및 이미지/파일 업로드 ---
  const handleCollectGeneralInfoFromClipboard = useCallback(async () => {
    try {
      backupCurrentGeneralInfoDraft();
      setIsCollectingGeneralInfoClipboard(true);
      showPasteHint("📋 클립보드 내용을 확인하는 중입니다.");

      let handled = false;

      if (navigator.clipboard?.read) {
        try {
          const clipboardItems = await navigator.clipboard.read();

          for (const clipboardItem of clipboardItems) {
            const imageType = clipboardItem.types.find((type) =>
              type.startsWith("image/"),
            );

            if (imageType) {
              const blob = await clipboardItem.getType(imageType);
              const reader = new FileReader();

              await new Promise<void>((resolve, reject) => {
                reader.onload = () => {
                  setGeneralInfoImageLoadFailed(false);
                  const preview = String(reader.result || "");
                  const name = `clipboard-image-${Date.now()}.png`;

                  setGeneralInfoDraft((prev) => {
                    const nextMediaItems = [
                      ...normalizeGeneralInfoMediaItems(prev),
                      makeGeneralInfoMediaItem(name, "image", preview),
                    ];

                    return {
                      ...prev,
                      title: prev.title || "클립보드 이미지 자료",
                      fileName: prev.fileName || name,
                      filePreview: prev.filePreview || preview,
                      fileType: "image",
                      mediaItems: nextMediaItems,
                    };
                  });
                  resolve();
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });

              handled = true;
              showPasteHint("✅ 클립보드 이미지를 일반 정보 자료로 추가했습니다.");
              break;
            }
          }
        } catch (error) {
          console.warn("travel-diary clipboard image read skipped", error);
        }
      }

      let clipboardText = "";
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch (error) {
        console.warn("travel-diary clipboard text read failed", error);
      }

      const text = clipboardText.trim();

      if (text) {
        const urlMatch = text.match(/https?:\/\/\S+/i);
        const firstUrl = urlMatch?.[0]?.replace(/[),.\]]+$/g, "") || "";

        if (firstUrl) {
          setGeneralInfoDraft((prev) => ({
            ...prev,
            sourceUrl: firstUrl,
            text:
              text === firstUrl
                ? prev.text
                : [prev.text, text].filter(Boolean).join(prev.text ? "\n\n" : ""),
            title: prev.title || text.split(/\r?\n/).find(Boolean)?.slice(0, 80) || "URL 자료",
          }));

          try {
            await extractGeneralInfoUrl(firstUrl);
            handled = true;
            showPasteHint("✅ 클립보드 URL을 자동 수집했습니다.");
          } catch (error) {
            handled = true;
            showPasteHint(`⚠️ URL 자동 가져오기는 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
          const nextText = [generalInfoDraft.text, text].filter(Boolean).join(generalInfoDraft.text ? "\n\n" : "");
          setGeneralInfoDraft((prev) => ({
            ...prev,
            title: prev.title || firstLine.slice(0, 80) || "클립보드 Text 자료",
            text: nextText,
            summary: prev.summary || text.slice(0, 160),
          }));

          resetGeneralInfoRichTextEditor(nextText, "");

          handled = true;
          showPasteHint("✅ 클립보드 Text를 일반 정보 자료로 추가했습니다.");
        }
      }

      if (!handled) {
        showPasteHint("⚠️ 클립보드에서 가져올 내용이 없습니다. 입력창에 직접 붙여넣으세요.");
      }
    } catch (error) {
      console.error("travel-diary general info clipboard collect failed", error);
      showPasteHint("⚠️ 클립보드 자동 수집 중 오류가 발생했습니다.");
    } finally {
      setIsCollectingGeneralInfoClipboard(false);
    }
  }, [generalInfoDraft.text, backupCurrentGeneralInfoDraft, extractGeneralInfoUrl, resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleClearGeneralInfoCoverImage = useCallback(() => {
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoDraft((prev) => ({
      ...prev,
      fileName: "",
      filePreview: "",
      fileType: "none",
      mediaItems: [],
    }));
    showPasteHint("대표 이미지와 추가 이미지를 모두 삭제했습니다.");
  }, [showPasteHint]);

  const handleRemoveGeneralInfoMediaItem = useCallback((targetIndex: number) => {
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoDraft((prev) => {
      const currentMediaItems = normalizeGeneralInfoMediaItems(prev);
      const nextMediaItems = currentMediaItems.filter((_, index) => index !== targetIndex);
      const mainMedia = nextMediaItems[0];

      return {
        ...prev,
        fileName: mainMedia?.name || "",
        filePreview: mainMedia?.preview || "",
        fileType: mainMedia?.type || "none",
        mediaItems: nextMediaItems,
      };
    });
    showPasteHint("🗑️ 이미지/동영상 자료를 삭제했습니다.");
  }, [showPasteHint]);

  const handleGeneralInfoIphonePasteZonePaste = useCallback((
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
  }, [handleGeneralInfoFileUpload, applyGeneralInfoPastedText, showPasteHint]);

  // --- AI 분석 및 자료 저장/수정 핸들러 ---
  const handleAnalyzeGeneralInfoDraft = useCallback(async () => {
    const hasInput =
      generalInfoDraft.title.trim() ||
      generalInfoDraft.text.trim() ||
      generalInfoDraft.sourceUrl.trim() ||
      generalInfoDraft.filePreview.trim() ||
      normalizeGeneralInfoMediaItems(generalInfoDraft).length > 0;

    if (!hasInput) {
      showPasteHint("⚠️ 먼저 Text, URL, 이미지 중 하나 이상 입력하세요.");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      setIsAnalyzingGeneralInfo(true);
      showPasteHint("🤖 Gemini가 일반 정보를 분석하는 중입니다.");

      const customApiKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
      const response = await fetch("/api/analyze-general-info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": customApiKey,
        },
        body: JSON.stringify({
          title: generalInfoDraft.title,
          text: generalInfoDraft.text,
          sourceUrl: generalInfoDraft.sourceUrl,
          fileName: generalInfoDraft.fileName,
          fileType: generalInfoDraft.fileType,
          summary: generalInfoDraft.summary,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || "Gemini 분석 실패");
      }

      const result = data.result || {};

      setGeneralInfoKeywordText(
        Array.isArray(result.keywords)
          ? result.keywords.map((keyword: string) => `#${String(keyword).replace(/^#+/, "")}`).join(", ")
          : generalInfoKeywordText,
      );

      setGeneralInfoDraft((prev) => ({
        ...prev,
        title: result.title || prev.title,
        summary: result.summary || prev.summary,
        primaryCategory: result.primaryCategory || prev.primaryCategory,
        secondaryCategory: result.secondaryCategory || prev.secondaryCategory,
        thirdCategory: result.thirdCategory || prev.thirdCategory,
        keywords: Array.isArray(result.keywords) ? result.keywords : prev.keywords,
        factCheckStatus: result.factCheckStatus || prev.factCheckStatus,
        factCheckSummary: result.factCheckSummary || prev.factCheckSummary,
      }));

      showPasteHint("🤖 Gemini 일반 정보 분석 완료 · 확인 후 저장하세요.");
    } catch (error) {
      console.error("travel-diary general info Gemini analysis failed", error);
      const analyzed = mockAnalyzeGeneralInfo(generalInfoDraft);
      setGeneralInfoKeywordText(
        analyzed.keywords.map((keyword) => `#${String(keyword).replace(/^#+/, "")}`).join(", "),
      );
      setGeneralInfoDraft(analyzed);
      showPasteHint("⚠️ Gemini 분석 실패 · 임시 Mock 자동분류로 처리했습니다.");
    } finally {
      setIsAnalyzingGeneralInfo(false);
    }
  }, [generalInfoDraft, generalInfoKeywordText, showPasteHint]);

  const dataUrlToGeneralInfoFile = useCallback(async (dataUrl: string, fileName: string) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], fileName, { type: blob.type });
  }, []);

  const uploadGeneralInfoMediaItemsToSupabaseStorage = useCallback(async (
    draftMediaItems: GeneralInfoMediaItem[]
  ): Promise<GeneralInfoMediaItem[]> => {
    const uploadedItems: GeneralInfoMediaItem[] = [];

    for (const media of draftMediaItems) {
      const isBase64 = String(media.preview).startsWith("data:");

      if (isBase64) {
        try {
          const file = await dataUrlToGeneralInfoFile(media.preview, media.name);
          const result = await uploadFileToSupabaseStorage(file);
          uploadedItems.push({
            ...media,
            preview: result.fileUrl,
            fileUrl: result.fileUrl,
            storagePath: result.storagePath,
          });
        } catch (error) {
          console.error("Supabase 일반 정보 이미지 업로드 실패:", error);
          uploadedItems.push(media);
        }
      } else {
        uploadedItems.push(media);
      }
    }

    return uploadedItems;
  }, [dataUrlToGeneralInfoFile]);

  const handleSaveTemporaryGeneralInfoDraft = useCallback(() => {
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

  const handleConfirmGeneralInfo = useCallback(async () => {
    const analyzed =
      generalInfoDraft.primaryCategory ||
      generalInfoDraft.secondaryCategory ||
      generalInfoDraft.thirdCategory ||
      generalInfoDraft.summary ||
      generalInfoDraft.keywords.length > 0
        ? generalInfoDraft
        : mockAnalyzeGeneralInfo(generalInfoDraft);

    const inputTypes: GeneralInfoItem["inputTypes"] = [];
    const draftMediaItems = normalizeGeneralInfoMediaItems(analyzed);

    const hasDraftImage = draftMediaItems.some((media) => media.type === "image");
    const hasDraftVideo = draftMediaItems.some((media) => media.type === "video");

    let uploadedDraftMediaItems = draftMediaItems;

    if (hasDraftImage) {
      showPasteHint("⏳ 일반 정보 이미지 Supabase Storage 업로드 중");
      uploadedDraftMediaItems = await uploadGeneralInfoMediaItemsToSupabaseStorage(draftMediaItems);
      showPasteHint("✅ 일반 정보 이미지 Supabase Storage 업로드 완료");
    }

    const uploadedMainMedia = uploadedDraftMediaItems[0];

    if (analyzed.text.trim()) inputTypes.push("text");
    if (analyzed.sourceUrl.trim()) inputTypes.push("url");
    if (analyzed.fileType === "image" || hasDraftImage) inputTypes.push("image");
    if (analyzed.fileType === "video" || hasDraftVideo) inputTypes.push("video");

    if (
      !analyzed.title.trim() &&
      !analyzed.text.trim() &&
      !analyzed.sourceUrl.trim() &&
      draftMediaItems.length === 0
    ) {
      showPasteHint("⚠️ 저장할 일반 정보가 없습니다.");
      return;
    }

    const finalTitle = (() => {
      const t = (analyzed.title || "").trim();
      const isGeneric = !t || [
        "일반 정보 자료",
        "붙여넣은 text 자료",
        "클립보드 text 자료",
        "url 자료",
        "클립보드 이미지 자료"
      ].includes(t.toLowerCase());
      
      if (isGeneric && analyzed.text.trim()) {
        const lines = analyzed.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          const firstLine = lines[0].replace(/<[^>]*>/g, "").trim();
          if (firstLine) {
            return firstLine.length > 40 ? firstLine.slice(0, 40) + "..." : firstLine;
          }
        }
      }
      return analyzed.title || analyzed.summary || analyzed.sourceUrl || analyzed.fileName || "일반 정보 자료";
    })();

    const item: GeneralInfoItem = {
      id: Date.now(),
      title: finalTitle,
      inputTypes,
      text: analyzed.text,
      formattedTextHtml: getCurrentGeneralInfoRichTextHtml(),
      sourceUrl: analyzed.sourceUrl || undefined,
      fileName: analyzed.fileName || uploadedMainMedia?.name || undefined,
      filePreview: uploadedMainMedia?.preview || analyzed.filePreview || undefined,
      mediaItems: uploadedDraftMediaItems,
      primaryCategory: analyzed.primaryCategory || "사회",
      secondaryCategory: analyzed.secondaryCategory || "일반",
      thirdCategory: analyzed.thirdCategory || "기타",
      keywords: analyzed.keywords,
      factCheckStatus: analyzed.factCheckStatus,
      factCheckSummary: analyzed.factCheckSummary,
      summary: analyzed.summary,
      extraNote: "",
      confirmed: true,
      createdAt: nowText(),
    };

    if (generalInfoEditingId) {
      const existingGeneralInfoItem = generalInfoItems.find(
        (prevItem) => prevItem.id === generalInfoEditingId,
      );

      const updatedItem: GeneralInfoItem = {
        ...item,
        id: existingGeneralInfoItem?.id || generalInfoEditingId,
        createdAt: existingGeneralInfoItem?.createdAt || item.createdAt,
        extraNote: existingGeneralInfoItem?.extraNote || "",
        filePreview: uploadedMainMedia?.preview || item.filePreview || existingGeneralInfoItem?.filePreview,
        mediaItems: uploadedDraftMediaItems,
      };

      setGeneralInfoItems((prev) => {
        const nextItems = prev.map((prevItem) =>
          prevItem.id === generalInfoEditingId ? updatedItem : prevItem,
        );
        persistGeneralInfoItemsToLocalStorage(nextItems);
        return nextItems;
      });

      void syncGeneralInfoItemToSupabase(updatedItem, "PUT");

      setGeneralInfoDraftBackup(null);
      setGeneralInfoImageLoadFailed(false);
      setGeneralInfoEditingId(null);
      setGeneralInfoKeywordText("");
      setGeneralInfoDraft(initialGeneralInfoDraft);
      resetGeneralInfoRichTextEditor("", "");
      localStorage.removeItem("travel_diary_general_info_temp_draft");
      showPasteHint("✅ 수정 저장 완료 · 새 일반 정보 입력 준비 완료");
      return;
    }

    setGeneralInfoItems((prev) => {
      const nextItems = [item, ...prev];
      persistGeneralInfoItemsToLocalStorage(nextItems);
      return nextItems;
    });

    void syncGeneralInfoItemToSupabase(item, "POST");

    setGeneralInfoDraftBackup(null);
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft(initialGeneralInfoDraft);
    resetGeneralInfoRichTextEditor("", "");
    localStorage.removeItem("travel_diary_general_info_temp_draft");
    showPasteHint("✅ 저장 완료 · 새 일반 정보 입력 준비 완료");
  }, [
    generalInfoDraft,
    generalInfoEditingId,
    generalInfoItems,
    getCurrentGeneralInfoRichTextHtml,
    resetGeneralInfoRichTextEditor,
    showPasteHint,
    syncGeneralInfoItemToSupabase,
    uploadGeneralInfoMediaItemsToSupabaseStorage,
  ]);

  const handleStartEditGeneralInfo = useCallback((item: GeneralInfoItem) => {
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoEditingId(item.id);
    setGeneralInfoDetailId(null);
    setGeneralInfoActiveTab("collect"); // 수정 시 자동으로 수집 탭 전환

    setGeneralInfoKeywordText(
      (item.keywords || []).map((keyword) => `#${String(keyword).replace(/^#+/, "")}`).join(", "),
    );

    resetGeneralInfoRichTextEditor(
      item.text || "",
      String(item.formattedTextHtml || ""),
    );

    setGeneralInfoDraft({
      title: item.title || "",
      text: item.text || "",
      sourceUrl: item.sourceUrl || "",
      fileName: item.fileName || "",
      filePreview: item.filePreview || "",
      mediaItems: normalizeGeneralInfoMediaItems(item),
      fileType: item.inputTypes.includes("video")
        ? "video"
        : item.inputTypes.includes("image")
          ? "image"
          : "none",
      primaryCategory: item.primaryCategory || "",
      secondaryCategory: item.secondaryCategory || "",
      thirdCategory: item.thirdCategory || "",
      keywords: item.keywords || [],
      summary: item.summary || "",
      factCheckStatus: item.factCheckStatus || "확인 전",
      factCheckSummary: item.factCheckSummary || "",
    });

    showPasteHint("✏️ 저장된 일반 정보를 수정 모드로 불러왔습니다.");

    // Scroll to the edit form and focus the title input for direct editing
    setTimeout(() => {
      const editForm = document.querySelector(".generalInfoLayoutGrid .leftColumn");
      if (editForm) {
        editForm.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      const titleInput = document.querySelector(".generalInfoLayoutGrid input[placeholder*='정보 제목']");
      if (titleInput instanceof HTMLInputElement) {
        titleInput.focus();
      }
    }, 120);
  }, [resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleCancelEditGeneralInfo = useCallback(() => {
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoEditingId(null);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft(initialGeneralInfoDraft);
    resetGeneralInfoRichTextEditor("", "");
    showPasteHint("수정 모드를 취소했습니다.");
  }, [resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleUpdateGeneralInfoExtraNote = useCallback(async (itemId: number, value: string) => {
    const targetItem = generalInfoItems.find((item) => item.id === itemId);
    const updatedItem = targetItem ? { ...targetItem, extraNote: value } : null;

    setGeneralInfoItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, extraNote: value } : item))
    );

    if (updatedItem) {
      await syncGeneralInfoItemToSupabase(updatedItem, "PUT");
    }
  }, [generalInfoItems, syncGeneralInfoItemToSupabase]);

  const handleDeleteGeneralInfo = useCallback((itemId: number) => {
    const targetItem = generalInfoItems.find((item) => item.id === itemId);
    const ok = window.confirm("이 일반 정보 자료를 정말 삭제할까요?");
    if (!ok) return;

    setGeneralInfoItems((prev) => {
      const nextItems = prev.filter((item) => item.id !== itemId);
      persistGeneralInfoItemsToLocalStorage(nextItems);
      return nextItems;
    });

    setGeneralInfoDetailId((prev) => (prev === itemId ? null : prev));

    if (generalInfoEditingId === itemId) {
      setGeneralInfoEditingId(null);
      setGeneralInfoDraft(initialGeneralInfoDraft);
      resetGeneralInfoRichTextEditor("", "");
    }

    if (targetItem) {
      void deleteGeneralInfoItemFromSupabase(itemId);
    }
    showPasteHint("🗑️ 일반 정보를 삭제했습니다.");
  }, [generalInfoItems, generalInfoEditingId, deleteGeneralInfoItemFromSupabase, resetGeneralInfoRichTextEditor, showPasteHint]);

  // --- AI 보고서 및 Fact Check 작성 핸들러 ---
  const buildGeneralInfoFactCheckPayload = useCallback((item: GeneralInfoItem) => {
    const mediaItems = normalizeGeneralInfoMediaItems(item);
    return {
      title: item.title,
      text: item.text,
      sourceUrl: item.sourceUrl,
      summary: item.summary,
      factCheckSummary: item.factCheckSummary,
      extraNote: item.extraNote,
      categoryPath: getGeneralInfoCategoryPath(item),
      keywords: item.keywords || [],
      mediaSummary: getGeneralInfoInputCountText(item),
      mediaItems,
      pdfText: "",
    };
  }, []);

  const handleGenerateGeneralInfoReport = useCallback(async (item: GeneralInfoItem, forceRegenerate = false) => {
    // If the item already has a generated report (longer than 150 chars and containing markdown headers), just display it!
    if (!forceRegenerate && item.factCheckSummary && item.factCheckSummary.length > 150 && item.factCheckSummary.includes("##")) {
      setGeneralInfoReportItem(item);
      setGeneralInfoReportText(item.factCheckSummary);
      showPasteHint("✅ 보관된 AI 보고서를 불러왔습니다.");
      return;
    }

    const makeFallbackReport = (
      source: GeneralInfoItem,
      apiData?: {
        summary?: string;
        easyReport?: string;
        easyExplanation?: string;
        result?: string;
      },
    ) => {
      const title = source?.title || "AI 보고서";
      const category = getGeneralInfoCategoryPath(source);
      const factLabel = getGeneralInfoFactLabel(source);
      const inputCount = getGeneralInfoInputCountText(source);

      return [
        "## 수동 입력 보고서",
        "",
        "※ Gemini API 호출에 오류가 발생하여 수동 템플릿으로 표시합니다.",
        "",
        "# " + title,
        "",
        "## 1. 자료 기본 정보",
        "- 분류: " + category,
        "- 입력 자료: " + inputCount,
        "- Fact Check 상태: " + factLabel,
        "",
        "## 2. 핵심 요약",
        String(apiData?.summary || source?.factCheckSummary || source?.summary || "현재 저장된 자료를 기준으로 AI 보고서가 준비되었습니다."),
        "",
        "## 3. 원문/근거 자료",
        String(source?.text || (source as any)?.body || (source as any)?.content || "저장된 원문 Text가 충분하지 않습니다."),
        "",
        "## 4. 확인 필요 사항",
        "- 수치, 날짜, 출처가 있는 내용은 원문 자료와 함께 다시 확인하는 것이 좋습니다.",
        "",
        "## 5. 쉬운 설명",
        String(apiData?.easyReport || apiData?.easyExplanation || apiData?.result || source?.factCheckSummary || source?.summary || "이 자료는 저장된 정보를 바탕으로 정리된 일반 정보 보고서입니다."),
      ].join("\n");
    };

    try {
      setGeneralInfoReportItem(item);
      setGeneralInfoReportText(
        makeFallbackReport(item, {
          summary: "Gemini 보고서 생성 전입니다.",
        })
      );

      setIsGeneratingGeneralInfoReport(true);
      showPasteHint("📄 AI 보고서를 작성합니다.");

      const customApiKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
      const response = await fetch("/api/general-info-factcheck", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": customApiKey,
        },
        body: JSON.stringify(buildGeneralInfoFactCheckPayload(item)),
      });

      let data: {
        error?: string;
        message?: string;
        status?: string;
        factCheckStatus?: string;
        summary?: string;
        factCheckSummary?: string;
        result?: string;
        report?: string;
        reportText?: string;
        markdown?: string;
        content?: string;
        text?: string;
        easyReport?: string;
        easyExplanation?: string;
        ok?: boolean;
      } = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(String(data?.error || data?.message || "AI 보고서 API 호출 실패"));
      }

      const rawStatus = String(data.status || data.factCheckStatus || item.factCheckStatus || "확인 필요");
      const nextStatus = (
        rawStatus === "확인 완료" || rawStatus === "확인 필요" || rawStatus === "오류 가능성"
          ? rawStatus
          : "확인 필요"
      ) as GeneralInfoItem["factCheckStatus"];

      const candidateReport = [
        data.result,
        data.report,
        data.reportText,
        data.markdown,
        data.content,
        data.text,
        data.easyReport,
        data.easyExplanation,
      ]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value.length > 0);

      const apiMessageText = JSON.stringify(data || {});
      const isGeminiCreditDepleted =
        apiMessageText.includes("RESOURCE_EXHAUSTED") ||
        apiMessageText.includes("prepayment credits") ||
        apiMessageText.includes("credits are depleted") ||
        apiMessageText.includes("429");

      const nextReport = isGeminiCreditDepleted
        ? makeFallbackReport(item, {
            summary: "Gemini 크레딧 소진으로 수동 입력용 양식으로 대체합니다.",
          })
        : candidateReport || makeFallbackReport(item, data);

      const updatedReportItem = {
        ...item,
        factCheckStatus: nextStatus,
        factCheckSummary: nextReport, // Store the full markdown report here!
      };

      setGeneralInfoItems((prev) => {
        const nextItems = prev.map((savedItem) =>
          savedItem.id === item.id ? updatedReportItem : savedItem
        );
        persistGeneralInfoItemsToLocalStorage(nextItems);
        return nextItems;
      });

      setGeneralInfoReportItem(updatedReportItem);
      setGeneralInfoReportText(nextReport);
      showPasteHint("✅ AI 보고서 준비 완료. PDF 저장/공유가 가능합니다.");

      // Sync the updated report item to Supabase!
      void syncGeneralInfoItemToSupabase(updatedReportItem, "PUT");
    } catch (error) {
      console.error("general info report failed", error);
      setGeneralInfoReportItem(item);
      setGeneralInfoReportText(makeFallbackReport(item, { summary: "보고서 생성 중 오류 발생." }));
      showPasteHint("⚠️ AI 보고서 작성 중 오류가 발생했습니다.");
    } finally {
      setIsGeneratingGeneralInfoReport(false);
    }
  }, [buildGeneralInfoFactCheckPayload, showPasteHint, syncGeneralInfoItemToSupabase]);

  const handleCopyGeneralInfoReport = useCallback(async () => {
    if (!generalInfoReportText.trim()) {
      showPasteHint("복사할 보고서가 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(generalInfoReportText);
      showPasteHint("✅ 보고서를 클립보드에 복사했습니다.");
    } catch {
      showPasteHint("⚠️ 자동 복사 실패.");
    }
  }, [generalInfoReportText, showPasteHint]);

  const handleShareGeneralInfoReport = useCallback(async () => {
    if (!generalInfoReportText.trim()) {
      showPasteHint("공유할 보고서가 없습니다.");
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: generalInfoReportItem?.title || "AI 보고서",
          text: generalInfoReportText,
        });
        showPasteHint("✅ 보고서 공유를 열었습니다.");
      } catch {
        showPasteHint("공유 실패/취소");
      }
      return;
    }
    await handleCopyGeneralInfoReport();
  }, [generalInfoReportText, generalInfoReportItem, handleCopyGeneralInfoReport, showPasteHint]);

  const handlePrintGeneralInfoReport = useCallback(() => {
    window.print();
  }, []);

  const handleRunPreciseGeneralInfoFactCheck = useCallback(async (item: GeneralInfoItem, forceRegenerate = false) => {
    // If the item already has a generated report, and we are not forcing, show it!
    if (!forceRegenerate && item.factCheckSummary && item.factCheckSummary.length > 150 && item.factCheckSummary.includes("##")) {
      setGeneralInfoFactCheckItem(item);
      setGeneralInfoFactCheckResult(item.factCheckSummary);
      setGeneralInfoReportItem(item);
      setGeneralInfoReportText(item.factCheckSummary);
      showPasteHint("✅ 보관된 Fact Check 결과를 불러왔습니다.");
      return;
    }

    try {
      setGeneralInfoFactCheckItem(item);
      setGeneralInfoFactCheckResult("Gemini가 자료를 검증하고 보고서를 작성하는 중입니다.");
      setIsRunningGeneralInfoFactCheck(true);
      showPasteHint("🔎 Gemini가 정밀 검증 중입니다.");

      const customApiKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
      const response = await fetch("/api/general-info-factcheck", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": customApiKey,
        },
        body: JSON.stringify(buildGeneralInfoFactCheckPayload(item)),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "정밀 Fact Check 보고서 작성 실패");
      }

      const rawStatus = String(data.status || "");
      const nextStatus: GeneralInfoItem["factCheckStatus"] =
        rawStatus === "오류 가능성" || rawStatus === "오류 가능"
          ? "오류 가능성"
          : "확인 완료";
      const nextResult = String(data.result || data.summary || "정밀 Fact Check 보고서가 작성되었습니다.");

      const updatedItem = {
        ...item,
        factCheckStatus: nextStatus,
        factCheckSummary: nextResult, // Store the full fact check report in factCheckSummary!
      };

      setGeneralInfoItems((prev) => {
        const nextItems = prev.map((savedItem) =>
          savedItem.id === item.id ? updatedItem : savedItem
        );
        persistGeneralInfoItemsToLocalStorage(nextItems);
        return nextItems;
      });

      setGeneralInfoFactCheckItem((prev) =>
        prev && prev.id === item.id ? updatedItem : prev
      );

      setGeneralInfoFactCheckResult(nextResult);
      setGeneralInfoReportItem(updatedItem);
      setGeneralInfoReportText(nextResult);
      showPasteHint("✅ 정밀 Fact Check 보고서 작성 완료");

      // Sync the updated item to Supabase!
      void syncGeneralInfoItemToSupabase(updatedItem, "PUT");
    } catch (error) {
      console.error("precise general info factcheck failed", error);
      setGeneralInfoFactCheckResult("정밀 Fact Check 작성 실패.");
      showPasteHint("⚠️ 정밀 Fact Check 작성 오류.");
    } finally {
      setIsRunningGeneralInfoFactCheck(false);
    }
  }, [buildGeneralInfoFactCheckPayload, showPasteHint, syncGeneralInfoItemToSupabase]);

  // --- 메모 필터링 ---
  const filteredGeneralInfoItems = useMemo(() => {
    const filtered = filterGeneralInfoItemsBySearch(generalInfoItems, generalInfoSearchTerm);
    return [...filtered].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.id - a.id;
    });
  }, [generalInfoItems, generalInfoSearchTerm]);

  const handleTogglePinGeneralInfo = useCallback((itemId: number) => {
    setGeneralInfoItems((prev) => {
      const nextItems = prev.map((item) =>
        item.id === itemId ? { ...item, isPinned: !item.isPinned } : item
      );
      persistGeneralInfoItemsToLocalStorage(nextItems);
      
      // Also try to sync with Supabase in case it's enabled
      const targetItem = nextItems.find((item) => item.id === itemId);
      if (targetItem) {
        void syncGeneralInfoItemToSupabase(targetItem, "PUT");
      }
      return nextItems;
    });
  }, [syncGeneralInfoItemToSupabase]);

  const handleDeleteGeneralInfoBodyText = useCallback(async (itemId: number) => {
    const targetItem = generalInfoItems.find((item) => item.id === itemId);
    if (!targetItem) return;

    const ok = window.confirm(
      "AI 보고서가 이미 보관되어 있습니다. 데이터 정리(용량 확보)를 위해 원본 본문 텍스트를 정말 삭제하시겠습니까?\n(AI 보고서는 유지됩니다. 이 작업은 되돌릴 수 없습니다.)"
    );
    if (!ok) return;

    const updatedItem = {
      ...targetItem,
      text: "",
      formattedTextHtml: "",
    };

    setGeneralInfoItems((prev) => {
      const nextItems = prev.map((item) => (item.id === itemId ? updatedItem : item));
      persistGeneralInfoItemsToLocalStorage(nextItems);
      return nextItems;
    });

    if (generalInfoReportItem?.id === itemId) {
      setGeneralInfoReportItem(updatedItem);
    }
    if (generalInfoFactCheckItem?.id === itemId) {
      setGeneralInfoFactCheckItem(updatedItem);
    }

    showPasteHint("✅ 원본 본문 텍스트를 삭제했습니다.");
    await syncGeneralInfoItemToSupabase(updatedItem, "PUT");
  }, [
    generalInfoItems,
    generalInfoReportItem,
    generalInfoFactCheckItem,
    syncGeneralInfoItemToSupabase,
    showPasteHint,
  ]);

  const handleSaveGeneralInfoReportText = useCallback(async (itemId: number, text: string) => {
    const targetItem = generalInfoItems.find((item) => item.id === itemId);
    if (!targetItem) return;

    const updatedItem = {
      ...targetItem,
      factCheckSummary: text,
    };

    setGeneralInfoItems((prev) => {
      const nextItems = prev.map((item) => (item.id === itemId ? updatedItem : item));
      persistGeneralInfoItemsToLocalStorage(nextItems);
      return nextItems;
    });

    if (generalInfoReportItem?.id === itemId) {
      setGeneralInfoReportItem(updatedItem);
    }
    if (generalInfoFactCheckItem?.id === itemId) {
      setGeneralInfoFactCheckItem(updatedItem);
    }

    showPasteHint("💾 AI 보고서가 데이터베이스에 저장되었습니다.");
    await syncGeneralInfoItemToSupabase(updatedItem, "PUT");
  }, [
    generalInfoItems,
    generalInfoReportItem,
    generalInfoFactCheckItem,
    syncGeneralInfoItemToSupabase,
    showPasteHint,
  ]);

  // Update isGeneralInfoMobileLayout based on window size
  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkLayout = () => {
      setIsGeneralInfoMobileLayout(window.innerWidth <= 1100);
    };
    checkLayout();
    window.addEventListener("resize", checkLayout);
    return () => window.removeEventListener("resize", checkLayout);
  }, []);

  // Auto-persist generalInfoItems to localStorage whenever they change
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
  }, [resetGeneralInfoRichTextEditor, showPasteHint]);

  // Tab visibility change and periodic (30s) polling sync from Supabase
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("Tab became visible: syncing general info items from Supabase...");
        void loadGeneralInfoItemsFromSupabase();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        console.log("Periodic background sync: loading general info items from Supabase...");
        void loadGeneralInfoItemsFromSupabase();
      }
    }, 30000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [loadGeneralInfoItemsFromSupabase]);

  // Initial sync from Supabase on mount
  useEffect(() => {
    void loadGeneralInfoItemsFromSupabase();
  }, [loadGeneralInfoItemsFromSupabase]);

  const selectedGeneralInfoItem = useMemo(() => {
    return generalInfoItems.find((item) => item.id === generalInfoDetailId) || null;
  }, [generalInfoItems, generalInfoDetailId]);

  return {
    generalInfoDraft,
    setGeneralInfoDraft,
    isGeneralInfoMobileLayout,
    setIsGeneralInfoMobileLayout,
    generalInfoRichTextRef,
    generalInfoRichTextInitialHtml,
    setGeneralInfoRichTextInitialHtml,
    generalInfoRichTextEditorKey,
    setGeneralInfoRichTextEditorKey,
    generalInfoKeywordText,
    setGeneralInfoKeywordText,
    generalInfoItems,
    setGeneralInfoItems,
    generalInfoItemsLocalStorageReadyRef,
    generalInfoSearchTerm,
    setGeneralInfoSearchTerm,
    isExtractingGeneralInfoUrl,
    setIsExtractingGeneralInfoUrl,
    generalInfoDetailId,
    setGeneralInfoDetailId,
    generalInfoActiveTab,
    setGeneralInfoActiveTab,
    generalInfoEditingId,
    setGeneralInfoEditingId,
    isCollectingGeneralInfoClipboard,
    setIsCollectingGeneralInfoClipboard,
    generalInfoImageLoadFailed,
    setGeneralInfoImageLoadFailed,
    generalInfoSupabaseStatus,
    setGeneralInfoSupabaseStatus,
    generalInfoDraftBackup,
    setGeneralInfoDraftBackup,
    isAnalyzingGeneralInfo,
    setIsAnalyzingGeneralInfo,
    generalInfoReportItem,
    setGeneralInfoReportItem,
    generalInfoReportText,
    setGeneralInfoReportText,
    isGeneratingGeneralInfoReport,
    setIsGeneratingGeneralInfoReport,
    generalInfoFactCheckItem,
    setGeneralInfoFactCheckItem,
    generalInfoFactCheckResult,
    setGeneralInfoFactCheckResult,
    isRunningGeneralInfoFactCheck,
    setIsRunningGeneralInfoFactCheck,
    handleStartEditGeneralInfo,
    handleCancelEditGeneralInfo,
    handleUpdateGeneralInfoExtraNote,
    handleDeleteGeneralInfo,
    loadGeneralInfoItemsFromSupabase,
    handleUndoGeneralInfoDraft,
    handleResetGeneralInfoDraft,
    handleSaveTemporaryGeneralInfoDraft,
    handleCollectGeneralInfoFromClipboard,
    handleExtractGeneralInfoUrl,
    handleGeneralInfoFileUpload,
    handleGeneralInfoIphonePasteZonePaste,
    handleClearGeneralInfoCoverImage,
    handleRemoveGeneralInfoMediaItem,
    handleAnalyzeGeneralInfoDraft,
    handleConfirmGeneralInfo,
    filteredGeneralInfoItems,
    generalInfoCategories,
    normalizeGeneralInfoMediaItems,
    getGeneralInfoDisplayMediaItems,
    syncGeneralInfoRichTextToDraft,
    handleGeneralInfoRichPaste,
    handleGeneralInfoRichCommand,
    getGeneralInfoToolbarButtonStyle,
    makeGeneralInfoHtmlFromText,
    selectedGeneralInfoItem,
    handleGenerateGeneralInfoReport,
    handleCopyGeneralInfoReport,
    handleShareGeneralInfoReport,
    handlePrintGeneralInfoReport,
    handleRunPreciseGeneralInfoFactCheck,
    handleTogglePinGeneralInfo,
    handleDeleteGeneralInfoBodyText,
    handleSaveGeneralInfoReportText
  };
}

// Turbopack compilation invalidate cache tag: V2_058_FIX_SUPABASE_LOOP_HMR
