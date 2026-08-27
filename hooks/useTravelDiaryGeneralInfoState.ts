import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { initialGeneralInfoDraft, generalInfoCategories, mockAnalyzeGeneralInfo } from "../lib/generalInfoMock";
import { persistGeneralInfoItemsToLocalStorage, readGeneralInfoItemsFromLocalStorage } from "../lib/generalInfoStorage";

import { supabase } from "../lib/supabaseClient";


import { filterGeneralInfoItemsBySearch, getGeneralInfoCategoryPath, getGeneralInfoDisplayMediaItems, normalizeGeneralInfoMediaItems, makeGeneralInfoMediaItem, makeGeneralInfoHtmlFromText, getGeneralInfoInputCountText, getGeneralInfoFactLabel, extractMarkdownReport, replaceHtmlMediaSources, buildFactCheckReportHtml, extractMediaSrcFromHtml, htmlToPlainText, dataUrlToFile, extractTitleFromPlainText, formatReportHtmlForPdf, isFullAiVerificationReport, buildAiReportFromBodyContent, hasDisplayableAiReport, salvageFactCheckHtml, pickPreferredFactCheckSummary, applyInfographicAsRepresentative, extractFirstInfographicSrc, cleanFactCheckSummaryText } from "../lib/generalInfoHelpers";


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
  showPasteHint,
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
  const [generalInfoAiReportId, setGeneralInfoAiReportId] = useState<number | null>(null);
  const [generalInfoDetailEditMode, setGeneralInfoDetailEditMode] = useState(false);
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
  /** Gemini 크레딧 소진 시 수동 Fact Check 입력이 필요한 항목 id */
  const [generalInfoManualFactCheckId, setGeneralInfoManualFactCheckId] = useState<number | null>(null);
  /** Gemini API 패킷(크레딧) 신호등: available=녹색, depleted=빨간색 */
  const [geminiApiPacketStatus, setGeminiApiPacketStatus] = useState<"available" | "depleted">(() => {
    if (typeof window === "undefined") return "available";
    try {
      return window.localStorage.getItem("gemini_api_packet_status") === "depleted"
        ? "depleted"
        : "available";
    } catch {
      return "available";
    }
  });

  const markGeminiApiPacketsAvailable = useCallback(() => {
    setGeminiApiPacketStatus("available");
    try {
      window.localStorage.setItem("gemini_api_packet_status", "available");
    } catch {}
  }, []);

  const markGeminiApiPacketsDepleted = useCallback(() => {
    setGeminiApiPacketStatus("depleted");
    try {
      window.localStorage.setItem("gemini_api_packet_status", "depleted");
    } catch {}
  }, []);

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
                formattedTextHtml:
                  data.item.formattedTextHtml || prevItem.formattedTextHtml || "",
                factCheckSummary: pickPreferredFactCheckSummary(
                  data.item.factCheckSummary,
                  prevItem.factCheckSummary,
                ),
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
                formattedTextHtml:
                  remoteItem.formattedTextHtml || localItem.formattedTextHtml || "",
                factCheckSummary: pickPreferredFactCheckSummary(
                  remoteItem.factCheckSummary,
                  localItem.factCheckSummary,
                ),
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
    const description = String(result.description || "").trim();
    const text = String(result.text || description || "").trim();
    const image = String(result.image || "")
      .replace(/&#x3d;/gi, "=")
      .replace(/&amp;/g, "&")
      .trim();
    const siteName = String(result.siteName || "").trim();
    const metaTitle = title || siteName;

    if (image) {
      setGeneralInfoImageLoadFailed(false);
    }

    // Text 첫 줄 = 제목 규칙에 맞게, URL 메타 제목을 본문 첫 줄로 넣음
    let bodyBlock = text;
    if (metaTitle) {
      const firstLine = extractTitleFromPlainText(bodyBlock);
      if (!firstLine || firstLine !== metaTitle) {
        bodyBlock = bodyBlock ? `${metaTitle}\n\n${bodyBlock}` : metaTitle;
      }
    }

    const nextText = [generalInfoDraft.text, bodyBlock]
      .filter(Boolean)
      .join(generalInfoDraft.text && bodyBlock ? "\n\n" : "");
    const titleFromText = extractTitleFromPlainText(nextText);

    setGeneralInfoDraft((prev) => ({
      ...prev,
      title: titleFromText || metaTitle || prev.title || fallbackUrl,
      text: nextText,
      sourceUrl: String(result.url || fallbackUrl),
      fileName: image ? metaTitle || "URL 대표 이미지" : prev.fileName,
      filePreview: image || prev.filePreview,
      fileType: image ? "image" : prev.fileType,
      mediaItems: image
        ? [
            ...normalizeGeneralInfoMediaItems(prev),
            makeGeneralInfoMediaItem(metaTitle || "URL 대표 이미지", "image", image),
          ]
        : normalizeGeneralInfoMediaItems(prev),
      // 요약은 자동 생성하지 않음 — 사용자가 직접 입력
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
    const html = String(generalInfoRichTextRef.current?.innerHTML || "").trim();
    const titleFromText = extractTitleFromPlainText(plainText);

    setGeneralInfoDraft((prev) => {
      const nextTitle = titleFromText || prev.title;
      if (
        prev.text === plainText &&
        (prev.formattedTextHtml || "") === html &&
        prev.title === nextTitle
      ) {
        return prev;
      }
      return {
        ...prev,
        text: plainText,
        formattedTextHtml: html,
        title: nextTitle,
      };
    });
  }, []);

  // DOM ref에서 직접 최신 텍스트를 읽는 헬퍼 (state 업데이트 없이 버튼 핸들러에서 사용)
  const getCurrentGeneralInfoRichTextPlain = useCallback(() => {
    return String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");
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
    if (command === "insertText" && value) {
      const ok = document.execCommand("insertText", false, value);
      if (!ok) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(value));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        } else if (generalInfoRichTextRef.current) {
          generalInfoRichTextRef.current.appendChild(document.createTextNode(value));
        }
      }
    } else {
      document.execCommand(command, false, value);
    }
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
    const loadedItems: ReturnType<typeof makeGeneralInfoMediaItem>[] = [];

    fileList.forEach((file) => {
      const fileType = file.type.startsWith("video/") ? "video" : "image";
      const reader = new FileReader();

      const finishOne = () => {
        loadedCount += 1;
        if (loadedCount !== fileList.length) return;

        if (loadedItems.length === 0) {
          showPasteHint("⚠️ 이미지/동영상 파일을 읽지 못했습니다. 다시 붙여넣어 주세요.");
          return;
        }

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
            ? `✅ 이미지/동영상 자료 ${loadedItems.length}개 추가`
            : loadedItems[0]?.type === "video"
              ? "✅ 동영상 자료 추가"
              : "✅ 이미지 자료 추가",
        );
      };

      reader.onload = (event) => {
        const preview = String(event.target?.result || "");
        if (preview) {
          loadedItems.push(makeGeneralInfoMediaItem(file.name || `upload-${Date.now()}`, fileType, preview));
        }
        finishOne();
      };
      reader.onerror = () => {
        console.warn("general info file read failed", file.name);
        finishOne();
      };

      try {
        reader.readAsDataURL(file);
      } catch (error) {
        console.warn("general info file read threw", error);
        finishOne();
      }
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

    // execCommand is deprecated; try it first and fall back to Selection API (needed for iOS Safari)
    const inserted = document.execCommand("insertText", false, cleanedText);

    if (!inserted) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(cleanedText);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
      } else if (generalInfoRichTextRef.current) {
        generalInfoRichTextRef.current.textContent =
          (generalInfoRichTextRef.current.textContent || "") + cleanedText;
      }
    }

    // Sync state after paste (onInput is not attached, so call explicitly)
    syncGeneralInfoRichTextToDraft();
    showPasteHint("✅ Text를 편집기에 붙여넣었습니다.");
  }, [decodeGeneralInfoPastedText, syncGeneralInfoRichTextToDraft, showPasteHint, handleGeneralInfoFileUpload, generalInfoRichTextRef]);

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
        title:
          extractTitleFromPlainText(
            text === firstUrl
              ? prev.text
              : [prev.text, text].filter(Boolean).join(prev.text ? "\n\n" : ""),
          ) ||
          extractTitleFromPlainText(text) ||
          prev.title ||
          "URL 자료",
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

    const firstLine = extractTitleFromPlainText(text);
    const nextText = [generalInfoDraft.text, text].filter(Boolean).join(generalInfoDraft.text ? "\n\n" : "");

    setGeneralInfoDraft((prev) => ({
      ...prev,
      title: extractTitleFromPlainText(nextText) || firstLine || prev.title || "붙여넣은 Text 자료",
      text: nextText,
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
          setGeneralInfoDraft((prev) => {
            const nextText =
              text === firstUrl
                ? prev.text
                : [prev.text, text].filter(Boolean).join(prev.text ? "\n\n" : "");
            return {
              ...prev,
              sourceUrl: firstUrl,
              text: nextText,
              title:
                extractTitleFromPlainText(nextText) ||
                extractTitleFromPlainText(text) ||
                prev.title ||
                "URL 자료",
            };
          });

          try {
            await extractGeneralInfoUrl(firstUrl);
            handled = true;
            showPasteHint("✅ 클립보드 URL을 자동 수집했습니다.");
          } catch (error) {
            handled = true;
            showPasteHint(`⚠️ URL 자동 가져오기는 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          const nextText = [generalInfoDraft.text, text].filter(Boolean).join(generalInfoDraft.text ? "\n\n" : "");
          setGeneralInfoDraft((prev) => ({
            ...prev,
            title: extractTitleFromPlainText(nextText) || extractTitleFromPlainText(text) || prev.title || "클립보드 Text 자료",
            text: nextText,
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
    // 버튼 클릭 시 onBlur가 스킵될 수 있으므로 DOM ref에서 직접 최신 텍스트를 읽음
    const latestText = getCurrentGeneralInfoRichTextPlain();
    const titleFromText = extractTitleFromPlainText(latestText);
    const effectiveDraft = {
      ...generalInfoDraft,
      text: latestText || generalInfoDraft.text,
      title: titleFromText || generalInfoDraft.title,
    };

    const hasInput =
      effectiveDraft.title.trim() ||
      effectiveDraft.text.trim() ||
      effectiveDraft.sourceUrl.trim() ||
      effectiveDraft.filePreview.trim() ||
      normalizeGeneralInfoMediaItems(effectiveDraft).length > 0;

    if (!hasInput) {
      showPasteHint("⚠️ 먼저 Text, URL, 이미지 중 하나 이상 입력하세요.");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      setIsAnalyzingGeneralInfo(true);
      showPasteHint("🤖 Gemini가 일반 정보를 분석하는 중입니다. (서버 GEMINI_API_KEY 사용)");

      const customApiKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
      const response = await fetch("/api/analyze-general-info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": customApiKey,
        },
        body: JSON.stringify({
          title: effectiveDraft.title,
          text: effectiveDraft.text,
          sourceUrl: effectiveDraft.sourceUrl,
          fileName: effectiveDraft.fileName,
          fileType: effectiveDraft.fileType,
          summary: effectiveDraft.summary,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || "Gemini 분석 실패");
      }

      markGeminiApiPacketsAvailable();

      const result = data.result || {};

      setGeneralInfoKeywordText(
        Array.isArray(result.keywords)
          ? result.keywords.map((keyword: string) => `#${String(keyword).replace(/^#+/, "")}`).join(", ")
          : generalInfoKeywordText,
      );

      setGeneralInfoDraft((prev) => ({
        ...prev,
        // 제목은 Text 첫 줄 유지 (AI가 바꾼 제목보다 우선)
        title: titleFromText || prev.title || result.title || "",
        text: effectiveDraft.text,
        summary: result.summary || prev.summary,
        primaryCategory: result.primaryCategory || prev.primaryCategory,
        secondaryCategory: result.secondaryCategory || prev.secondaryCategory,
        thirdCategory: result.thirdCategory || prev.thirdCategory,
        keywords: Array.isArray(result.keywords) ? result.keywords : prev.keywords,
        factCheckStatus: result.factCheckStatus || prev.factCheckStatus,
        // 자동분류의 짧은 factCheckSummary는 AI 검증 보고서가 아님 → 기존 보고서만 유지
        factCheckSummary: prev.factCheckSummary,
      }));

      showPasteHint("🤖 Gemini 일반 정보 분석 완료 · 확인 후 저장하세요.");
    } catch (error) {
      console.error("travel-diary general info Gemini analysis failed", error);
      const analyzed = mockAnalyzeGeneralInfo(effectiveDraft);
      setGeneralInfoKeywordText(
        analyzed.keywords.map((keyword) => `#${String(keyword).replace(/^#+/, "")}`).join(", "),
      );
      setGeneralInfoDraft({
        ...analyzed,
        title: titleFromText || analyzed.title,
        text: effectiveDraft.text,
      });
      showPasteHint("⚠️ Gemini 분석 실패 · 임시 Mock 자동분류로 처리했습니다.");
    } finally {
      setIsAnalyzingGeneralInfo(false);
    }
  }, [generalInfoDraft, generalInfoKeywordText, getCurrentGeneralInfoRichTextPlain, markGeminiApiPacketsAvailable, showPasteHint]);

  const dataUrlToGeneralInfoFile = useCallback(async (dataUrl: string, fileName: string) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], fileName, { type: blob.type });
  }, []);

  /** Fact Check / 보고서 인라인 이미지 → Storage https URL (본문 중간 삽입·저장 시 잘림 방지) */
  const uploadGeneralInfoInlineImageFile = useCallback(async (file: File) => {
    const result = await uploadFileToSupabaseStorage(file);
    return result.fileUrl;
  }, []);

  /** HTML 안의 data: 이미지를 Storage https로 교체 */
  const uploadInlineDataUrlsInHtml = useCallback(async (html: string, filePrefix: string) => {
    let next = salvageFactCheckHtml(String(html || ""));
    const dataSrcs = extractMediaSrcFromHtml(next).filter((src) => src.startsWith("data:"));
    if (!dataSrcs.length) {
      return { html: next, ok: true as const, failed: 0 };
    }

    const replacements: Array<{ from: string; to: string }> = [];
    for (const [index, src] of dataSrcs.entries()) {
      try {
        const file = await dataUrlToGeneralInfoFile(
          src,
          `${filePrefix}-${Date.now()}-${index + 1}.jpg`,
        );
        const result = await uploadFileToSupabaseStorage(file);
        if (result.fileUrl) {
          replacements.push({ from: src, to: result.fileUrl });
        }
      } catch (error) {
        console.error("인라인 이미지 업로드 실패:", error);
      }
    }

    if (replacements.length > 0) {
      next = replaceHtmlMediaSources(next, replacements);
    }
    next = salvageFactCheckHtml(next);
    const stillData = extractMediaSrcFromHtml(next).filter((src) => src.startsWith("data:"));
    return { html: next, ok: stillData.length === 0, failed: stillData.length };
  }, [dataUrlToGeneralInfoFile]);

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

  const handleSaveTemporaryGeneralInfoDraft = useCallback(async () => {
    const latestText = getCurrentGeneralInfoRichTextPlain();
    let richHtml = getCurrentGeneralInfoRichTextHtml();

    if (extractMediaSrcFromHtml(richHtml).some((src) => src.startsWith("data:"))) {
      showPasteHint("본문 이미지 업로드 중...");
      const inlineUpload = await uploadInlineDataUrlsInHtml(richHtml, "temp-body-inline");
      richHtml = inlineUpload.html;
      if (!inlineUpload.ok) {
        showPasteHint(
          `⚠️ 본문 이미지 ${inlineUpload.failed}장 업로드 실패. 네트워크 확인 후 다시 임시 저장하세요.`,
        );
        return;
      }
      if (generalInfoRichTextRef.current) {
        generalInfoRichTextRef.current.innerHTML = richHtml;
      }
    }

    const draftWithLatestText =
      latestText !== generalInfoDraft.text
        ? { ...generalInfoDraft, text: latestText, formattedTextHtml: richHtml }
        : { ...generalInfoDraft, formattedTextHtml: richHtml || generalInfoDraft.formattedTextHtml };

    const draftMediaItems = normalizeGeneralInfoMediaItems(draftWithLatestText);
    const mainMedia = draftMediaItems[0];

    const inputTypes: GeneralInfoItem["inputTypes"] = [];
    if (draftWithLatestText.text.trim()) inputTypes.push("text");
    if (draftWithLatestText.sourceUrl.trim()) inputTypes.push("url");
    if (draftWithLatestText.fileType === "image" || draftMediaItems.some((m) => m.type === "image")) {
      inputTypes.push("image");
    }
    if (draftWithLatestText.fileType === "video" || draftMediaItems.some((m) => m.type === "video")) {
      inputTypes.push("video");
    }

    if (
      !draftWithLatestText.title.trim() &&
      !draftWithLatestText.text.trim() &&
      !draftWithLatestText.sourceUrl.trim() &&
      draftMediaItems.length === 0
    ) {
      showPasteHint("⚠️ 임시 저장할 내용이 없습니다.");
      return;
    }

    const finalTitle =
      extractTitleFromPlainText(draftWithLatestText.text) ||
      draftWithLatestText.title.trim() ||
      draftWithLatestText.summary.trim() ||
      draftWithLatestText.sourceUrl.trim() ||
      draftWithLatestText.fileName.trim() ||
      "임시 저장 자료";

    const existingEditing = generalInfoEditingId
      ? generalInfoItems.find((item) => item.id === generalInfoEditingId)
      : null;

    // 기존 임시저장 항목이면 갱신, 확정 항목 편집 중이면 새 임시 항목 생성
    const targetId =
      existingEditing && existingEditing.confirmed === false
        ? existingEditing.id
        : !existingEditing
          ? Date.now()
          : Date.now();

    const factCheckSummary = isFullAiVerificationReport(draftWithLatestText.factCheckSummary)
      ? salvageFactCheckHtml(draftWithLatestText.factCheckSummary)
      : buildAiReportFromBodyContent({
          title: finalTitle,
          text: draftWithLatestText.text,
          formattedTextHtml: richHtml,
        });

    const tempItem: GeneralInfoItem = {
      id: targetId,
      title: finalTitle,
      inputTypes: inputTypes.length > 0 ? inputTypes : ["text"],
      text: draftWithLatestText.text,
      formattedTextHtml: richHtml,
      sourceUrl: draftWithLatestText.sourceUrl || undefined,
      fileName: draftWithLatestText.fileName || mainMedia?.name || undefined,
      filePreview: mainMedia?.preview || draftWithLatestText.filePreview || undefined,
      mediaItems: draftMediaItems,
      primaryCategory: draftWithLatestText.primaryCategory || "사회",
      secondaryCategory: draftWithLatestText.secondaryCategory || "일반",
      thirdCategory: draftWithLatestText.thirdCategory || "기타",
      keywords: draftWithLatestText.keywords || [],
      factCheckStatus: draftWithLatestText.factCheckStatus || "확인 전",
      factCheckSummary,
      summary: draftWithLatestText.summary || "",
      extraNote: existingEditing?.extraNote || "",
      confirmed: false,
      createdAt: existingEditing?.confirmed === false ? existingEditing.createdAt : nowText(),
      isPinned: existingEditing?.confirmed === false ? existingEditing.isPinned : false,
    };

    setGeneralInfoItems((prev) => {
      const exists = prev.some((item) => item.id === tempItem.id);
      const nextItems = exists
        ? prev.map((item) => (item.id === tempItem.id ? tempItem : item))
        : [tempItem, ...prev];
      try {
        persistGeneralInfoItemsToLocalStorage(nextItems);
      } catch (error) {
        console.error("temp general info persist failed", error);
      }
      return nextItems;
    });

    // 이어서 수정·Confirm 할 수 있도록 편집 id 연결
    setGeneralInfoEditingId(tempItem.id);
    setGeneralInfoActiveTab("storage");
    localStorage.removeItem("travel_diary_general_info_temp_draft");

    void syncGeneralInfoItemToSupabase(
      tempItem,
      generalInfoItems.some((item) => item.id === tempItem.id) ? "PUT" : "POST",
    );

    showPasteHint("💾 정보 창고에 [임시저장]으로 저장되었습니다.");
  }, [
    generalInfoDraft,
    generalInfoEditingId,
    generalInfoItems,
    getCurrentGeneralInfoRichTextHtml,
    getCurrentGeneralInfoRichTextPlain,
    showPasteHint,
    syncGeneralInfoItemToSupabase,
    uploadInlineDataUrlsInHtml,
  ]);

  const handleConfirmGeneralInfo = useCallback(async () => {
    // 버튼 클릭 시 onBlur가 스킵될 수 있으므로 DOM ref에서 직접 최신 텍스트를 읽음
    const latestText = getCurrentGeneralInfoRichTextPlain();
    const draftWithLatestText = latestText !== generalInfoDraft.text
      ? { ...generalInfoDraft, text: latestText }
      : generalInfoDraft;

    const analyzed =
      draftWithLatestText.primaryCategory ||
      draftWithLatestText.secondaryCategory ||
      draftWithLatestText.thirdCategory ||
      draftWithLatestText.summary ||
      draftWithLatestText.keywords.length > 0
        ? draftWithLatestText
        : mockAnalyzeGeneralInfo(draftWithLatestText);

    const inputTypes: GeneralInfoItem["inputTypes"] = [];
    const draftMediaItems = normalizeGeneralInfoMediaItems(analyzed);

    const hasDraftImage = draftMediaItems.some((media) => media.type === "image");
    const hasDraftVideo = draftMediaItems.some((media) => media.type === "video");

    let uploadedDraftMediaItems = draftMediaItems;

    if (hasDraftImage || hasDraftVideo) {
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
      const fromText = extractTitleFromPlainText(analyzed.text);
      if (fromText) return fromText;
      return analyzed.title || analyzed.summary || analyzed.sourceUrl || analyzed.fileName || "일반 정보 자료";
    })();

    const richHtmlBefore = getCurrentGeneralInfoRichTextHtml();
    const htmlReplacements = draftMediaItems
      .map((before, index) => ({
        from: String(before.preview || ""),
        to: String(
          uploadedDraftMediaItems[index]?.preview ||
            uploadedDraftMediaItems[index]?.fileUrl ||
            before.preview ||
            "",
        ),
      }))
      .filter((item) => item.from && item.to && item.from !== item.to);
    let richHtml = replaceHtmlMediaSources(richHtmlBefore, htmlReplacements);

    // 본문 S삽입 data: 이미지도 Storage https로 올려 재진입 시 유지
    if (extractMediaSrcFromHtml(richHtml).some((src) => src.startsWith("data:"))) {
      showPasteHint("본문 이미지 업로드 중...");
      const inlineUpload = await uploadInlineDataUrlsInHtml(richHtml, "body-inline");
      richHtml = inlineUpload.html;
      if (!inlineUpload.ok) {
        showPasteHint(
          `⚠️ 본문 이미지 ${inlineUpload.failed}장 업로드 실패. 네트워크 확인 후 다시 Confirm 하세요.`,
        );
        return;
      }
    }

    if (generalInfoRichTextRef.current && richHtml !== richHtmlBefore) {
      generalInfoRichTextRef.current.innerHTML = richHtml;
    }

    const resolveFactCheckSummaryForSave = (existingItem?: GeneralInfoItem | null) => {
      // 1) 이미 AI Fact Check / AI 검증 보고서가 있으면 유지 (평문이면 HTML로 복원)
      if (isFullAiVerificationReport(analyzed.factCheckSummary)) {
        return salvageFactCheckHtml(analyzed.factCheckSummary);
      }
      if (existingItem && isFullAiVerificationReport(existingItem.factCheckSummary || "")) {
        return salvageFactCheckHtml(String(existingItem.factCheckSummary || ""));
      }
      // 2) Fact Check 없이 Confirm → Text 입력/편집 내용을 그대로 AI 보고서로
      return buildAiReportFromBodyContent({
        title: finalTitle,
        text: analyzed.text,
        formattedTextHtml: richHtml,
      });
    };

    const item: GeneralInfoItem = {
      id: Date.now(),
      title: finalTitle,
      inputTypes,
      text: analyzed.text,
      formattedTextHtml: richHtml,
      sourceUrl: analyzed.sourceUrl || undefined,
      fileName: analyzed.fileName || uploadedMainMedia?.name || undefined,
      filePreview: uploadedMainMedia?.preview || analyzed.filePreview || undefined,
      mediaItems: uploadedDraftMediaItems,
      primaryCategory: analyzed.primaryCategory || "사회",
      secondaryCategory: analyzed.secondaryCategory || "일반",
      thirdCategory: analyzed.thirdCategory || "기타",
      keywords: analyzed.keywords,
      factCheckStatus: analyzed.factCheckStatus,
      factCheckSummary: resolveFactCheckSummaryForSave(null),
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
        isPinned: existingGeneralInfoItem?.isPinned || false,
        factCheckSummary: resolveFactCheckSummaryForSave(existingGeneralInfoItem),
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
      setGeneralInfoActiveTab("storage");
      if (hasDisplayableAiReport(String(updatedItem.factCheckSummary || ""))) {
        setGeneralInfoDetailId(null);
        setGeneralInfoDetailEditMode(false);
        setGeneralInfoAiReportId(updatedItem.id);
        showPasteHint("✅ 수정 저장 완료 · AI 검증 보고서 화면을 열었습니다.");
      } else {
        showPasteHint("✅ 수정 저장 완료 · 새 일반 정보 입력 준비 완료");
      }
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
    setGeneralInfoActiveTab("storage");
    if (hasDisplayableAiReport(String(item.factCheckSummary || ""))) {
      setGeneralInfoDetailId(null);
      setGeneralInfoDetailEditMode(false);
      setGeneralInfoAiReportId(item.id);
      showPasteHint("✅ 저장 완료 · AI 검증 보고서가 만들어졌습니다.");
    } else {
      showPasteHint("✅ 저장 완료 · 새 일반 정보 입력 준비 완료");
    }
  }, [
    generalInfoDraft,
    generalInfoEditingId,
    generalInfoItems,
    getCurrentGeneralInfoRichTextHtml,
    getCurrentGeneralInfoRichTextPlain,
    resetGeneralInfoRichTextEditor,
    showPasteHint,
    syncGeneralInfoItemToSupabase,
    uploadGeneralInfoMediaItemsToSupabaseStorage,
    uploadInlineDataUrlsInHtml,
  ]);

  const handleStartEditGeneralInfo = useCallback((item: GeneralInfoItem) => {
    // Source DATA에서 바로 수정 (수집 탭으로 이동하지 않음)
    setGeneralInfoAiReportId(null);
    setGeneralInfoDetailEditMode(true);
    setGeneralInfoDetailId(item.id);
    setGeneralInfoActiveTab("storage");
    showPasteHint("✏️ Source DATA에서 자료를 수정할 수 있습니다.");
  }, [showPasteHint]);

  const handleSaveGeneralInfoDetailEdit = useCallback(async (updatedItem: GeneralInfoItem) => {
    const targetItem = generalInfoItems.find((item) => item.id === updatedItem.id);
    if (!targetItem) return;

    const draftMediaItems = normalizeGeneralInfoMediaItems(updatedItem);
    let uploadedMediaItems = draftMediaItems;
    if (draftMediaItems.some((media) => String(media.preview || "").startsWith("data:"))) {
      showPasteHint("이미지 업로드 중...");
      uploadedMediaItems = await uploadGeneralInfoMediaItemsToSupabaseStorage(draftMediaItems);
    }
    const mainMedia = uploadedMediaItems[0];

    let factCheckSummary = salvageFactCheckHtml(String(updatedItem.factCheckSummary || ""));
    if (extractMediaSrcFromHtml(factCheckSummary).some((src) => src.startsWith("data:"))) {
      showPasteHint("보고서 이미지 업로드 중...");
      const factUpload = await uploadInlineDataUrlsInHtml(
        factCheckSummary,
        `factcheck-${targetItem.id}`,
      );
      factCheckSummary = factUpload.html;
      if (!factUpload.ok) {
        showPasteHint(
          `⚠️ 보고서 이미지 ${factUpload.failed}장 업로드 실패로 저장을 취소했습니다. 본문은 유지됩니다.`,
        );
        return;
      }
    }
    factCheckSummary = salvageFactCheckHtml(factCheckSummary);

    let formattedTextHtml = String(updatedItem.formattedTextHtml || "");
    if (extractMediaSrcFromHtml(formattedTextHtml).some((src) => src.startsWith("data:"))) {
      showPasteHint("본문 이미지 업로드 중...");
      const bodyUpload = await uploadInlineDataUrlsInHtml(
        formattedTextHtml,
        `body-${targetItem.id}`,
      );
      formattedTextHtml = bodyUpload.html;
      if (!bodyUpload.ok) {
        showPasteHint(
          `⚠️ 본문 이미지 ${bodyUpload.failed}장 업로드 실패로 저장을 취소했습니다.`,
        );
        return;
      }
    }

    const nextItem: GeneralInfoItem = {
      ...targetItem,
      ...updatedItem,
      id: targetItem.id,
      createdAt: targetItem.createdAt,
      confirmed: true,
      extraNote: targetItem.extraNote || updatedItem.extraNote || "",
      mediaItems: uploadedMediaItems,
      filePreview: mainMedia?.preview || "",
      fileName: mainMedia?.name || "",
      factCheckSummary,
      formattedTextHtml,
    };

    setGeneralInfoItems((prev) => {
      const nextItems = prev.map((item) => (item.id === nextItem.id ? nextItem : item));
      try {
        persistGeneralInfoItemsToLocalStorage(nextItems);
      } catch {}
      return nextItems;
    });

    setGeneralInfoDetailEditMode(false);
    showPasteHint("✅ 일반 정보 수정을 저장했습니다.");
    await syncGeneralInfoItemToSupabase(nextItem, "PUT");
  }, [
    generalInfoItems,
    showPasteHint,
    syncGeneralInfoItemToSupabase,
    uploadGeneralInfoMediaItemsToSupabaseStorage,
    uploadInlineDataUrlsInHtml,
  ]);

  const handleCloseGeneralInfoDetail = useCallback(() => {
    setGeneralInfoDetailId(null);
    setGeneralInfoDetailEditMode(false);
  }, []);

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
    setGeneralInfoAiReportId((prev) => (prev === itemId ? null : prev));

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

  const isGeminiCreditDepletedResponse = useCallback((data: Record<string, unknown> | null | undefined) => {
    if (!data) return false;
    if (data.mode === "credit_depleted" || data.needsManualFactCheck === true) return true;
    const text = JSON.stringify(data);
    return (
      text.includes("RESOURCE_EXHAUSTED") ||
      text.includes("prepayment credits") ||
      text.includes("credits are depleted") ||
      text.includes('"code":429') ||
      text.includes('"code": 429')
    );
  }, []);

  const applyCreditDepletedManualFactCheck = useCallback((item: GeneralInfoItem) => {
    const updatedItem: GeneralInfoItem = {
      ...item,
      factCheckStatus: "확인 필요",
      // AI 가짜 보고서는 만들지 않음. 기존 수동/정상 내용만 유지.
    };

    setGeneralInfoItems((prev) => {
      const nextItems = prev.map((savedItem) =>
        savedItem.id === item.id ? updatedItem : savedItem,
      );
      try {
        persistGeneralInfoItemsToLocalStorage(nextItems);
      } catch {}
      return nextItems;
    });

    setGeneralInfoManualFactCheckId(item.id);
    setGeneralInfoReportItem(updatedItem);
    setGeneralInfoReportText("");
    setGeneralInfoFactCheckItem(updatedItem);
    setGeneralInfoFactCheckResult("");
    markGeminiApiPacketsDepleted();
    showPasteHint("⚠️ AI 크레딧 소진 · 수동으로 Fact Check를 작성해 주세요.");
    void syncGeneralInfoItemToSupabase(updatedItem, "PUT");
    return updatedItem;
  }, [markGeminiApiPacketsDepleted, showPasteHint, syncGeneralInfoItemToSupabase]);

  const handleSaveManualFactCheck = useCallback(async (
    itemId: number,
    text: string,
    status: GeneralInfoItem["factCheckStatus"] = "확인 필요",
    title?: string,
  ) => {
    const targetItem = generalInfoItems.find((item) => item.id === itemId);
    if (!targetItem) return;

    let trimmed = salvageFactCheckHtml(String(text || "").trim());
    if (!trimmed) {
      showPasteHint("⚠️ Fact Check 내용을 입력해 주세요.");
      return;
    }

    if (extractMediaSrcFromHtml(trimmed).some((src) => src.startsWith("data:"))) {
      showPasteHint("이미지 업로드 중...");
      const inlineUpload = await uploadInlineDataUrlsInHtml(trimmed, `factcheck-${itemId}`);
      trimmed = inlineUpload.html;
      if (!inlineUpload.ok) {
        showPasteHint(
          `⚠️ 이미지 ${inlineUpload.failed}장 업로드 실패로 저장을 취소했습니다. 본문은 그대로 있으니 다시 저장해 주세요.`,
        );
        return;
      }
    }

    trimmed = salvageFactCheckHtml(trimmed);
    if (!trimmed) {
      showPasteHint("⚠️ 저장할 보고서 본문이 없습니다.");
      return;
    }

    const nextTitle =
      title !== undefined ? String(title || "").trim() || targetItem.title : targetItem.title;

    const wasTemporary = targetItem.confirmed === false;
    const withReport: GeneralInfoItem = {
      ...targetItem,
      title: nextTitle,
      factCheckStatus: status,
      factCheckSummary: trimmed,
      // 보고서 저장 시 임시저장 → 확정
      confirmed: true,
    };
    const updatedItem = applyInfographicAsRepresentative(withReport, trimmed);
    const infoSrc = extractFirstInfographicSrc(trimmed);
    const becameRepresentative =
      Boolean(infoSrc) && String(updatedItem.filePreview || "") === infoSrc;

    setGeneralInfoItems((prev) => {
      const nextItems = prev.map((item) => (item.id === itemId ? updatedItem : item));
      try {
        persistGeneralInfoItemsToLocalStorage(nextItems);
      } catch {}
      return nextItems;
    });

    setGeneralInfoManualFactCheckId(null);
    setGeneralInfoReportItem(updatedItem);
    setGeneralInfoReportText(trimmed);
    setGeneralInfoFactCheckItem(updatedItem);
    setGeneralInfoFactCheckResult(trimmed);
    showPasteHint(
      becameRepresentative
        ? "✅ 보고서 저장·확정 · 인포그래픽을 대표 이미지(창고 카드)로 설정했습니다."
        : wasTemporary
          ? "✅ 보고서 저장 · 임시저장이 확정되었습니다."
          : "✅ Fact Check / AI 검증 보고서(이미지 포함)를 저장했습니다.",
    );
    await syncGeneralInfoItemToSupabase(updatedItem, "PUT");
  }, [
    generalInfoItems,
    showPasteHint,
    syncGeneralInfoItemToSupabase,
    uploadInlineDataUrlsInHtml,
  ]);

  /** 임의 이미지를 대표(창고 카드 썸네일)로 교체 */
  const handleSetRepresentativeImage = useCallback(
    async (itemId: number, src: string) => {
      const url = String(src || "").trim();
      if (!url) return;
      const targetItem = generalInfoItems.find((item) => item.id === itemId);
      if (!targetItem) return;

      const existing = normalizeGeneralInfoMediaItems(targetItem);
      const withoutDup = existing.filter(
        (media) =>
          String(media.preview || "").trim() !== url &&
          String(media.fileUrl || "").trim() !== url,
      );
      const nextMedia = [
        makeGeneralInfoMediaItem("대표 이미지", "image", url, undefined, url),
        ...withoutDup,
      ];
      const updatedItem: GeneralInfoItem = {
        ...targetItem,
        mediaItems: nextMedia,
        filePreview: url,
        fileName: nextMedia[0]?.name || "대표 이미지",
        fileType: "image",
      };

      setGeneralInfoItems((prev) => {
        const nextItems = prev.map((item) => (item.id === itemId ? updatedItem : item));
        try {
          persistGeneralInfoItemsToLocalStorage(nextItems);
        } catch {}
        return nextItems;
      });
      showPasteHint("✅ 대표 이미지를 교체했습니다.");
      await syncGeneralInfoItemToSupabase(updatedItem, "PUT");
    },
    [generalInfoItems, showPasteHint, syncGeneralInfoItemToSupabase],
  );

  // --- AI 보고서 및 Fact Check 작성 핸들러 ---
  const buildGeneralInfoFactCheckPayload = useCallback((item: GeneralInfoItem) => {
    // 큰 data: URL은 요청 본문을 깨뜨리므로 https/fileUrl만 보냄 (서버가 필요 시 다운로드)
    const mediaItems = normalizeGeneralInfoMediaItems(item)
      .map((media) => {
        const fileUrl = String(media.fileUrl || "").trim();
        const preview = String(media.preview || "").trim();
        const bestUrl = /^https?:\/\//i.test(fileUrl)
          ? fileUrl
          : /^https?:\/\//i.test(preview)
            ? preview
            : "";
        return {
          id: media.id,
          name: media.name,
          type: media.type,
          preview: bestUrl,
          fileUrl: bestUrl || undefined,
          storagePath: media.storagePath,
          memo: media.memo,
        };
      })
      .filter((media) => media.preview || media.memo);

    let formattedTextHtml = String(item.formattedTextHtml || "");
    // 인라인 data: 이미지는 API 본문에서 제거하고, 위 mediaItems(https)로만 전달
    formattedTextHtml = formattedTextHtml.replace(/src=["']data:[^"']+["']/gi, 'src=""');
    if (formattedTextHtml.length > 80_000) {
      formattedTextHtml = formattedTextHtml.slice(0, 80_000);
    }

    return {
      title: item.title,
      text: String(item.text || "").slice(0, 40_000),
      formattedTextHtml,
      sourceUrl: item.sourceUrl,
      summary: item.summary,
      // 기존 긴 보고서는 재전송하지 않음 (요청 비대화 방지)
      factCheckSummary: "",
      extraNote: item.extraNote,
      categoryPath: getGeneralInfoCategoryPath(item),
      keywords: item.keywords || [],
      mediaSummary: getGeneralInfoInputCountText(item),
      mediaItems: mediaItems.slice(0, 8),
      pdfText: "",
    };
  }, []);

  /** Text 입력 직후 Fact Check / AI 검증 보고서 실행 (저장 전 초안에도 가능) */
  const handleFactCheckGeneralInfoDraft = useCallback(async () => {
    const latestText = getCurrentGeneralInfoRichTextPlain();
    const titleFromText = extractTitleFromPlainText(latestText);
    const effectiveDraft = {
      ...generalInfoDraft,
      text: latestText || generalInfoDraft.text,
      title: titleFromText || generalInfoDraft.title,
      formattedTextHtml: getCurrentGeneralInfoRichTextHtml(),
    };

    if (!String(effectiveDraft.text || "").trim()) {
      showPasteHint("⚠️ Fact Check할 Text를 먼저 입력하세요.");
      return;
    }

    try {
      setIsRunningGeneralInfoFactCheck(true);
      showPasteHint("🔍 Fact Check / AI 검증 보고서를 작성합니다. (서버 GEMINI_API_KEY 사용)");

      const draftAsItem = {
        id: generalInfoEditingId || Date.now(),
        createdAt: nowText(),
        confirmed: false,
        pinned: false,
        inputTypes: ["text"] as GeneralInfoItem["inputTypes"],
        title: effectiveDraft.title || "일반 정보 자료",
        text: effectiveDraft.text,
        sourceUrl: effectiveDraft.sourceUrl || "",
        summary: effectiveDraft.summary || "",
        factCheckStatus: effectiveDraft.factCheckStatus || "확인 전",
        factCheckSummary: effectiveDraft.factCheckSummary || "",
        primaryCategory: effectiveDraft.primaryCategory || "",
        secondaryCategory: effectiveDraft.secondaryCategory || "",
        thirdCategory: effectiveDraft.thirdCategory || "",
        keywords: effectiveDraft.keywords || [],
        extraNote: "",
        fileName: effectiveDraft.fileName || "",
        filePreview: effectiveDraft.filePreview || "",
        fileType: effectiveDraft.fileType || "none",
        mediaItems: normalizeGeneralInfoMediaItems(effectiveDraft),
        formattedTextHtml: effectiveDraft.formattedTextHtml || "",
      } as GeneralInfoItem;

      const customApiKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 90_000);

      let response: Response;
      try {
        response = await fetch("/api/general-info-factcheck", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gemini-api-key": customApiKey,
          },
          body: JSON.stringify(buildGeneralInfoFactCheckPayload(draftAsItem)),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      let data: Record<string, unknown> = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok || data.ok === false) {
        throw new Error(
          String(data.detail || data.error || data.message || `Fact Check API 호출 실패 (${response.status})`),
        );
      }

      if (isGeminiCreditDepletedResponse(data)) {
        markGeminiApiPacketsDepleted();
        setGeneralInfoDraft((prev) => ({
          ...prev,
          title: titleFromText || prev.title,
          text: effectiveDraft.text,
          factCheckStatus: "확인 필요",
        }));
        showPasteHint("⚠️ API 패킷 부족 · 수동으로 Fact Check를 작성해 주세요.");
        return;
      }

      markGeminiApiPacketsAvailable();

      const rawStatus = String(data.status || data.factCheckStatus || "확인 필요");
      const nextStatus = (
        rawStatus === "확인 완료" ||
        rawStatus === "확인 필요" ||
        rawStatus === "확인 전" ||
        rawStatus === "오류 가능성" ||
        rawStatus === "오류 가능"
          ? rawStatus === "오류 가능"
            ? "오류 가능성"
            : rawStatus
          : "확인 필요"
      ) as GeneralInfoDraft["factCheckStatus"];

      const candidateReport = [
        data.result,
        data.report,
        data.reportText,
        data.markdown,
        data.content,
        data.text,
        data.easyReport,
        data.factCheckSummary,
      ]
        .map((value) => String(value || "").trim())
        .find((value) => value && value !== String(data.summary || "").trim()) || "";

      // summary만 온 경우는 AI 검증 보고서로 쓰지 않음
      // Fact Check「확인 내용」칸에는 HTML 태그 없이 정리된 텍스트만 넣음
      // (Confirm/보고서 저장 시 salvageFactCheckHtml 이 HTML로 복원)
      const reportToStore =
        candidateReport && isFullAiVerificationReport(candidateReport)
          ? cleanFactCheckSummaryText(buildFactCheckReportHtml(candidateReport))
          : candidateReport
            ? cleanFactCheckSummaryText(buildFactCheckReportHtml(candidateReport))
            : "";

      setGeneralInfoDraft((prev) => ({
        ...prev,
        title: titleFromText || prev.title,
        text: effectiveDraft.text,
        factCheckStatus: nextStatus,
        factCheckSummary: reportToStore || prev.factCheckSummary,
        summary: String(data.summary || prev.summary || "").trim() || prev.summary,
      }));

      showPasteHint("✅ Fact Check 완료 · 아래 Fact Check 칸을 확인한 뒤 Confirm 저장하세요.");
    } catch (error) {
      console.error("travel-diary draft fact check failed", error);
      showPasteHint(
        `⚠️ Fact Check 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsRunningGeneralInfoFactCheck(false);
    }
  }, [
    generalInfoDraft,
    generalInfoEditingId,
    getCurrentGeneralInfoRichTextPlain,
    getCurrentGeneralInfoRichTextHtml,
    buildGeneralInfoFactCheckPayload,
    isGeminiCreditDepletedResponse,
    markGeminiApiPacketsAvailable,
    markGeminiApiPacketsDepleted,
    showPasteHint,
  ]);

  const handleGenerateGeneralInfoReport = useCallback(async (item: GeneralInfoItem, forceRegenerate = false) => {
    const openAiReportScreen = (itemId: number) => {
      setGeneralInfoDetailId(null);
      setGeneralInfoDetailEditMode(false);
      setGeneralInfoAiReportId(itemId);
      setGeneralInfoActiveTab("storage");
    };

    // 이미 구조화된 AI 검증 보고서만 재사용 (짧은 자동분류 메모는 재사용하지 않음)
    if (
      !forceRegenerate &&
      isFullAiVerificationReport(String(item.factCheckSummary || ""))
    ) {
      setGeneralInfoReportItem(item);
      setGeneralInfoReportText(item.factCheckSummary);
      openAiReportScreen(item.id);
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

    const applyReportToItem = (nextReport: string, nextStatus: GeneralInfoItem["factCheckStatus"]) => {
      const updatedReportItem = {
        ...item,
        factCheckStatus: nextStatus,
        factCheckSummary: nextReport,
      };

      setGeneralInfoItems((prev) => {
        const nextItems = prev.map((savedItem) =>
          savedItem.id === item.id ? updatedReportItem : savedItem,
        );
        try {
          persistGeneralInfoItemsToLocalStorage(nextItems);
        } catch (persistError) {
          console.error("AI report local persist failed", persistError);
        }
        return nextItems;
      });

      setGeneralInfoReportItem(updatedReportItem);
      setGeneralInfoReportText(nextReport);
      return updatedReportItem;
    };

    try {
      setIsGeneratingGeneralInfoReport(true);
      showPasteHint("📄 AI 보고서를 작성합니다. (서버 GEMINI_API_KEY 사용)");

      const customApiKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") || "" : "";
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 90_000);

      let response: Response;
      try {
        response = await fetch("/api/general-info-factcheck", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gemini-api-key": customApiKey,
          },
          body: JSON.stringify(buildGeneralInfoFactCheckPayload(item)),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      let data: {
        error?: string;
        message?: string;
        detail?: string;
        warning?: string;
        mode?: string;
        model?: string;
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

      if (!response.ok || data.ok === false) {
        throw new Error(
          String(data?.detail || data?.error || data?.message || `AI 보고서 API 호출 실패 (${response.status})`),
        );
      }

      if (isGeminiCreditDepletedResponse(data as Record<string, unknown>)) {
        applyCreditDepletedManualFactCheck(item);
        openAiReportScreen(item.id);
        return;
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

      const modelName = String(data.model || "gemini-2.5-flash").trim();
      const ensureAiReportLabel = (report: string) => {
        const label = `AI 검증 보고서(${modelName})`;
        const body = String(report || "").trim();
        if (!body) return `# ${label}`;
        if (/AI 검증 보고서\([^)]+\)/i.test(body)) {
          return body.replace(/AI 검증 보고서\([^)]+\)/i, label);
        }
        if (body.startsWith("# ")) {
          return `# ${label}\n\n${body.replace(/^#\s+[^\n]*\n?/, "").trim()}`;
        }
        return `# ${label}\n\n${body}`;
      };

      const labeledMarkdown = ensureAiReportLabel(
        candidateReport || makeFallbackReport(item, data),
      );
      const evidenceUrls = getGeneralInfoDisplayMediaItems(item)
        .map((media) => String(media.preview || media.fileUrl || "").trim())
        .filter(Boolean);
      const nextReport = buildFactCheckReportHtml(labeledMarkdown, evidenceUrls);

      const updatedReportItem = applyReportToItem(nextReport, nextStatus);
      setGeneralInfoManualFactCheckId(null);
      markGeminiApiPacketsAvailable();
      openAiReportScreen(item.id);
      showPasteHint(
        data.mode === "gemini" || data.mode === "gemini-text"
          ? `✅ AI 검증 보고서(${modelName}) 준비 완료`
          : data.warning
            ? `⚠️ ${data.warning}`
            : "✅ AI 검증 보고서 준비 완료",
      );

      void syncGeneralInfoItemToSupabase(updatedReportItem, "PUT");
    } catch (error) {
      console.error("general info report failed", error);
      if (isGeminiCreditDepletedResponse({ message: String(error) })) {
        applyCreditDepletedManualFactCheck(item);
        openAiReportScreen(item.id);
        return;
      }
      const fallback = makeFallbackReport(item, {
        summary: `보고서 생성 중 오류: ${error instanceof Error ? error.message : String(error)}`,
      });
      applyReportToItem(fallback, "확인 필요");
      openAiReportScreen(item.id);
      showPasteHint("⚠️ AI 보고서 작성 중 오류가 발생했습니다. 기본 보고서를 표시합니다.");
    } finally {
      setIsGeneratingGeneralInfoReport(false);
    }
  }, [
    applyCreditDepletedManualFactCheck,
    buildGeneralInfoFactCheckPayload,
    isGeminiCreditDepletedResponse,
    markGeminiApiPacketsAvailable,
    showPasteHint,
    syncGeneralInfoItemToSupabase,
  ]);

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

  const handleShareGeneralInfoReport = useCallback(async (item?: GeneralInfoItem) => {
    const source = item || generalInfoReportItem;
    const htmlOrText = String(
      source?.factCheckSummary || generalInfoReportText || "",
    ).trim();

    if (!htmlOrText) {
      showPasteHint("공유할 보고서가 없습니다.");
      return;
    }

    const plainText = htmlToPlainText(htmlOrText) || htmlOrText;
    const imageSrcs = extractMediaSrcFromHtml(htmlOrText);
    const shareFiles: File[] = [];

    for (const [index, src] of imageSrcs.entries()) {
      try {
        if (src.startsWith("data:")) {
          shareFiles.push(await dataUrlToFile(src, `ai-report-${index + 1}.png`));
        } else if (/^https?:\/\//i.test(src)) {
          const response = await fetch(src);
          if (!response.ok) continue;
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) continue;
          const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
          shareFiles.push(
            new File([blob], `ai-report-${index + 1}.${ext}`, {
              type: blob.type || "image/jpeg",
            }),
          );
        }
      } catch {
        // ignore single image failures
      }
    }

    if (navigator.share) {
      try {
        const payload: ShareData = {
          title: source?.title || generalInfoReportItem?.title || "AI 검증 보고서",
          text: plainText,
        };
        if (
          shareFiles.length > 0 &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: shareFiles })
        ) {
          payload.files = shareFiles;
        }
        await navigator.share(payload);
        showPasteHint(
          shareFiles.length > 0
            ? `✅ 보고서+이미지 ${shareFiles.length}장 공유를 열었습니다.`
            : "✅ 보고서 공유를 열었습니다.",
        );
      } catch {
        showPasteHint("공유 실패/취소");
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(plainText);
      showPasteHint("✅ 보고서 텍스트를 클립보드에 복사했습니다.");
    } catch {
      showPasteHint("⚠️ 자동 복사 실패.");
    }
  }, [generalInfoReportItem, generalInfoReportText, showPasteHint]);

  const handlePrintGeneralInfoReport = useCallback(() => {
    window.print();
  }, []);

  const [isExportingGeneralInfoPdf, setIsExportingGeneralInfoPdf] = useState(false);

  const handleDownloadGeneralInfoPdfReport = useCallback(async (item: GeneralInfoItem) => {
    const reportHtml = String(item.factCheckSummary || "").trim();
    if (!hasDisplayableAiReport(reportHtml)) {
      showPasteHint("⚠️ PDF로 만들 보고서가 없습니다. Confirm 저장(본문→보고서) 또는 [AI 검증 보고서]를 먼저 실행하세요.");
      return;
    }

    const loadScript = (src: string) =>
      new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
        document.body.appendChild(script);
      });

    try {
      setIsExportingGeneralInfoPdf(true);
      showPasteHint("📄 PDF 보고서 생성 중…");

      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

      const contentHtml = formatReportHtmlForPdf(reportHtml);

      const safeTitle = String(item.title || "AI검증보고서")
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 40);
      const category = getGeneralInfoCategoryPath(item);
      const status = getGeneralInfoFactLabel(item);
      const created = String(item.createdAt || new Date().toLocaleString("ko-KR"));

      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.top = "-9999px";
      container.style.left = "-9999px";
      container.style.width = "794px";
      container.style.padding = "48px";
      container.style.background = "#ffffff";
      container.style.color = "#000000";
      container.style.fontFamily = "Apple SD Gothic Neo, Malgun Gothic, sans-serif";
      container.style.boxSizing = "border-box";
      container.style.lineHeight = "1.85";

      container.innerHTML = `
        <div style="border-bottom: 3px solid #000; padding-bottom: 18px; margin-bottom: 22px;">
          <h1 style="font-size: 24px; margin: 0; color: #000000; font-weight: 800;">AI 검증 보고서 PDF</h1>
          <p style="font-size: 12px; color: #000000; margin: 8px 0 0 0;">일반 정보 저장함 · 작성/저장: ${created}</p>
        </div>
        <div style="margin-bottom: 18px; padding: 14px 16px; background: #ffffff; border-left: 4px solid #000000; border-radius: 8px;">
          <div style="font-size: 12px; color: #000000; margin-bottom: 4px;">자료 정보</div>
          <div style="font-size: 16px; font-weight: 700; color: #000000;">${safeTitle}</div>
          <div style="font-size: 13px; color: #000000; margin-top: 6px;">분류: ${category}</div>
          <div style="font-size: 13px; color: #000000;">상태: ${status}</div>
        </div>
        <div class="pdf-report-body" style="font-size: 14px; color: #000000; line-height: 1.85; white-space: normal;">
          ${contentHtml}
        </div>
        <div style="border-top: 1px solid #000000; margin-top: 28px; padding-top: 14px; text-align: center; font-size: 11px; color: #000000;">
          본 PDF는 저장된 AI 검증 보고서를 변환한 것이며, 원문 자료와 함께 확인하는 것이 좋습니다.
        </div>
      `;

      // PDF용: 모든 글자 검정 + 밝은 배경, 문단 간격·이미지/제목 정리
      container.querySelectorAll("*").forEach((node) => {
        const el = node as HTMLElement;
        if (!el.style) return;
        el.style.color = "#000000";
        const bg = (el.style.backgroundColor || el.style.background || "").toLowerCase();
        if (bg && bg !== "transparent" && !bg.includes("rgb(255") && bg !== "#fff" && bg !== "#ffffff") {
          el.style.background = "#ffffff";
          el.style.backgroundColor = "#ffffff";
        }
      });
      container.querySelectorAll(".pdf-report-body div, .pdf-report-body p, .pdf-report-body li").forEach((node) => {
        const el = node as HTMLElement;
        if (!el.style.marginBottom) el.style.marginBottom = "10px";
        el.style.lineHeight = "1.85";
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak = "break-word";
      });
      container.querySelectorAll("img").forEach((img) => {
        const el = img as HTMLImageElement;
        el.style.maxWidth = "100%";
        el.style.height = "auto";
        el.style.borderRadius = "8px";
        el.style.margin = "12px 0";
        el.style.display = "block";
      });
      container.querySelectorAll("h1,h2,h3,h4,h5").forEach((heading) => {
        const el = heading as HTMLElement;
        el.style.color = "#000000";
        el.style.marginTop = el.style.marginTop || "18px";
        el.style.marginBottom = el.style.marginBottom || "8px";
        el.style.lineHeight = "1.45";
        el.style.fontWeight = "800";
      });
      container.querySelectorAll("br").forEach((br) => {
        const spacer = document.createElement("div");
        spacer.style.height = "8px";
        br.parentNode?.insertBefore(spacer, br);
      });
      container.querySelectorAll(".generalInfoInlineImageRemove").forEach((btn) => btn.remove());

      document.body.appendChild(container);
      await new Promise((resolve) => setTimeout(resolve, 600));

      const html2canvas = (window as any).html2canvas;
      const jsPDF = (window as any).jspdf?.jsPDF;
      if (!html2canvas || !jsPDF) {
        throw new Error("PDF 라이브러리를 불러오지 못했습니다.");
      }

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
      });
      document.body.removeChild(container);

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF("p", "mm", "a4");
      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`AI검증보고서_${safeTitle}.pdf`);
      showPasteHint("✅ PDF 보고서를 저장했습니다.");
    } catch (error) {
      console.error("general info pdf export failed", error);
      showPasteHint(
        `⚠️ PDF 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsExportingGeneralInfoPdf(false);
    }
  }, [showPasteHint]);

  // (정밀 Fact Check 기능 제거됨 → PDF 보고서로 대체)

  // --- 메모 필터링 ---
  const filteredGeneralInfoItems = useMemo(() => {
    const filtered = filterGeneralInfoItemsBySearch(generalInfoItems, generalInfoSearchTerm);
    return [...filtered].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      // 임시저장을 확정 저장보다 위에
      const aTemp = a.confirmed === false ? 1 : 0;
      const bTemp = b.confirmed === false ? 1 : 0;
      if (aTemp !== bTemp) return bTemp - aTemp;
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

  const selectedGeneralInfoAiReportItem = useMemo(() => {
    return generalInfoItems.find((item) => item.id === generalInfoAiReportId) || null;
  }, [generalInfoItems, generalInfoAiReportId]);

  const handleOpenGeneralInfoDetail = useCallback((itemId: number) => {
    setGeneralInfoAiReportId(null);
    setGeneralInfoDetailId(itemId);
    setGeneralInfoActiveTab("storage");
  }, []);

  const handleOpenGeneralInfoAiReport = useCallback((itemId: number) => {
    setGeneralInfoDetailId(null);
    setGeneralInfoDetailEditMode(false);
    setGeneralInfoAiReportId(itemId);
    setGeneralInfoActiveTab("storage");
  }, []);

  const handleCloseGeneralInfoAiReport = useCallback(() => {
    setGeneralInfoAiReportId(null);
  }, []);

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
    generalInfoAiReportId,
    setGeneralInfoAiReportId,
    selectedGeneralInfoAiReportItem,
    handleOpenGeneralInfoDetail,
    handleOpenGeneralInfoAiReport,
    handleCloseGeneralInfoAiReport,
    generalInfoDetailEditMode,
    setGeneralInfoDetailEditMode,
    handleCloseGeneralInfoDetail,
    handleSaveGeneralInfoDetailEdit,
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
    isExportingGeneralInfoPdf,
    generalInfoManualFactCheckId,
    setGeneralInfoManualFactCheckId,
    geminiApiPacketStatus,
    markGeminiApiPacketsAvailable,
    markGeminiApiPacketsDepleted,
    handleSaveManualFactCheck,
    handleSetRepresentativeImage,
    uploadGeneralInfoInlineImageFile,
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
    handleFactCheckGeneralInfoDraft,
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
    handleDownloadGeneralInfoPdfReport,
    handleTogglePinGeneralInfo,
    handleDeleteGeneralInfoBodyText,
    handleSaveGeneralInfoReportText
  };
}

// Turbopack compilation invalidate cache tag: V2_058_FIX_SUPABASE_LOOP_HMR
