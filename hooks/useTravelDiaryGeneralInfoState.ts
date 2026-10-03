import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { GeneralInfoDraft, GeneralInfoItem, GeneralInfoMediaItem } from "../types/generalInfo";
import { initialGeneralInfoDraft, generalInfoCategories, mockAnalyzeGeneralInfo } from "../lib/generalInfoMock";
import {
  addGeneralInfoRemoteIds,
  GENERAL_INFO_TEMP_DRAFT_EVENT,
  GENERAL_INFO_TEMP_DRAFT_KEY,
  persistGeneralInfoItemsToLocalStorage,
  persistGeneralInfoRemoteIds,
  readGeneralInfoItemsFromLocalStorage,
  readGeneralInfoRemoteIds,
  readGeneralInfoTempDraftIndex,
  removeGeneralInfoRemoteIds,
} from "../lib/generalInfoStorage";
import { extractFirstSentence, categoryKeywordsList, formatCategoryKeywords } from "../lib/generalInfoText";
import {
  createEmptyParagraph,
  isParagraphEmpty,
  normalizeParagraph,
  parseParagraphsFromHtml,
  htmlForActiveEditor,
  paragraphsToPlainText,
  serializeParagraphsToHtml,
} from "../lib/generalInfoParagraphs";
import type { GeneralInfoParagraph } from "../types/generalInfo";

import {
  downloadGeneralInfoAppBundle,
  downloadGeneralInfoAppFile,
  downloadGeneralInfoPdf,
  readGeneralInfoAppFileItems,
  shareGeneralInfoPdfForGoodNotes,
} from "../lib/generalInfoExport";
import {
  archiveRemovedAppFileIndex,
  forgetAppFileIndexArchive,
  forgetAppFileIndexArchiveMatch,
} from "../lib/infoIndex";
import { supabase } from "../lib/supabaseClient";


import { filterGeneralInfoItemsBySearch, getGeneralInfoCategoryPath, getGeneralInfoDisplayMediaItems, getGeneralInfoInfographicItems, normalizeGeneralInfoMediaItems, makeGeneralInfoMediaItem, makeGeneralInfoHtmlFromText, getGeneralInfoFormattedHtml, getGeneralInfoInputCountText, getGeneralInfoFactLabel, extractMarkdownReport, extractMediaSrcFromHtml, pickGeneralInfoCoverSrc, replaceHtmlMediaSources, escapeGeneralInfoHtml } from "../lib/generalInfoHelpers";
import { sanitizeGeneralInfoHtml } from "../lib/sanitizeHtml";
import {
  enhanceRichInlineImages,
  insertImagesAtSlotOrCaret,
  tryConsumeImageTriggerToSlot,
  handleRichImageSlotPointer,
} from "../lib/richImageSlots";
import { compressImageFile, filterUploadImageFiles, imageFilesFromClipboard } from "../lib/compressImageFile";
import { runCollectRichCommand } from "../lib/collectRichFormat";
import {
  cleanInstagramCaption,
  isInstagramHostText,
  isInstagramPostUrl,
  isInstagramScrapeGarbage,
  splitInstagramShareText,
  isInstagramShareJunk,
  titleFromInstagramCaption,
} from "../lib/instagramMeta";


const TRAVEL_DIARY_BUCKET = "info-photos";
function notifyGeneralInfoTempDraft() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GENERAL_INFO_TEMP_DRAFT_EVENT));
}
const nowText = () => new Date().toLocaleString("ko-KR");

const generalInfoHtmlLooksEmpty = (html: string) => {
  const raw = String(html || "");
  if (/<img\b/i.test(raw)) return false;
  return !raw
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "")
    .trim();
};

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
  const [generalInfoExportItem, setGeneralInfoExportItem] = useState<GeneralInfoItem | null>(null);
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
  /** 사용자가 이 기기에서 삭제한 ID — 동기화 시 로컬 전용 항목을 잘못 지우지 않기 위해 사용 */
  const locallyDeletedGeneralInfoIdsRef = useRef<Set<number>>(new Set());
  const generalInfoDraftRef = useRef(generalInfoDraft);
  generalInfoDraftRef.current = generalInfoDraft;
  const generalInfoKeywordTextRef = useRef(generalInfoKeywordText);
  generalInfoKeywordTextRef.current = generalInfoKeywordText;
  const generalInfoEditingIdRef = useRef(generalInfoEditingId);
  generalInfoEditingIdRef.current = generalInfoEditingId;
  const generalInfoActiveTabRef = useRef(generalInfoActiveTab);
  generalInfoActiveTabRef.current = generalInfoActiveTab;
  const tempRestorePromptedRef = useRef(false);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const [generalInfoDeleteUndo, setGeneralInfoDeleteUndo] = useState<GeneralInfoItem | null>(null);
  const [generalInfoUrlMeta, setGeneralInfoUrlMeta] = useState<{
    url: string;
    title: string;
    description: string;
    image: string;
    siteName: string;
    text: string;
  } | null>(null);
  const [generalInfoUrlNotice, setGeneralInfoUrlNotice] = useState("");

  const syncGeneralInfoItemToSupabase = useCallback(async (
    item: GeneralInfoItem,
    method: "POST" | "PUT",
    options?: { silent?: boolean },
  ) => {
    const silent = Boolean(options?.silent);
    try {
      if (!silent) {
        const nextStatus = method === "POST" ? "일반 정보 Supabase 저장 중" : "일반 정보 Supabase 수정 중";
        if (generalInfoSupabaseStatusRef.current !== nextStatus) {
          setGeneralInfoSupabaseStatus(nextStatus);
        }
      }

      const response = await fetch("/api/general-info", {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...item,
          title: String(item.title || "").trim() || "(제목 없음)",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.detail || data.error || "일반 정보 Supabase 저장 실패");
      }

      addGeneralInfoRemoteIds([item.id, data.item?.id].filter((id): id is number => typeof id === "number"));

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
                isPinned: prevItem.isPinned || data.item.isPinned,
                pdfSaved: prevItem.pdfSaved || data.item.pdfSaved,
                appFileSaved: prevItem.appFileSaved || data.item.appFileSaved,
                formattedTextHtml:
                  data.item.formattedTextHtml || prevItem.formattedTextHtml || "",
                paragraphs: data.item.paragraphs?.length
                  ? data.item.paragraphs
                  : prevItem.paragraphs,
                filePreview: data.item.filePreview || prevItem.filePreview,
              };
            }
            return prevItem;
          }),
        );
      }

      if (!silent) {
        const successStatus = method === "POST" ? "일반 정보 Supabase 저장 완료" : "일반 정보 Supabase 수정 완료";
        if (generalInfoSupabaseStatusRef.current !== successStatus) {
          setGeneralInfoSupabaseStatus(successStatus);
        }
        showPasteHint(`✅ ${successStatus}`);
      }
      return true;
    } catch (error) {
      console.error("travel-diary general info sync failed", error);
      if (!silent) {
        const failStatus = method === "POST"
          ? "이 기기에는 저장됨 · Supabase 저장 실패"
          : "이 기기에는 수정됨 · Supabase 수정 실패";
        if (generalInfoSupabaseStatusRef.current !== failStatus) {
          setGeneralInfoSupabaseStatus(failStatus);
        }
        showPasteHint(`⚠️ ${failStatus} · 인터넷 연결 및 API 권한을 확인하세요.`);
      }
      return false;
    }
  }, [showPasteHint]);

  const syncGeneralInfoItemToSupabaseRef = useRef(syncGeneralInfoItemToSupabase);
  syncGeneralInfoItemToSupabaseRef.current = syncGeneralInfoItemToSupabase;
  const generalInfoLoadInFlightRef = useRef(false);
  const generalInfoLoadAgainRef = useRef(false);

  // --- Chapter 3 일반 정보 Supabase CRUD 헬퍼 (API Router 호출 복원) ---
  const loadGeneralInfoItemsFromSupabase = useCallback(async () => {
    if (generalInfoLoadInFlightRef.current) {
      generalInfoLoadAgainRef.current = true;
      return;
    }
    generalInfoLoadInFlightRef.current = true;

    try {
      do {
        generalInfoLoadAgainRef.current = false;

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
        const remoteIdSet = new Set<number>();
        const knownRemoteIds = readGeneralInfoRemoteIds();

        // 이미지 복원 로직: storagePath가 있으면 공개 URL로 복원 (영구 URL, 새로고침 후에도 유지)
        const restoredItems: GeneralInfoItem[] = remoteItems.map((item: GeneralInfoItem) => {
          if (item && typeof item.id === "number") remoteIdSet.add(item.id);

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

        persistGeneralInfoRemoteIds(remoteIdSet);

        let localOnlyItems: GeneralInfoItem[] = [];

        setGeneralInfoItems((prev) => {
          const map = new Map<number, GeneralInfoItem>();
          const deletedIds = locallyDeletedGeneralInfoIdsRef.current;

          // 1. Keep local items unless this device deleted them, or another device
          //    already removed a previously-synced row from Supabase.
          prev.forEach((item) => {
            if (!item || typeof item.id !== "number" || deletedIds.has(item.id)) return;
            if (knownRemoteIds.has(item.id) && !remoteIdSet.has(item.id)) return;
            map.set(item.id, item);
          });

          // 2. Merge remote items from Supabase (preserving isPinned / pdfSaved / appFileSaved / richer local media/html)
          restoredItems.forEach((remoteItem) => {
            if (remoteItem && typeof remoteItem.id === "number") {
              if (deletedIds.has(remoteItem.id)) return;

              const localItem = map.get(remoteItem.id);
              if (localItem) {
                const isPinned = !!(localItem.isPinned || remoteItem.isPinned);
                const pdfSaved = !!(localItem.pdfSaved || remoteItem.pdfSaved);
                const appFileSaved = !!(localItem.appFileSaved || remoteItem.appFileSaved);

                const remoteHasMedia = !!(
                  remoteItem.mediaItems &&
                  remoteItem.mediaItems.length > 0 &&
                  remoteItem.mediaItems[0].preview
                );
                const localHasMedia = !!(
                  localItem.mediaItems &&
                  localItem.mediaItems.length > 0 &&
                  localItem.mediaItems[0].preview
                );

                let mediaItems = remoteItem.mediaItems;
                if (!remoteHasMedia && localHasMedia) {
                  mediaItems = localItem.mediaItems;
                }

                map.set(remoteItem.id, {
                  ...remoteItem,
                  isPinned,
                  pdfSaved,
                  appFileSaved,
                  mediaItems,
                  filePreview: remoteItem.filePreview || localItem.filePreview,
                  formattedTextHtml:
                    remoteItem.formattedTextHtml || localItem.formattedTextHtml || "",
                  paragraphs: remoteItem.paragraphs?.length
                    ? remoteItem.paragraphs
                    : localItem.paragraphs,
                });
              } else {
                map.set(remoteItem.id, remoteItem);
              }
            }
          });

          const sortedResult = Array.from(map.values()).sort((a, b) => b.id - a.id);
          localOnlyItems = sortedResult.filter((item) => !remoteIdSet.has(item.id));

          persistGeneralInfoItemsToLocalStorage(sortedResult);

          return sortedResult;
        });

        let uploadedCount = 0;
        if (localOnlyItems.length > 0) {
          const uploadStatus = `이 기기 전용 ${localOnlyItems.length}건 Supabase 업로드 중`;
          if (generalInfoSupabaseStatusRef.current !== uploadStatus) {
            setGeneralInfoSupabaseStatus(uploadStatus);
          }

          for (const localItem of localOnlyItems) {
            const uploaded = await syncGeneralInfoItemToSupabaseRef.current(localItem, "POST", {
              silent: true,
            });
            if (uploaded) uploadedCount += 1;
          }
        }

        const failedCount = localOnlyItems.length - uploadedCount;
        const nextStatus = failedCount > 0
          ? `일반 정보 동기화 완료 · 서버 ${remoteItems.length}건 · 이 기기 전용 ${uploadedCount}건 올림 · ${failedCount}건 실패`
          : localOnlyItems.length > 0
            ? `일반 정보 동기화 완료 · 서버 ${remoteItems.length}건 · 이 기기 전용 ${uploadedCount}건 올림`
            : remoteItems.length > 0
              ? `일반 정보 Supabase 불러오기 완료 ${remoteItems.length}건`
              : "일반 정보 Supabase 저장자료 없음";

        if (generalInfoSupabaseStatusRef.current !== nextStatus) {
          setGeneralInfoSupabaseStatus(nextStatus);
        }
        if (uploadedCount > 0) {
          showPasteHint(`✅ 이 기기 전용 ${uploadedCount}건을 서버에 올렸습니다. 다른 기기에서 동기화하면 보입니다.`);
        }
      } while (generalInfoLoadAgainRef.current);
    } catch (error) {
      console.error("travel-diary general info load failed", error);
      if (generalInfoSupabaseStatusRef.current !== "일반 정보 Supabase 불러오기 실패 · 이 기기 자료 유지") {
        setGeneralInfoSupabaseStatus("일반 정보 Supabase 불러오기 실패 · 이 기기 자료 유지");
      }
    } finally {
      generalInfoLoadInFlightRef.current = false;
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
      return true;
    } catch (error) {
      console.error("travel-diary general info delete failed", error);
      if (generalInfoSupabaseStatusRef.current !== "일반 정보 Supabase 삭제 실패 · 목록을 되돌림") {
        setGeneralInfoSupabaseStatus("일반 정보 Supabase 삭제 실패 · 목록을 되돌림");
      }
      return false;
    }
  }, []);

  // --- 일반 정보 백업 및 취소/리셋 핸들러 ---
  const backupCurrentGeneralInfoDraft = useCallback(() => {
    setGeneralInfoDraftBackup({ ...generalInfoDraft });
  }, [generalInfoDraft]);

  const resetGeneralInfoRichTextEditor = useCallback((text = "", html = "") => {
    const unwrapped = htmlForActiveEditor(html);
    const nextHtml =
      unwrapped && unwrapped.trim()
        ? sanitizeGeneralInfoHtml(unwrapped)
        : makeGeneralInfoHtmlFromText(text);
    setGeneralInfoRichTextInitialHtml(nextHtml);
    setGeneralInfoRichTextEditorKey((prev) => prev + 1);
    if (generalInfoRichTextRef.current) {
      generalInfoRichTextRef.current.innerHTML = nextHtml;
    }
  }, []);

  const handleResetGeneralInfoDraft = useCallback(() => {
    const ok = window.confirm("현재 입력 중인 내용을 지울까요? 직전 입력으로 되돌릴 수 있습니다.");
    if (!ok) return;

    backupCurrentGeneralInfoDraft();
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoEditingId(null);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft({
      ...initialGeneralInfoDraft,
      paragraphs: [createEmptyParagraph()],
    });
    resetGeneralInfoRichTextEditor("", "");
    setGeneralInfoUrlMeta(null);
    try {
      localStorage.removeItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      notifyGeneralInfoTempDraft();
    } catch {
      /* ignore */
    }
    showPasteHint("현재 입력을 삭제했습니다. [되돌리기]로 복원할 수 있습니다.");
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
  const lastInstagramPreviewUrlRef = useRef("");
  const lastAppliedInstagramCaptionRef = useRef("");

  const writeInstagramCaptionIntoBody = useCallback((
    caption: string,
    options?: { image?: string; url?: string },
  ) => {
    const cleaned =
      isInstagramScrapeGarbage(caption) || isInstagramShareJunk(caption)
        ? ""
        : cleanInstagramCaption(caption);
    const image = String(options?.image || "").trim();
    const url = String(options?.url || "").trim();
    const realImage =
      /^(https?:\/\/|data:|blob:)/i.test(image) &&
      !/static\.cdninstagram\.com\/rsrc|rsrc\.php/i.test(image);

    if (!cleaned && !realImage) return false;

    const liveHtml = String(generalInfoRichTextRef.current?.innerHTML || "").trim();
    const liveText = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .trim();
    const empty = generalInfoHtmlLooksEmpty(liveHtml) && !liveText;
    const garbage =
      isInstagramScrapeGarbage(`${liveText}\n${liveHtml}`) ||
      isInstagramShareJunk(liveText);
    if (!empty && !garbage) {
      setGeneralInfoDraft((prev) => ({
        ...prev,
        sourceUrl: url || prev.sourceUrl,
        title:
          isInstagramScrapeGarbage(prev.title) || !prev.title
            ? titleFromInstagramCaption(cleaned) || prev.title
            : prev.title,
      }));
      return true;
    }

    const imageHtml = realImage
      ? `<p><img src="${escapeGeneralInfoHtml(image)}" alt="${escapeGeneralInfoHtml(cleaned || "미리보기")}" /></p>`
      : "";
    const textHtml = cleaned ? makeGeneralInfoHtmlFromText(cleaned) : "";
    const nextHtml = sanitizeGeneralInfoHtml(`${imageHtml}${textHtml}`);
    const nextText = cleaned;
    const titleGuess = titleFromInstagramCaption(cleaned);
    const paragraph = normalizeParagraph({
      html: nextHtml,
      text: nextText,
      createdAt: nowText(),
    });

    if (cleaned) lastAppliedInstagramCaptionRef.current = cleaned;

    setGeneralInfoDraft((prev) => ({
      ...prev,
      text: nextText,
      paragraphs: [paragraph],
      sourceUrl: url || prev.sourceUrl,
      formattedTextHtml: nextHtml,
      title:
        isInstagramScrapeGarbage(prev.title) || !prev.title || prev.title === "Instagram"
          ? titleGuess
          : prev.title,
      fileName: realImage ? "본문 대표 이미지" : "",
      filePreview: realImage ? image : "",
      fileType: realImage ? "image" : "none",
    }));
    resetGeneralInfoRichTextEditor(nextText, nextHtml);
    return true;
  }, [resetGeneralInfoRichTextEditor]);

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
    const rawText = String(result.text || description || "").trim();
    const garbageText =
      /InstagramUserAgent|is_edge_chromium|is_edge_legacy|"is_chrome"\s*:|KHTML, like Gecko/i.test(
        rawText,
      );
    const url = String(result.url || fallbackUrl || "").trim();
    const instagram = isInstagramHostText(url) || isInstagramPostUrl(url);
    const caption = instagram
      ? cleanInstagramCaption(
          garbageText
            ? ""
            : description || (!/^instagram$/i.test(title) ? title : "") || rawText,
        )
      : garbageText
        ? ""
        : rawText;
    const image = String(result.image || "").trim();
    const siteName = String(result.siteName || "").trim();
    const realImage =
      /^(https?:\/\/|data:|blob:)/i.test(image) &&
      !/static\.cdninstagram\.com\/rsrc|rsrc\.php/i.test(image);

    if (instagram && !realImage && !caption) {
      setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: url || prev.sourceUrl }));
      showPasteHint(
        lastAppliedInstagramCaptionRef.current
          ? "공개 메타데이터는 못 읽었습니다. 붙여넣은 캡션은 본문에 그대로 둡니다."
          : "공개 메타데이터를 읽지 못했습니다. 게시물 캡션을 본문에 붙여넣으세요.",
      );
      return;
    }

    if (!instagram && !realImage && !caption && /^instagram$/i.test(title || siteName)) {
      setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: url || prev.sourceUrl }));
      showPasteHint(
        "공개 메타데이터를 읽지 못했습니다. 게시물 사진·캡션을 본문에 직접 붙여넣으세요.",
      );
      return;
    }

    if (image) {
      setGeneralInfoImageLoadFailed(false);
    }

    if (instagram) {
      setGeneralInfoUrlMeta(null);
      setGeneralInfoUrlNotice("");
      writeInstagramCaptionIntoBody(caption, { image: realImage ? image : "", url });
      showPasteHint(
        realImage
          ? "메타보기를 본문 단락에 넣었습니다."
          : "캡션을 본문 단락에 넣었습니다.",
      );
      return;
    }

    setGeneralInfoUrlMeta({
      url,
      title: garbageText && !realImage ? "" : title,
      description: caption,
      image: realImage ? image : "",
      siteName,
      text: caption,
    });

    const liveHtml = String(
      generalInfoRichTextRef.current?.innerHTML ||
        generalInfoRichTextInitialHtml ||
        "",
    ).trim();
    const imageHtml = realImage
      ? `<p><img src="${escapeGeneralInfoHtml(image)}" alt="${escapeGeneralInfoHtml(title || "미리보기")}" /></p>`
      : "";
    const textHtml = makeGeneralInfoHtmlFromText(
      [title === "Instagram" ? "" : title, caption, url].filter(Boolean).join("\n\n"),
    );
    const nextHtml = sanitizeGeneralInfoHtml(
      [liveHtml, imageHtml, textHtml].filter(Boolean).join(""),
    );
    const nextText = String(
      `${String(generalInfoRichTextRef.current?.innerText || generalInfoDraft.text || "").trim()}\n\n${[title, caption, url].filter(Boolean).join("\n\n")}`.trim(),
    );

    setGeneralInfoDraft((prev) => ({
      ...prev,
      text: nextText || prev.text,
      sourceUrl: url || prev.sourceUrl,
      formattedTextHtml: nextHtml || prev.formattedTextHtml,
      fileName: prev.fileName || (realImage ? "본문 대표 이미지" : ""),
      filePreview: prev.filePreview || (realImage ? image : ""),
      fileType: prev.filePreview || realImage ? "image" : prev.fileType,
    }));

    resetGeneralInfoRichTextEditor(nextText, nextHtml);

    showPasteHint(
      image
        ? "메타보기를 본문 단락에 넣었습니다."
        : "메타 텍스트를 본문 단락에 넣었습니다.",
    );
  }, [
    generalInfoDraft.text,
    generalInfoRichTextInitialHtml,
    resetGeneralInfoRichTextEditor,
    showPasteHint,
    writeInstagramCaptionIntoBody,
  ]);

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

  const getDraftParagraphs = useCallback((draft: GeneralInfoDraft): GeneralInfoParagraph[] => {
    if (Array.isArray(draft.paragraphs) && draft.paragraphs.length > 0) {
      return draft.paragraphs.map(normalizeParagraph);
    }
    if (String(draft.formattedTextHtml || "").trim()) {
      return parseParagraphsFromHtml(String(draft.formattedTextHtml || ""));
    }
    if (String(draft.text || "").trim()) {
      return [
        normalizeParagraph({
          html: makeGeneralInfoHtmlFromText(draft.text),
          text: draft.text,
          createdAt: nowText(),
        }),
      ];
    }
    return [createEmptyParagraph()];
  }, []);

  const getCurrentGeneralInfoRichTextHtml = useCallback(() => {
    const live = String(generalInfoRichTextRef.current?.innerHTML || "").trim();
    const paragraphs = getDraftParagraphs(generalInfoDraft).map((p, index) => {
      if (index !== 0) return p;
      const html = live || p.html || generalInfoRichTextInitialHtml;
      const text = String(generalInfoRichTextRef.current?.innerText || p.text || "")
        .replace(/\u00a0/g, " ")
        .replace(/\n{4,}/g, "\n\n\n");
      return normalizeParagraph({ ...p, html, text });
    });
    return serializeParagraphsToHtml(paragraphs) || live || generalInfoRichTextInitialHtml;
  }, [generalInfoDraft, generalInfoRichTextInitialHtml, getDraftParagraphs]);

  const persistGeneralInfoTempDraft = useCallback((silent = false) => {
    const html = getCurrentGeneralInfoRichTextHtml();
    const draftToSave = {
      draft: generalInfoDraftRef.current,
      keywordText: generalInfoKeywordTextRef.current,
      richTextHtml: html,
      editingId: generalInfoEditingIdRef.current,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(GENERAL_INFO_TEMP_DRAFT_KEY, JSON.stringify(draftToSave));
      notifyGeneralInfoTempDraft();
      if (!silent) showPasteHint("현재 입력 중인 내용이 임시 저장되었습니다.");
    } catch {
      if (!silent) showPasteHint("임시 저장에 실패했습니다.");
    }
  }, [getCurrentGeneralInfoRichTextHtml, showPasteHint]);

  const applyGeneralInfoTempDraft = useCallback((parsed: {
    draft?: GeneralInfoDraft;
    keywordText?: string;
    richTextHtml?: string;
    editingId?: number | null;
  }) => {
    if (!parsed?.draft) return;
    const restoredBlob = [
      parsed.draft.text,
      parsed.draft.summary,
      parsed.draft.title,
      parsed.richTextHtml,
    ].join("\n");
    if (isInstagramScrapeGarbage(restoredBlob)) {
      try {
        localStorage.removeItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      notifyGeneralInfoTempDraft();
      } catch {
        /* ignore */
      }
      return;
    }
    setGeneralInfoDraft(parsed.draft);
    if (parsed.keywordText !== undefined) setGeneralInfoKeywordText(parsed.keywordText);

    const restoredEditingId =
      typeof parsed.editingId === "number" ? parsed.editingId : null;
    const localItems = readGeneralInfoItemsFromLocalStorage();
    const editingStillExists =
      restoredEditingId != null &&
      localItems.some((item) => item.id === restoredEditingId);

    if (editingStillExists) {
      setGeneralInfoEditingId(restoredEditingId);
    } else {
      setGeneralInfoEditingId(null);
    }

    const restoredHtml = String(parsed.richTextHtml || parsed.draft.formattedTextHtml || "");
    const restoredParagraphs = /data-gi-paragraph|gi-paragraph-date/i.test(restoredHtml)
      ? parseParagraphsFromHtml(restoredHtml)
      : parsed.draft.paragraphs;
    if (Array.isArray(restoredParagraphs) && restoredParagraphs.length > 0) {
      setGeneralInfoDraft({ ...parsed.draft, paragraphs: restoredParagraphs });
    }
    const active = (restoredParagraphs && restoredParagraphs[0]) || parsed.draft;
    resetGeneralInfoRichTextEditor(
      String(active?.text || parsed.draft.text || ""),
      String(active && "html" in active ? active.html : "") || htmlForActiveEditor(restoredHtml),
    );
  }, [resetGeneralInfoRichTextEditor]);

  const isGeneralInfoDraftDirty = useCallback(() => {
    const draft = generalInfoDraftRef.current;
    const html = getCurrentGeneralInfoRichTextHtml();
    if (String(draft.title || "").trim()) return true;
    if (String(draft.text || "").trim()) return true;
    if (String(draft.sourceUrl || "").trim()) return true;
    if (String(draft.summary || "").trim()) return true;
    if (String(draft.filePreview || "").trim()) return true;
    if ((draft.mediaItems || []).length > 0) return true;
    if ((draft.keywords || []).length > 0) return true;
    if (String(draft.primaryCategory || "").trim()) return true;
    if (String(draft.secondaryCategory || "").trim()) return true;
    if (!generalInfoHtmlLooksEmpty(html)) return true;
    if (
      Array.isArray(draft.paragraphs) &&
      draft.paragraphs.some((paragraph) => {
        if (String(paragraph.text || "").trim()) return true;
        return !generalInfoHtmlLooksEmpty(String(paragraph.html || ""));
      })
    ) {
      return true;
    }
    return generalInfoEditingIdRef.current != null;
  }, [getCurrentGeneralInfoRichTextHtml]);

  const confirmLeaveGeneralInfoCollect = useCallback(() => {
    if (generalInfoActiveTabRef.current !== "collect") return true;
    if (!isGeneralInfoDraftDirty()) return true;
    persistGeneralInfoTempDraft(true);
    return window.confirm("작성 중인 내용이 있습니다. 나가도 임시 저장은 유지됩니다. 나갈까요?");
  }, [isGeneralInfoDraftDirty, persistGeneralInfoTempDraft]);

  const resetGeneralInfoCollectToBlank = useCallback(() => {
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoEditingId(null);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft({
      ...initialGeneralInfoDraft,
      paragraphs: [createEmptyParagraph()],
    });
    resetGeneralInfoRichTextEditor("", "");
    setGeneralInfoUrlMeta(null);
    setGeneralInfoUrlNotice("");
    lastInstagramPreviewUrlRef.current = "";
    lastAppliedInstagramCaptionRef.current = "";
    try {
      localStorage.removeItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      notifyGeneralInfoTempDraft();
    } catch {
      /* ignore */
    }
    setGeneralInfoActiveTab("collect");
  }, [resetGeneralInfoRichTextEditor]);

  const handleStartNewGeneralInfo = useCallback(() => {
    const editing = generalInfoEditingIdRef.current != null;
    const onCollect = generalInfoActiveTabRef.current === "collect";
    const dirty = isGeneralInfoDraftDirty();

    if (!editing) {
      setGeneralInfoActiveTab("collect");
      if (!dirty) {
        showPasteHint("새 항목입니다. 본문 단락에 글이나 사진을 넣으세요.");
      }
      return;
    }

    if (onCollect && dirty) {
      const ok = window.confirm("수정 중인 글을 닫고 새 항목을 입력할까요?");
      if (!ok) return;
      backupCurrentGeneralInfoDraft();
    } else {
      persistGeneralInfoTempDraft(true);
    }

    resetGeneralInfoCollectToBlank();
    showPasteHint("새 항목입니다. 본문 단락에 글이나 사진을 넣으세요.");
  }, [
    backupCurrentGeneralInfoDraft,
    isGeneralInfoDraftDirty,
    persistGeneralInfoTempDraft,
    resetGeneralInfoCollectToBlank,
    showPasteHint,
  ]);

  const syncGeneralInfoRichTextToDraft = useCallback(() => {
    const plainText = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");
    const html = sanitizeGeneralInfoHtml(
      String(generalInfoRichTextRef.current?.innerHTML || "").trim(),
    );

    setGeneralInfoDraft((prev) => {
      const paragraphs = getDraftParagraphs(prev).map((p, index) =>
        index === 0 ? normalizeParagraph({ ...p, html, text: plainText }) : p,
      );
      const formattedTextHtml = serializeParagraphsToHtml(paragraphs);
      const text = paragraphsToPlainText(paragraphs);
      return { ...prev, paragraphs, text, formattedTextHtml };
    });
  }, [getDraftParagraphs]);

  const handleAddGeneralInfoParagraph = useCallback(() => {
    const liveHtml = sanitizeGeneralInfoHtml(
      String(generalInfoRichTextRef.current?.innerHTML || "").trim(),
    );
    const liveText = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");

    setGeneralInfoDraft((prev) => {
      const currentList = getDraftParagraphs(prev);
      const sealed = normalizeParagraph({
        ...currentList[0],
        html: liveHtml || currentList[0]?.html || "",
        text: liveText || currentList[0]?.text || "",
        createdAt: currentList[0]?.createdAt || nowText(),
      });

      if (isParagraphEmpty(sealed)) {
        showPasteHint("현재 단락이 비어 있습니다. 내용을 입력한 뒤 단락을 추가하세요.");
        return prev;
      }

      const nextActive = createEmptyParagraph(nowText());
      const paragraphs = [nextActive, sealed, ...currentList.slice(1)];
      return {
        ...prev,
        paragraphs,
        text: paragraphsToPlainText(paragraphs),
        formattedTextHtml: serializeParagraphsToHtml(paragraphs),
      };
    });

    resetGeneralInfoRichTextEditor("", "");
    showPasteHint("새 단락을 추가했습니다. 이전 단락은 아래로 이동했습니다.");
  }, [getDraftParagraphs, resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleRemoveGeneralInfoParagraph = useCallback((paragraphId: string) => {
    const currentList = getDraftParagraphs(generalInfoDraft);
    const removingActive = currentList[0]?.id === paragraphId;
    const nextList = currentList.filter((p) => p.id !== paragraphId);
    const paragraphs = nextList.length > 0 ? nextList : [createEmptyParagraph()];

    setGeneralInfoDraft((prev) => ({
      ...prev,
      paragraphs,
      text: paragraphsToPlainText(paragraphs),
      formattedTextHtml: serializeParagraphsToHtml(paragraphs),
    }));

    if (removingActive) {
      const active = paragraphs[0];
      resetGeneralInfoRichTextEditor(active.text || "", active.html || "");
    }
  }, [generalInfoDraft, getDraftParagraphs, resetGeneralInfoRichTextEditor]);

  // DOM ref에서 직접 최신 텍스트를 읽는 헬퍼 (state 업데이트 없이 버튼 핸들러에서 사용)
  const getCurrentGeneralInfoRichTextPlain = useCallback(() => {
    const live = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");
    const paragraphs = getDraftParagraphs(generalInfoDraft).map((p, index) =>
      index === 0 ? normalizeParagraph({ ...p, text: live || p.text }) : p,
    );
    return paragraphsToPlainText(paragraphs) || live;
  }, [generalInfoDraft, getDraftParagraphs]);

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
    runCollectRichCommand(generalInfoRichTextRef.current, command, value);
    syncGeneralInfoRichTextToDraft();
  }, [syncGeneralInfoRichTextToDraft]);

  /**
   * insta-fact-library 의 onUploadImages 와 동일: 파일 → 압축 → Supabase 업로드 → URL[] 반환.
   * 실패 시 data: URL 로 폴백 (에디터에 즉시 표시, 저장 시점에 재업로드).
   */
  const handleGeneralInfoUploadRichImages = useCallback(async (
    files: File[],
  ): Promise<string[]> => {
    const ready = filterUploadImageFiles(files);
    const urls: string[] = [];
    for (const file of ready) {
      try {
        const compressed = await compressImageFile(file);
        const result = await uploadFileToSupabaseStorage(compressed);
        urls.push(result.fileUrl);
      } catch (error) {
        console.error("rich image upload failed, fallback to data URL", error);
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("read failed"));
            reader.readAsDataURL(file);
          });
          if (dataUrl) urls.push(dataUrl);
        } catch {
          /* skip */
        }
      }
    }
    return urls;
  }, []);

  /** 파일(사진첩/파일) 또는 클립보드 이미지를 에디터에 인라인 삽입 */
  const insertGeneralInfoRichImages = useCallback(async (
    files: File[],
    opts?: { slotId?: string | null },
  ) => {
    const editor = generalInfoRichTextRef.current;
    const ready = filterUploadImageFiles(files);
    if (!editor || ready.length === 0) return;
    const urls = await handleGeneralInfoUploadRichImages(ready);
    if (!urls.length) return;
    editor.focus();
    enhanceRichInlineImages(editor);
    const inserted = insertImagesAtSlotOrCaret(
      editor,
      urls.map((src) => ({ src })),
      opts?.slotId,
    );
    if (inserted) {
      enhanceRichInlineImages(editor);
      syncGeneralInfoRichTextToDraft();
      showPasteHint(`✅ 이미지 ${urls.length}개를 넣었습니다.`);
    }
  }, [handleGeneralInfoUploadRichImages, syncGeneralInfoRichTextToDraft, showPasteHint]);

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
    const loadedItems: GeneralInfoMediaItem[] = [];
    const captionFromBody = extractFirstSentence(
      String(generalInfoRichTextRef.current?.innerText || generalInfoDraft.text || ""),
    );

    fileList.forEach((file) => {
      const fileType = file.type.startsWith("video/") ? "video" : "image";
      const reader = new FileReader();

      reader.onload = (event) => {
        const preview = String(event.target?.result || "");
        if (preview) {
          const item = makeGeneralInfoMediaItem(file.name, fileType, preview);
          loadedItems.push({
            ...item,
            memo: captionFromBody || item.memo,
          });
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
              ? `인포그래픽 ${fileList.length}개 추가`
              : "인포그래픽 추가",
          );
        }
      };

      reader.readAsDataURL(file);
    });
  }, [generalInfoDraft.text, showPasteHint]);

  const handleGeneralInfoRichPaste = useCallback((
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => {
    const clipboardData = event.clipboardData;
    const pastedFiles = imageFilesFromClipboard(clipboardData);

    if (pastedFiles.length > 0) {
      event.preventDefault();
      void insertGeneralInfoRichImages(pastedFiles);
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
    const instagramShare = splitInstagramShareText(cleanedText);
    if (instagramShare.url && !instagramShare.caption) {
      setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: instagramShare.url }));
      lastInstagramPreviewUrlRef.current = instagramShare.url;
      void extractGeneralInfoUrl(instagramShare.url)
        .then(() => showPasteHint("✅ Instagram 캡션을 본문에 넣었습니다."))
        .catch((error) => {
          console.error("travel-diary pasted url extract failed", error);
          showPasteHint(
            error instanceof Error
              ? error.message
              : "공개 메타데이터를 읽지 못했습니다. 캡션을 본문에 붙여넣으세요.",
          );
        });
      return;
    }

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
  }, [
    decodeGeneralInfoPastedText,
    extractGeneralInfoUrl,
    syncGeneralInfoRichTextToDraft,
    showPasteHint,
    insertGeneralInfoRichImages,
    generalInfoRichTextRef,
  ]);

  /**
   * insta-fact-library 의 handleInput(): 문장 끝 S/s/ㄴ 입력 시 이미지 칸(S1…) 생성.
   * onInput 이벤트에서 호출한다.
   */
  const handleGeneralInfoRichInput = useCallback(() => {
    const editor = generalInfoRichTextRef.current;
    if (!editor) return;
    const slotId = tryConsumeImageTriggerToSlot(editor);
    if (slotId) {
      enhanceRichInlineImages(editor);
    }
    syncGeneralInfoRichTextToDraft();
  }, [syncGeneralInfoRichTextToDraft]);

  /** 에디터 내 ×(이미지/칸 삭제) 클릭 처리. true 반환 시 기본 동작 중단 */
  const handleGeneralInfoRichEditorClick = useCallback((
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    const editor = generalInfoRichTextRef.current;
    if (!editor) return;
    const handled = handleRichImageSlotPointer(editor, event.target as Node);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      syncGeneralInfoRichTextToDraft();
    }
  }, [syncGeneralInfoRichTextToDraft]);

  /** 사진첩/파일 선택 input onChange */
  const handleGeneralInfoRichImagePick = useCallback((
    files: FileList | null,
  ) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    void insertGeneralInfoRichImages(list);
  }, [insertGeneralInfoRichImages]);

  const handleExtractGeneralInfoUrl = useCallback(async (rawUrl?: string, force = false) => {
    const raw = String(rawUrl ?? generalInfoDraft.sourceUrl).trim();
    const parsed = splitInstagramShareText(raw);
    const looksInstagram = isInstagramHostText(raw) || Boolean(parsed.url);

    if (!raw) {
      const emptyHint = "Instagram URL을 먼저 입력하세요.";
      setGeneralInfoUrlNotice(emptyHint);
      showPasteHint(emptyHint);
      return;
    }

    if (looksInstagram) {
      if (!parsed.url) {
        const homeHint =
          "지금 칸은 Instagram 홈(또는 프로필) 주소입니다. 원문 열기를 누르면 로그인 화면만 나옵니다. 게시물에서 「링크 복사」한 주소(예: https://www.instagram.com/p/XXXX/)를 붙여넣으세요.";
        setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: raw }));
        setGeneralInfoUrlMeta(null);
        setGeneralInfoUrlNotice(homeHint);
        showPasteHint(homeHint);
        return;
      }

      const liveBlob = [
        generalInfoDraft.text,
        generalInfoDraft.summary,
        generalInfoDraft.formattedTextHtml,
        String(generalInfoRichTextRef.current?.innerHTML || ""),
      ].join("\n");
      const wipeLeftover =
        isInstagramScrapeGarbage(liveBlob) ||
        isInstagramShareJunk(String(generalInfoRichTextRef.current?.innerText || generalInfoDraft.text || "")) ||
        (generalInfoHtmlLooksEmpty(String(generalInfoRichTextRef.current?.innerHTML || "")) &&
          !String(generalInfoDraft.text || "").trim());
      if (wipeLeftover) {
        setGeneralInfoDraft((prev) => ({
          ...prev,
          sourceUrl: parsed.url,
          text: "",
          paragraphs: [createEmptyParagraph()],
          formattedTextHtml: "",
          title: isInstagramScrapeGarbage(prev.title) ? "" : prev.title,
          summary: isInstagramScrapeGarbage(prev.summary) ? "" : prev.summary,
          fileName: "",
          filePreview: "",
          fileType: "none",
        }));
        resetGeneralInfoRichTextEditor("", "");
      } else {
        setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: parsed.url }));
      }
      if (parsed.caption) {
        writeInstagramCaptionIntoBody(parsed.caption, { url: parsed.url });
      }

      if (!force && lastInstagramPreviewUrlRef.current === parsed.url) {
        return;
      }

      lastInstagramPreviewUrlRef.current = parsed.url;

      try {
        setIsExtractingGeneralInfoUrl(true);
        setGeneralInfoUrlNotice("메타 보기 실행 중…");
        showPasteHint("메타 보기 실행 중…");
        await extractGeneralInfoUrl(parsed.url);
        setGeneralInfoUrlNotice("");
      } catch (error) {
        console.error("travel-diary extract url error", error);
        const failHint =
          parsed.caption || lastAppliedInstagramCaptionRef.current
            ? "공개 메타데이터는 못 읽었습니다. 붙여넣은 캡션은 본문에 그대로 둡니다."
            : error instanceof Error
              ? error.message
              : "공개 메타데이터를 읽지 못했습니다. Instagram은 로그인 화면만 보여주는 경우가 많습니다. 캡션을 본문에 붙여넣으세요.";
        setGeneralInfoUrlNotice(failHint);
        showPasteHint(failHint);
      } finally {
        setIsExtractingGeneralInfoUrl(false);
      }
      return;
    }

    let targetUrl = raw;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    setGeneralInfoDraft((prev) => ({ ...prev, sourceUrl: targetUrl }));

    try {
      setIsExtractingGeneralInfoUrl(true);
      showPasteHint("메타보기를 가져오는 중입니다.");
      await extractGeneralInfoUrl(targetUrl);
    } catch (error) {
      console.error("travel-diary extract url error", error);
      showPasteHint(error instanceof Error ? error.message : "메타보기를 가져오지 못했습니다.");
    } finally {
      setIsExtractingGeneralInfoUrl(false);
    }
  }, [
    generalInfoDraft.sourceUrl,
    generalInfoDraft.text,
    generalInfoDraft.summary,
    generalInfoDraft.formattedTextHtml,
    extractGeneralInfoUrl,
    resetGeneralInfoRichTextEditor,
    showPasteHint,
    writeInstagramCaptionIntoBody,
  ]);

  const applyGeneralInfoPastedText = useCallback(async (rawText: string, sourceLabel = "외부 앱") => {
    const text = rawText.trim();
    if (!text) {
      showPasteHint("⚠️ 붙여넣은 내용이 없습니다.");
      return;
    }

    backupCurrentGeneralInfoDraft();

    const instagramShare = splitInstagramShareText(text);
    const urlMatch = text.match(/https?:\/\/\S+/i);
    const firstUrl =
      instagramShare.url || urlMatch?.[0]?.replace(/[),.\]]+$/g, "") || "";

    if (firstUrl) {
      if (instagramShare.url) {
        setGeneralInfoDraft((prev) => ({
          ...prev,
          sourceUrl: instagramShare.url,
          title:
            prev.title ||
            titleFromInstagramCaption(instagramShare.caption) ||
            prev.title,
        }));
        if (instagramShare.caption) {
          writeInstagramCaptionIntoBody(instagramShare.caption, { url: instagramShare.url });
        }
        lastInstagramPreviewUrlRef.current = instagramShare.url;
        try {
          await extractGeneralInfoUrl(instagramShare.url);
          showPasteHint("✅ Instagram 캡션을 본문에 넣었습니다.");
        } catch (error) {
          console.error("travel-diary pasted url extract failed", error);
          showPasteHint(
            instagramShare.caption
              ? "공개 메타데이터는 못 읽었습니다. 붙여넣은 캡션은 본문에 그대로 둡니다."
              : "⚠️ URL은 입력했지만 자동 가져오기는 실패했습니다.",
          );
        }
        return;
      }

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
    }));

    resetGeneralInfoRichTextEditor(nextText, "");

    showPasteHint("✅ Text를 일반 정보 자료로 붙여넣었습니다.");
  }, [
    generalInfoDraft.text,
    backupCurrentGeneralInfoDraft,
    extractGeneralInfoUrl,
    resetGeneralInfoRichTextEditor,
    showPasteHint,
    writeInstagramCaptionIntoBody,
  ]);

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
      fileType: prev.mediaItems?.length ? prev.fileType : "none",
    }));
    showPasteHint("정보 창고 대표 이미지를 해제했습니다.");
  }, [showPasteHint]);

  const handleClearGeneralInfoInfographics = useCallback(() => {
    setGeneralInfoDraft((prev) => ({
      ...prev,
      mediaItems: [],
    }));
    showPasteHint("인포그래픽을 모두 삭제했습니다.");
  }, [showPasteHint]);

  const handleRemoveGeneralInfoMediaItem = useCallback((targetIndex: number) => {
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoDraft((prev) => {
      const currentMediaItems = getGeneralInfoInfographicItems(prev);
      const nextMediaItems = currentMediaItems.filter((_, index) => index !== targetIndex);
      return {
        ...prev,
        mediaItems: nextMediaItems,
      };
    });
    showPasteHint("인포그래픽을 삭제했습니다.");
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
    const effectiveDraft = latestText !== generalInfoDraft.text
      ? { ...generalInfoDraft, text: latestText }
      : generalInfoDraft;

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
      showPasteHint("🤖 Gemini가 일반 정보를 분석하는 중입니다.");

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

      const result = data.result || {};

      setGeneralInfoKeywordText(
        Array.isArray(result.keywords)
          ? result.keywords.map((keyword: string) => `#${String(keyword).replace(/^#+/, "")}`).join(", ")
          : generalInfoKeywordText,
      );

      setGeneralInfoDraft((prev) => ({
        ...prev,
        title: result.title || prev.title,
        summary: prev.summary,
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
        analyzed.keywords.map((keyword) => `#${String(keyword).replace(/^#+/, "")}`).join(", ")
      );
      setGeneralInfoDraft({ ...analyzed, summary: generalInfoDraft.summary });
      showPasteHint("⚠️ Gemini 분석 실패 · 임시 Mock 자동분류로 처리했습니다.");
    } finally {
      setIsAnalyzingGeneralInfo(false);
    }
  }, [generalInfoDraft, generalInfoKeywordText, getCurrentGeneralInfoRichTextPlain, showPasteHint]);

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

  /** 본문 rich HTML 안 인라인 data: 이미지를 Supabase 업로드 → 공개 URL로 치환 */
  const uploadGeneralInfoRichHtmlImages = useCallback(async (
    html: string,
  ): Promise<{ html: string; replacements: Array<{ from: string; to: string }> }> => {
    let next = String(html || "");
    const sources = extractMediaSrcFromHtml(next).filter((src) =>
      src.startsWith("data:"),
    );
    if (!sources.length) return { html: next, replacements: [] };
    const replacements: Array<{ from: string; to: string }> = [];
    for (const src of sources) {
      try {
        const file = await dataUrlToGeneralInfoFile(
          src,
          `inline-${Date.now()}.png`,
        );
        const compressed = await compressImageFile(file);
        const result = await uploadFileToSupabaseStorage(compressed);
        replacements.push({ from: src, to: result.fileUrl });
      } catch (error) {
        console.error("인라인 이미지 업로드 실패 (data 유지)", error);
      }
    }
    if (replacements.length) {
      next = replaceHtmlMediaSources(next, replacements);
    }
    return { html: next, replacements };
  }, [dataUrlToGeneralInfoFile]);

  const handleSaveTemporaryGeneralInfoDraft = useCallback(() => {
    persistGeneralInfoTempDraft(false);
  }, [persistGeneralInfoTempDraft]);

  const handleConfirmGeneralInfo = useCallback(async (overrides?: {
    title?: string;
    primaryCategory?: string;
    secondaryCategory?: string;
  }) => {
    const liveHtml = sanitizeGeneralInfoHtml(
      String(generalInfoRichTextRef.current?.innerHTML || "").trim(),
    );
    const liveText = String(generalInfoRichTextRef.current?.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{4,}/g, "\n\n\n");

    const paragraphs = getDraftParagraphs(generalInfoDraft).map((p, index) =>
      index === 0
        ? normalizeParagraph({
            ...p,
            html: liveHtml || p.html,
            text: liveText || p.text,
          })
        : p,
    );
    const analyzed = {
      ...generalInfoDraft,
      title: String(overrides?.title ?? generalInfoDraft.title),
      primaryCategory: String(overrides?.primaryCategory ?? generalInfoDraft.primaryCategory),
      secondaryCategory: String(overrides?.secondaryCategory ?? generalInfoDraft.secondaryCategory),
      paragraphs,
      text: paragraphsToPlainText(paragraphs),
      formattedTextHtml: serializeParagraphsToHtml(paragraphs),
    };

    const keywords = categoryKeywordsList(
      analyzed.primaryCategory,
      analyzed.secondaryCategory,
    );

    const inputTypes: GeneralInfoItem["inputTypes"] = [];
    const firstSentence = extractFirstSentence(analyzed.text);
    const draftMediaItems: GeneralInfoMediaItem[] = getGeneralInfoInfographicItems(analyzed).map((media) => ({
      ...media,
      memo: media.memo?.trim() || firstSentence || media.memo,
    }));

    const hasDraftImage = draftMediaItems.some((media) => media.type === "image");
    const hasDraftVideo = draftMediaItems.some((media) => media.type === "video");

    let uploadedDraftMediaItems: GeneralInfoMediaItem[] = draftMediaItems;

    if (hasDraftImage) {
      showPasteHint("일반 정보 이미지 업로드 중");
      uploadedDraftMediaItems = await uploadGeneralInfoMediaItemsToSupabaseStorage(draftMediaItems);
      showPasteHint("일반 정보 이미지 업로드 완료");
    }

    // 본문 인라인 이미지(data:) 업로드 및 공개 URL 치환
    const rawFormattedHtml = serializeParagraphsToHtml(paragraphs);
    const { html: uploadedFormattedHtml, replacements } =
      await uploadGeneralInfoRichHtmlImages(rawFormattedHtml);

    const uploadedParagraphs = parseParagraphsFromHtml(uploadedFormattedHtml).map((p, index) => {
      const source = paragraphs[index] || p;
      let html = p.html || source.html;
      for (const { from, to } of replacements) {
        if (html.includes(from)) html = html.split(from).join(to);
      }
      return normalizeParagraph({ ...source, ...p, html });
    });

    let coverPreview = String(analyzed.filePreview || "").trim();
    for (const { from, to } of replacements) {
      if (coverPreview === from) coverPreview = to;
    }
    coverPreview = pickGeneralInfoCoverSrc({
      filePreview: coverPreview,
      htmlParts: [uploadedFormattedHtml, ...uploadedParagraphs.map((paragraph) => paragraph.html)],
    });

    uploadedDraftMediaItems = getGeneralInfoInfographicItems({
      mediaItems: uploadedDraftMediaItems,
      formattedTextHtml: uploadedFormattedHtml,
      paragraphs: uploadedParagraphs,
      filePreview: coverPreview,
    });
    const uploadedMainMedia = uploadedDraftMediaItems[0];

    if (analyzed.text.trim()) inputTypes.push("text");
    if (coverPreview || analyzed.fileType === "image" || hasDraftImage) inputTypes.push("image");
    if (analyzed.fileType === "video" || hasDraftVideo) inputTypes.push("video");

    if (
      !analyzed.title.trim() &&
      !analyzed.text.trim() &&
      draftMediaItems.length === 0 &&
      !coverPreview
    ) {
      showPasteHint("저장할 일반 정보가 없습니다.");
      return;
    }

    const finalTitle =
      analyzed.title.trim() ||
      firstSentence ||
      analyzed.summary.trim() ||
      analyzed.fileName ||
      "일반 정보 자료";

    const item: GeneralInfoItem = {
      id: Date.now(),
      title: finalTitle,
      inputTypes,
      text: paragraphsToPlainText(uploadedParagraphs),
      formattedTextHtml: serializeParagraphsToHtml(uploadedParagraphs) || uploadedFormattedHtml,
      paragraphs: uploadedParagraphs,
      sourceUrl: String(analyzed.sourceUrl || "").trim() || undefined,
      fileName: coverPreview
        ? analyzed.fileName || "본문 대표 이미지"
        : analyzed.fileName || uploadedMainMedia?.name || undefined,
      filePreview: coverPreview || uploadedMainMedia?.preview || analyzed.filePreview || undefined,
      mediaItems: uploadedDraftMediaItems,
      primaryCategory: analyzed.primaryCategory || "",
      secondaryCategory: analyzed.secondaryCategory || "",
      thirdCategory: "",
      keywords,
      factCheckStatus: "확인 전",
      factCheckSummary: "",
      summary: analyzed.summary,
      extraNote: "",
      confirmed: true,
      createdAt: nowText(),
    };

    if (generalInfoEditingId) {
      const existingGeneralInfoItem = generalInfoItems.find(
        (prevItem) => prevItem.id === generalInfoEditingId,
      );

      // 임시저장 복원 등으로 editingId만 남아 목록에 없으면 수정(map no-op) 대신 신규 저장
      if (!existingGeneralInfoItem) {
        locallyDeletedGeneralInfoIdsRef.current.delete(item.id);
        setGeneralInfoItems((prev) => {
          const nextItems = [item, ...prev];
          persistGeneralInfoItemsToLocalStorage(nextItems);
          return nextItems;
        });
        void syncGeneralInfoItemToSupabase(item, "POST");
        setGeneralInfoDraftBackup(null);
        setGeneralInfoImageLoadFailed(false);
        setGeneralInfoEditingId(null);
        setGeneralInfoKeywordText("");
        setGeneralInfoDraft({
          ...initialGeneralInfoDraft,
          paragraphs: [createEmptyParagraph()],
        });
        resetGeneralInfoRichTextEditor("", "");
        setGeneralInfoUrlMeta(null);
        localStorage.removeItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      notifyGeneralInfoTempDraft();
        setGeneralInfoActiveTab("storage");
        showPasteHint("저장 완료");
        return item;
      }

      const updatedItem: GeneralInfoItem = {
        ...item,
        id: existingGeneralInfoItem.id,
        createdAt: existingGeneralInfoItem.createdAt || item.createdAt,
        extraNote: existingGeneralInfoItem.extraNote || "",
        sourceUrl:
          String(analyzed.sourceUrl || "").trim() ||
          existingGeneralInfoItem.sourceUrl ||
          undefined,
        filePreview: coverPreview || item.filePreview || existingGeneralInfoItem.filePreview,
        mediaItems: uploadedDraftMediaItems,
        paragraphs: item.paragraphs,
        formattedTextHtml: item.formattedTextHtml,
        isPinned: existingGeneralInfoItem.isPinned || false,
        pdfSaved: existingGeneralInfoItem.pdfSaved || false,
        appFileSaved: existingGeneralInfoItem.appFileSaved || false,
      };

      locallyDeletedGeneralInfoIdsRef.current.delete(updatedItem.id);

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
      setGeneralInfoDraft({
        ...initialGeneralInfoDraft,
        paragraphs: [createEmptyParagraph()],
      });
      resetGeneralInfoRichTextEditor("", "");
      setGeneralInfoUrlMeta(null);
      localStorage.removeItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      notifyGeneralInfoTempDraft();
      setGeneralInfoActiveTab("storage");
      showPasteHint("수정 저장 완료");
      return updatedItem;
    }

    locallyDeletedGeneralInfoIdsRef.current.delete(item.id);

    setGeneralInfoItems((prev) => {
      const nextItems = [item, ...prev];
      persistGeneralInfoItemsToLocalStorage(nextItems);
      return nextItems;
    });

    void syncGeneralInfoItemToSupabase(item, "POST");

    setGeneralInfoDraftBackup(null);
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft({
      ...initialGeneralInfoDraft,
      paragraphs: [createEmptyParagraph()],
    });
    resetGeneralInfoRichTextEditor("", "");
    setGeneralInfoUrlMeta(null);
    localStorage.removeItem(GENERAL_INFO_TEMP_DRAFT_KEY);
    notifyGeneralInfoTempDraft();
    setGeneralInfoActiveTab("storage");
    showPasteHint("저장 완료");
    return item;
  }, [
    generalInfoDraft,
    generalInfoEditingId,
    generalInfoItems,
    getDraftParagraphs,
    resetGeneralInfoRichTextEditor,
    showPasteHint,
    syncGeneralInfoItemToSupabase,
    uploadGeneralInfoMediaItemsToSupabaseStorage,
    uploadGeneralInfoRichHtmlImages,
  ]);

  const handleStartEditGeneralInfo = useCallback((item: GeneralInfoItem) => {
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoEditingId(item.id);
    setGeneralInfoDetailId(null);
    setGeneralInfoActiveTab("collect"); // 수정 시 자동으로 수집 탭 전환

    const bodyHtml = getGeneralInfoFormattedHtml(item);
    const paragraphs =
      Array.isArray(item.paragraphs) && item.paragraphs.length > 0
        ? item.paragraphs.map(normalizeParagraph)
        : parseParagraphsFromHtml(bodyHtml);
    const active = paragraphs[0] || createEmptyParagraph();

    setGeneralInfoKeywordText(
      formatCategoryKeywords(item.primaryCategory || "", item.secondaryCategory || "") ||
        (item.keywords || []).map((keyword) => `#${String(keyword).replace(/^#+/, "")}`).join(""),
    );

    resetGeneralInfoRichTextEditor(active.text || "", active.html || "");

    const bodyCover =
      pickGeneralInfoCoverSrc({
        filePreview: item.filePreview,
        htmlParts: [serializeParagraphsToHtml(paragraphs) || bodyHtml, ...paragraphs.map((p) => p.html)],
      }) || "";

    setGeneralInfoDraft({
      title: item.title || "",
      text: paragraphsToPlainText(paragraphs) || item.text || "",
      sourceUrl: item.sourceUrl || "",
      fileName: item.fileName || (bodyCover ? "본문 대표 이미지" : ""),
      filePreview: bodyCover,
      mediaItems: getGeneralInfoInfographicItems(item),
      fileType: item.inputTypes.includes("video")
        ? "video"
        : item.inputTypes.includes("image") || bodyCover
          ? "image"
          : "none",
      primaryCategory: item.primaryCategory || "",
      secondaryCategory: item.secondaryCategory || "",
      thirdCategory: "",
      keywords: categoryKeywordsList(item.primaryCategory || "", item.secondaryCategory || ""),
      summary: item.summary || "",
      factCheckStatus: item.factCheckStatus || "확인 전",
      factCheckSummary: item.factCheckSummary || "",
      formattedTextHtml: serializeParagraphsToHtml(paragraphs) || bodyHtml,
      paragraphs,
    });

    showPasteHint("저장된 일반 정보를 수정 모드로 불러왔습니다.");

    setTimeout(() => {
      const editForm = document.querySelector(".generalInfoLeftColumn");
      if (editForm) {
        editForm.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      generalInfoRichTextRef.current?.focus();
    }, 120);
  }, [resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleCancelEditGeneralInfo = useCallback(() => {
    const cancelledId = generalInfoEditingIdRef.current;
    setGeneralInfoImageLoadFailed(false);
    setGeneralInfoEditingId(null);
    setGeneralInfoKeywordText("");
    setGeneralInfoDraft({
      ...initialGeneralInfoDraft,
      paragraphs: [createEmptyParagraph()],
    });
    resetGeneralInfoRichTextEditor("", "");
    setGeneralInfoUrlMeta(null);

    try {
      const saved = localStorage.getItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const tempEditingId =
          typeof parsed?.editingId === "number" ? parsed.editingId : null;
        if (parsed?.draft && (tempEditingId == null || tempEditingId !== cancelledId)) {
          applyGeneralInfoTempDraft(parsed);
          showPasteHint("수정을 취소하고 이전 임시 저장을 불러왔습니다.");
          return;
        }
        if (tempEditingId === cancelledId) {
          localStorage.removeItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      notifyGeneralInfoTempDraft();
        }
      }
    } catch {
      /* ignore */
    }

    showPasteHint("수정 모드를 취소했습니다.");
  }, [applyGeneralInfoTempDraft, resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleImportGeneralInfoAppFile = useCallback(async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return "앱파일을 선택하세요.";
    try {
      const importedGroups = await Promise.all(list.map((file) => readGeneralInfoAppFileItems(file)));
      const imported = importedGroups.flat();
      if (!imported.length) return "앱파일에서 일반정보수집 항목을 찾지 못했습니다.";
      const baseId = Date.now();
      const nextItems: GeneralInfoItem[] = imported.map((item, index) => {
        forgetAppFileIndexArchive(item.id);
        forgetAppFileIndexArchiveMatch(item.title, item.createdAt || "");
        return {
          ...item,
          id: baseId + index,
          createdAt: item.createdAt || nowText(),
          confirmed: true,
          appFileSaved: true,
        };
      });
      setGeneralInfoItems((prev) => {
        const merged = [...nextItems, ...prev];
        persistGeneralInfoItemsToLocalStorage(merged);
        return merged;
      });
      nextItems.forEach((item) => {
        void syncGeneralInfoItemToSupabase(item, "POST");
      });
      setGeneralInfoActiveTab("storage");
      setGeneralInfoDetailId(nextItems[0]?.id ?? null);
      const message = `앱파일 ${nextItems.length}건을 불러와 정보 인덱스에 넣었습니다.`;
      showPasteHint(message);
      return message;
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "앱파일 불러오기에 실패했습니다.";
      showPasteHint(message);
      return message;
    }
  }, [showPasteHint, syncGeneralInfoItemToSupabase]);

  const handleExportGeneralInfoAppBundle = useCallback(() => {
    const items = generalInfoItems;
    if (!items.length) {
      const message = "앱파일로 만들 일반정보수집 항목이 없습니다.";
      showPasteHint(message);
      return message;
    }
    const filename = downloadGeneralInfoAppBundle(items);
    const ids = new Set(items.map((item) => item.id));
    setGeneralInfoItems((prev) => {
      let changed = false;
      const nextItems = prev.map((item) => {
        if (!ids.has(item.id) || item.appFileSaved) return item;
        changed = true;
        return { ...item, appFileSaved: true };
      });
      if (changed) persistGeneralInfoItemsToLocalStorage(nextItems);
      return changed ? nextItems : prev;
    });
    const message = `일반정보수집 ${items.length}건 앱파일을 저장했습니다. · ${filename}`;
    showPasteHint(message);
    return message;
  }, [generalInfoItems, showPasteHint]);

  const handleExportSelectedGeneralInfoAppFiles = useCallback(
    async (input: { savedIds: number[]; commitTempDraft: boolean }) => {
      let committed: GeneralInfoItem | undefined;
      if (input.commitTempDraft) {
        const saved = await handleConfirmGeneralInfo();
        if (saved) committed = saved;
      }
      const byId = new Map<number, GeneralInfoItem>();
      for (const item of generalInfoItems) {
        if (input.savedIds.includes(item.id)) byId.set(item.id, item);
      }
      if (committed) byId.set(committed.id, committed);
      else if (input.commitTempDraft) {
        const temp = readGeneralInfoTempDraftIndex();
        if (temp?.editingId != null) byId.delete(temp.editingId);
      }
      const list = [...byId.values()];
      if (!list.length) {
        const message = input.commitTempDraft
          ? "임시 저장을 저장하지 못해 앱파일을 만들지 못했습니다."
          : "앱파일로 만들 제목을 선택하세요.";
        showPasteHint(message);
        return message;
      }
      const filename = downloadGeneralInfoAppBundle(list);
      const ids = new Set(list.map((item) => item.id));
      setGeneralInfoItems((prev) => {
        let changed = false;
        const nextItems = prev.map((item) => {
          if (!ids.has(item.id) || item.appFileSaved) return item;
          changed = true;
          return { ...item, appFileSaved: true };
        });
        if (changed) persistGeneralInfoItemsToLocalStorage(nextItems);
        return changed ? nextItems : prev;
      });
      const message = `선택한 ${list.length}건 앱파일을 저장했습니다. · ${filename}`;
      showPasteHint(message);
      return message;
    },
    [generalInfoItems, handleConfirmGeneralInfo, showPasteHint],
  );

  const handleOpenGeneralInfoTempDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(GENERAL_INFO_TEMP_DRAFT_KEY);
      if (!saved) {
        showPasteHint("임시 저장된 내용이 없습니다.");
        return;
      }
      const parsed = JSON.parse(saved);
      applyGeneralInfoTempDraft(parsed);
      setGeneralInfoDetailId(null);
      setGeneralInfoActiveTab("collect");
      showPasteHint("임시 저장된 내용을 불러왔습니다.");
    } catch {
      showPasteHint("임시 저장을 열지 못했습니다.");
    }
  }, [applyGeneralInfoTempDraft, showPasteHint]);

  const markGeneralInfoPdfSaved = useCallback((itemId: number) => {
    setGeneralInfoItems((prev) => {
      let changed = false;
      const nextItems = prev.map((item) => {
        if (item.id !== itemId || item.pdfSaved) return item;
        changed = true;
        return { ...item, pdfSaved: true };
      });
      if (changed) {
        persistGeneralInfoItemsToLocalStorage(nextItems);
      }
      return changed ? nextItems : prev;
    });
  }, []);

  const markGeneralInfoAppFileSaved = useCallback((itemId: number) => {
    setGeneralInfoItems((prev) => {
      let changed = false;
      const nextItems = prev.map((item) => {
        if (item.id !== itemId || item.appFileSaved) return item;
        changed = true;
        return { ...item, appFileSaved: true };
      });
      if (changed) {
        persistGeneralInfoItemsToLocalStorage(nextItems);
      }
      return changed ? nextItems : prev;
    });
  }, []);

  const handleDownloadGeneralInfoPdf = useCallback(async (item: GeneralInfoItem) => {
    try {
      showPasteHint("PDF 작성 중…");
      const filename = await downloadGeneralInfoPdf(item);
      markGeneralInfoPdfSaved(item.id);
      showPasteHint(`PDF 저장 완료 · ${filename}`);
    } catch (error) {
      console.error(error);
      showPasteHint(error instanceof Error ? error.message : "PDF 저장 실패");
    }
  }, [showPasteHint, markGeneralInfoPdfSaved]);

  const handleShareGeneralInfoPdf = useCallback(async (item: GeneralInfoItem) => {
    try {
      showPasteHint("GoodNotes용 PDF 준비 중…");
      const result = await shareGeneralInfoPdfForGoodNotes(item);
      markGeneralInfoPdfSaved(item.id);
      showPasteHint(
        result.mode === "share"
          ? "공유 시트를 열었습니다. GoodNotes를 선택하세요."
          : `PDF 다운로드 · ${result.filename} (GoodNotes에서 가져오기)`,
      );
    } catch (error) {
      console.error(error);
      showPasteHint(error instanceof Error ? error.message : "공유 실패");
    }
  }, [showPasteHint, markGeneralInfoPdfSaved]);

  const handleDownloadGeneralInfoAppFile = useCallback((item: GeneralInfoItem) => {
    try {
      const filename = downloadGeneralInfoAppFile({ ...item, appFileSaved: true });
      markGeneralInfoAppFileSaved(item.id);
      showPasteHint(`앱파일 저장 완료 · ${filename}`);
    } catch (error) {
      console.error(error);
      showPasteHint(error instanceof Error ? error.message : "앱파일 저장 실패");
    }
  }, [showPasteHint, markGeneralInfoAppFileSaved]);

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

  const handleDeleteGeneralInfo = useCallback(async (itemId: number) => {
    const targetItem = generalInfoItems.find((item) => item.id === itemId);
    const ok = window.confirm(
      targetItem?.appFileSaved
        ? "이 일반 정보 자료를 삭제할까요? 앱파일로 저장한 항목은 정보 인덱스에 빨간 ★로 남습니다."
        : "이 일반 정보 자료를 정말 삭제할까요?",
    );
    if (!ok) return;

    if (targetItem?.appFileSaved) {
      const cover = pickGeneralInfoCoverSrc({
        filePreview: targetItem.filePreview,
        htmlParts: [
          targetItem.formattedTextHtml,
          ...(Array.isArray(targetItem.paragraphs) ? targetItem.paragraphs.map((paragraph) => paragraph.html) : []),
        ],
      });
      archiveRemovedAppFileIndex({
        id: targetItem.id,
        title: targetItem.title || "제목 없음",
        createdAt: targetItem.createdAt,
        primaryCategory: targetItem.primaryCategory || "",
        secondaryCategory: targetItem.secondaryCategory || "",
        keywords: targetItem.keywords || [],
        thumbUrl: /^https?:\/\//i.test(cover) ? cover : undefined,
      });
    }

    locallyDeletedGeneralInfoIdsRef.current.add(itemId);

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

    if (!targetItem) return;

    const deleted = await deleteGeneralInfoItemFromSupabase(itemId);
    if (!deleted) {
      if (targetItem.appFileSaved) forgetAppFileIndexArchive(itemId);
      locallyDeletedGeneralInfoIdsRef.current.delete(itemId);
      setGeneralInfoItems((prev) => {
        const nextItems = [targetItem, ...prev.filter((item) => item.id !== targetItem.id)];
        persistGeneralInfoItemsToLocalStorage(nextItems);
        return nextItems;
      });
      showPasteHint("삭제에 실패해 목록을 되돌렸습니다.");
      return;
    }

    removeGeneralInfoRemoteIds([itemId]);

    setGeneralInfoDeleteUndo(targetItem);
    if (deleteUndoTimerRef.current) {
      window.clearTimeout(deleteUndoTimerRef.current);
    }
    deleteUndoTimerRef.current = window.setTimeout(() => {
      setGeneralInfoDeleteUndo((current) => (current?.id === targetItem.id ? null : current));
      deleteUndoTimerRef.current = null;
    }, 12000);
    showPasteHint("삭제했습니다. 잠시 동안 [되돌리기]로 복원할 수 있습니다.");
  }, [generalInfoItems, generalInfoEditingId, deleteGeneralInfoItemFromSupabase, resetGeneralInfoRichTextEditor, showPasteHint]);

  const handleUndoDeleteGeneralInfo = useCallback(async () => {
    const item = generalInfoDeleteUndo;
    if (!item) return;

    forgetAppFileIndexArchive(item.id);
    locallyDeletedGeneralInfoIdsRef.current.delete(item.id);
    setGeneralInfoItems((prev) => {
      const nextItems = [item, ...prev.filter((prevItem) => prevItem.id !== item.id)];
      persistGeneralInfoItemsToLocalStorage(nextItems);
      return nextItems;
    });
    setGeneralInfoDeleteUndo(null);
    if (deleteUndoTimerRef.current) {
      window.clearTimeout(deleteUndoTimerRef.current);
      deleteUndoTimerRef.current = null;
    }
    await syncGeneralInfoItemToSupabase(item, "POST");
    showPasteHint("삭제를 되돌렸습니다.");
  }, [generalInfoDeleteUndo, syncGeneralInfoItemToSupabase, showPasteHint]);

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

  useEffect(() => {
    const draft = generalInfoDraftRef.current;
    if (
      !isInstagramScrapeGarbage(
        [draft.text, draft.summary, draft.title, draft.formattedTextHtml].join("\n"),
      )
    ) {
      return;
    }
    resetGeneralInfoCollectToBlank();
  }, [resetGeneralInfoCollectToBlank]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (generalInfoActiveTab !== "collect") return;
    if (tempRestorePromptedRef.current) return;
    if (isGeneralInfoDraftDirty()) return;

    const saved = localStorage.getItem(GENERAL_INFO_TEMP_DRAFT_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);
      if (!parsed?.draft) return;
      tempRestorePromptedRef.current = true;
      if (window.confirm("임시 저장된 내용이 있습니다. 이어서 쓸까요?")) {
        applyGeneralInfoTempDraft(parsed);
        showPasteHint("임시 저장된 내용을 불러왔습니다.");
      }
    } catch (error) {
      console.error("Failed to parse temp draft", error);
    }
  }, [
    applyGeneralInfoTempDraft,
    generalInfoActiveTab,
    isGeneralInfoDraftDirty,
    showPasteHint,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (generalInfoActiveTab !== "collect") return;

    const intervalId = window.setInterval(() => {
      if (!isGeneralInfoDraftDirty()) return;
      persistGeneralInfoTempDraft(true);
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [generalInfoActiveTab, isGeneralInfoDraftDirty, persistGeneralInfoTempDraft]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (generalInfoActiveTabRef.current !== "collect") return;
      if (!isGeneralInfoDraftDirty()) return;
      persistGeneralInfoTempDraft(true);
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isGeneralInfoDraftDirty, persistGeneralInfoTempDraft]);

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
    setIsExtractingGeneralInfoUrl,
    generalInfoDetailId,
    setGeneralInfoDetailId,
    generalInfoExportItem,
    setGeneralInfoExportItem,
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
    handleUndoDeleteGeneralInfo,
    generalInfoDeleteUndo,
    confirmLeaveGeneralInfoCollect,
    handleStartNewGeneralInfo,
    handleImportGeneralInfoAppFile,
    handleExportGeneralInfoAppBundle,
    handleExportSelectedGeneralInfoAppFiles,
    handleOpenGeneralInfoTempDraft,
    handleDownloadGeneralInfoPdf,
    handleShareGeneralInfoPdf,
    handleDownloadGeneralInfoAppFile,
    markGeneralInfoPdfSaved,
    markGeneralInfoAppFileSaved,
    loadGeneralInfoItemsFromSupabase,
    handleUndoGeneralInfoDraft,
    handleResetGeneralInfoDraft,
    handleSaveTemporaryGeneralInfoDraft,
    handleCollectGeneralInfoFromClipboard,
    handleExtractGeneralInfoUrl,
    isExtractingGeneralInfoUrl,
    generalInfoUrlMeta,
    generalInfoUrlNotice,
    handleGeneralInfoFileUpload,
    handleGeneralInfoIphonePasteZonePaste,
    handleClearGeneralInfoCoverImage,
    handleClearGeneralInfoInfographics,
    handleRemoveGeneralInfoMediaItem,
    handleAnalyzeGeneralInfoDraft,
    handleConfirmGeneralInfo,
    handleAddGeneralInfoParagraph,
    handleRemoveGeneralInfoParagraph,
    filteredGeneralInfoItems,
    generalInfoCategories,
    normalizeGeneralInfoMediaItems,
    getGeneralInfoDisplayMediaItems,
    syncGeneralInfoRichTextToDraft,
    handleGeneralInfoRichPaste,
    handleGeneralInfoRichCommand,
    handleGeneralInfoRichInput,
    handleGeneralInfoRichEditorClick,
    handleGeneralInfoRichImagePick,
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
