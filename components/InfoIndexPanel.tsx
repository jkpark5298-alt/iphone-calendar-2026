"use client";

import React from "react";
import type { GeneralInfoItem } from "../types/generalInfo";
import { pickGeneralInfoCoverSrc } from "../lib/generalInfoHelpers";
import {
  BUILDER_APP_URL,
  IFL_APP_URL,
  INFO_INDEX_CATEGORIES,
  INFO_INDEX_SOURCE_OPTIONS,
  INFO_INDEX_SOURCE_SHORT,
  APP_FILE_INDEX_ARCHIVE_EVENT,
  buildIndexItem,
  groupIndexItems,
  dedupeIndexItems,
  infoIndexSourceClass,
  infoIndexSourceHomeUrl,
  parseIflLibraryPayload,
  readAppFileIndexArchive,
  type AppFileIndexArchiveEntry,
  type InfoIndexCategory,
  type InfoIndexItem,
  type InfoIndexSource,
  type InfoIndexView,
} from "../lib/infoIndex";
import {
  GENERAL_INFO_TEMP_DRAFT_EVENT,
  readGeneralInfoTempDraftIndex,
} from "../lib/generalInfoStorage";

const PIN_STORAGE_KEY = "travel-diary-info-index-pins-v1";
const IFL_IMPORT_KEY = "travel-diary-ifl-index-v1";
const IFL_TOKEN_KEY = "travel-diary-ifl-api-token";
const MANUAL_STORAGE_KEY = "travel-diary-info-index-manual-v1";

type Props = {
  localItems: GeneralInfoItem[];
  onOpenLocalDetail: (id: number) => void;
  onEditLocal?: (id: number) => void;
  onToggleLocalPin: (id: number) => void;
  localStatus?: string;
  onExportLocalAppFiles?: () => string | void | Promise<string | void>;
  onExportSelectedAppFiles?: (input: {
    savedIds: number[];
    commitTempDraft: boolean;
  }) => string | void | Promise<string | void>;
  onImportLocalAppFiles?: (files: FileList | null) => string | void | Promise<string | void>;
  onOpenTempDraft?: () => void;
  composeOpen?: boolean;
  onComposeOpenChange?: (open: boolean) => void;
};

function todayInputValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readPinnedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writePinnedIds(ids: Set<string>) {
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

function readManualItems(): InfoIndexItem[] {
  try {
    const raw = localStorage.getItem(MANUAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as InfoIndexItem[]) : [];
  } catch {
    return [];
  }
}

function PriorityPinIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 2.4 14.7 8l6.1.7-4.5 4.2 1.2 6.1L12 16.2 6.5 19l1.2-6.1L3.2 8.7 9.3 8 12 2.4Z"
        fill={active ? "#facc15" : "none"}
        stroke={active ? "#ca8a04" : "#94a3b8"}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function localThumbUrl(item: GeneralInfoItem) {
  return pickGeneralInfoCoverSrc({
    filePreview: item.filePreview,
    htmlParts: [
      item.formattedTextHtml,
      ...(Array.isArray(item.paragraphs) ? item.paragraphs.map((paragraph) => paragraph.html) : []),
    ],
  });
}

function localToIndexItem(
  item: GeneralInfoItem,
  saveStatus: "저장" | "임시 저장" = "저장",
): InfoIndexItem {
  return buildIndexItem({
    id: `local:${item.id}`,
    title: item.title || "제목 없음",
    createdAt: item.createdAt,
    categoryRaw: item.primaryCategory,
    tags: [
      item.primaryCategory,
      item.secondaryCategory,
      ...(item.keywords || []),
    ],
    source: "local",
    detailUrl: "",
    localNumericId: item.id,
    thumbUrl: localThumbUrl(item),
    appFileMark: item.appFileSaved ? "saved" : undefined,
    saveStatus,
  });
}

function removedArchiveToIndexItem(entry: AppFileIndexArchiveEntry): InfoIndexItem {
  return buildIndexItem({
    id: `local-removed:${entry.id}`,
    title: entry.title || "제목 없음",
    createdAt: entry.createdAt,
    categoryRaw: entry.primaryCategory,
    tags: [entry.primaryCategory, entry.secondaryCategory, ...(entry.keywords || [])],
    source: "local",
    detailUrl: "",
    thumbUrl: entry.thumbUrl,
    appFileMark: "removed",
    saveStatus: "삭제됨",
  });
}

function AppFileStar({ mark }: { mark: "saved" | "removed" }) {
  const removed = mark === "removed";
  return (
    <span
      className={`infoIndexAppFileStar ${removed ? "isRemoved" : "isSaved"}`}
      title={removed ? "앱에서 삭제됨. 앱파일 불러오기로 다시 넣을 수 있습니다." : "앱파일로 저장됨"}
      aria-label={removed ? "앱에서 삭제된 앱파일" : "앱파일 저장됨"}
    >
      ★
    </span>
  );
}

export function InfoIndexPanel({
  localItems,
  onOpenLocalDetail,
  onEditLocal,
  onToggleLocalPin,
  localStatus,
  onExportLocalAppFiles,
  onExportSelectedAppFiles,
  onImportLocalAppFiles,
  onOpenTempDraft,
  composeOpen,
  onComposeOpenChange,
}: Props) {
  const [view, setView] = React.useState<InfoIndexView>("date");
  const [selectedKey, setSelectedKey] = React.useState<string>("");
  const [remoteItems, setRemoteItems] = React.useState<InfoIndexItem[]>([]);
  const [importedIflItems, setImportedIflItems] = React.useState<InfoIndexItem[]>([]);
  const [manualItems, setManualItems] = React.useState<InfoIndexItem[]>([]);
  const [removedArchive, setRemovedArchive] = React.useState<AppFileIndexArchiveEntry[]>([]);
  const [status, setStatus] = React.useState("앱에서 인덱스를 불러오는 중…");
  const [sourceNote, setSourceNote] = React.useState("");
  const [pinnedIds, setPinnedIds] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);
  const [iflToken, setIflToken] = React.useState("");
  const [internalComposeOpen, setInternalComposeOpen] = React.useState(false);
  const [draftCategory, setDraftCategory] = React.useState<InfoIndexCategory>("기타");
  const [draftTitle, setDraftTitle] = React.useState("");
  const [draftDate, setDraftDate] = React.useState(todayInputValue);
  const [draftSource, setDraftSource] = React.useState<InfoIndexSource>("local");
  const [draftPinned, setDraftPinned] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [tempTick, setTempTick] = React.useState(0);
  const [appFileBusy, setAppFileBusy] = React.useState(false);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());

  const isComposeOpen = composeOpen ?? internalComposeOpen;
  const setComposeOpen = (open: boolean) => {
    setInternalComposeOpen(open);
    onComposeOpenChange?.(open);
  };

  React.useEffect(() => {
    if (typeof composeOpen === "boolean") setInternalComposeOpen(composeOpen);
  }, [composeOpen]);

  React.useEffect(() => {
    const syncTemp = () => setTempTick((value) => value + 1);
    window.addEventListener(GENERAL_INFO_TEMP_DRAFT_EVENT, syncTemp);
    window.addEventListener("storage", syncTemp);
    return () => {
      window.removeEventListener(GENERAL_INFO_TEMP_DRAFT_EVENT, syncTemp);
      window.removeEventListener("storage", syncTemp);
    };
  }, []);

  React.useEffect(() => {
    const syncArchive = () => setRemovedArchive(readAppFileIndexArchive());
    syncArchive();
    window.addEventListener(APP_FILE_INDEX_ARCHIVE_EVENT, syncArchive);
    return () => window.removeEventListener(APP_FILE_INDEX_ARCHIVE_EVENT, syncArchive);
  }, [localItems]);

  React.useEffect(() => {
    setPinnedIds(readPinnedIds());
    setManualItems(readManualItems());
    try {
      const saved = localStorage.getItem(IFL_IMPORT_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) setImportedIflItems(parsed as InfoIndexItem[]);
    } catch {
      /* ignore */
    }
    try {
      setIflToken(localStorage.getItem(IFL_TOKEN_KEY) || "");
    } catch {
      /* ignore */
    }
  }, []);

  const saveManualItems = (items: InfoIndexItem[]) => {
    setManualItems(items);
    localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(items));
  };

  const loadRemote = React.useCallback(async () => {
    setLoading(true);
    setStatus("앱에서 인덱스를 불러오는 중…");
    try {
      const token = (localStorage.getItem(IFL_TOKEN_KEY) || iflToken || "").trim();
      const response = await fetch("/api/info-index", {
        cache: "no-store",
        headers: token ? { "x-ifl-token": token } : undefined,
      });
      const data = await response.json();
      const items = Array.isArray(data.items) ? (data.items as InfoIndexItem[]) : [];
      setRemoteItems(items);
      const builderCount = Number(data.sources?.builder?.count || 0);
      const iflCount = Number(data.sources?.ifl?.count || 0);
      const iflError = String(data.sources?.ifl?.error || "");
      setSourceNote(
        `builder-zeta-eight ${builderCount}건 · insta-fact-library 클라우드 ${iflCount}건`,
      );
      if (iflCount > 0) {
        setStatus("인덱스를 불러왔습니다.");
      } else if (iflError === "no-token") {
        setStatus(
          "insta-fact-library는 홈페이지에 목록이 없습니다. 앱에서 보낸 .ifl.json을 불러오거나, IFL에 입력한 API 토큰으로 클라우드를 가져오세요.",
        );
      } else if (iflError.includes("401") || iflError.includes("인증")) {
        setStatus("IFL API 토큰이 맞지 않습니다. 인스타 팩트 라이브러리 앱에 넣은 토큰을 그대로 입력하세요.");
      } else {
        setStatus("인덱스를 불러왔습니다. IFL 항목이 없으면 앱파일을 불러오세요.");
      }
    } catch (error) {
      console.error("info-index load failed", error);
      setRemoteItems([]);
      setStatus("외부 앱 인덱스를 불러오지 못했습니다. 이 앱에 저장된 항목은 그대로 보여 줍니다.");
    } finally {
      setLoading(false);
    }
  }, [iflToken]);

  React.useEffect(() => {
    void loadRemote();
  }, [loadRemote]);

  const merged = React.useMemo(() => {
    void tempTick;
    const tempDraft = readGeneralInfoTempDraftIndex();
    const tempEditingId = tempDraft?.editingId ?? null;
    const local = localItems.map((item) =>
      localToIndexItem(item, tempEditingId === item.id ? "임시 저장" : "저장"),
    );
    const liveIds = new Set(localItems.map((item) => item.id));
    const liveSavedKeys = new Set(
      local
        .filter((item) => item.appFileMark === "saved")
        .map((item) => `${item.title}|${item.dateKey}`),
    );
    const removed = removedArchive
      .filter((entry) => entry.removedFromApp && !liveIds.has(entry.id))
      .map(removedArchiveToIndexItem)
      .filter((item) => !liveSavedKeys.has(`${item.title}|${item.dateKey}`));
    const tempOnly =
      tempDraft && !localItems.some((item) => item.id === tempEditingId)
        ? [
            buildIndexItem({
              id: "local-temp:draft",
              title: tempDraft.title,
              createdAt: tempDraft.savedAt || new Date().toISOString(),
              categoryRaw: tempDraft.category,
              tags: tempDraft.category ? [tempDraft.category] : [],
              source: "local",
              detailUrl: "",
              saveStatus: "임시 저장",
            }),
          ]
        : [];
    const byId = new Map<string, InfoIndexItem>();
    for (const item of [...remoteItems, ...importedIflItems, ...local, ...tempOnly, ...removed, ...manualItems]) {
      byId.set(item.id, {
        ...item,
        pinned:
          item.source === "local" && item.localNumericId
            ? Boolean(localItems.find((row) => row.id === item.localNumericId)?.isPinned)
            : pinnedIds.has(item.id) || Boolean(item.pinned),
      });
    }
    return dedupeIndexItems(Array.from(byId.values())).sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.dateKey || "").localeCompare(a.dateKey || "");
    });
  }, [localItems, remoteItems, importedIflItems, manualItems, pinnedIds, removedArchive, tempTick]);

  const filtered = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return merged;
    return merged.filter((item) => {
      const blob = [
        item.title,
        item.category,
        item.sourceLabel,
        item.createdAtLabel,
        item.dateKey,
        item.createdAt,
        item.saveStatus,
        ...(item.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(query);
    });
  }, [merged, searchQuery]);

  const groups = React.useMemo(() => groupIndexItems(filtered, view), [filtered, view]);
  const visibleGroups = React.useMemo(() => {
    if (!selectedKey) return groups;
    return groups.filter((group) => group.key === selectedKey);
  }, [groups, selectedKey]);

  const changeView = (next: InfoIndexView) => {
    setView(next);
    setSelectedKey("");
  };

  const toggleSelectedKey = (key: string) => {
    setSelectedKey((prev) => (prev === key ? "" : key));
  };

  const saveImportedIfl = (items: InfoIndexItem[]) => {
    setImportedIflItems(items);
    localStorage.setItem(IFL_IMPORT_KEY, JSON.stringify(items));
  };

  const handleImportIflFile = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const items = parseIflLibraryPayload(parsed);
        if (!items.length) {
          setStatus("IFL 앱파일에서 항목을 찾지 못했습니다. .ifl.json 파일을 선택하세요.");
          return;
        }
        saveImportedIfl(dedupeIndexItems([...importedIflItems, ...items]));
        setStatus(`insta-fact-library 앱파일 ${items.length}건을 인덱스에 넣었습니다.`);
      } catch {
        setStatus("IFL 앱파일을 읽지 못했습니다. .ifl.json 인지 확인하세요.");
      }
    };
    reader.readAsText(file);
  };

  const handleFetchIflCloud = () => {
    const token = iflToken.trim();
    if (!token) {
      setStatus("IFL API 토큰을 입력하세요. 인스타 팩트 라이브러리 앱에 넣은 값과 같습니다.");
      return;
    }
    localStorage.setItem(IFL_TOKEN_KEY, token);
    void loadRemote();
  };

  const openCompose = () => {
    setDraftCategory("기타");
    setDraftTitle("");
    setDraftDate(todayInputValue());
    setDraftSource("local");
    setDraftPinned(false);
    setComposeOpen(true);
  };

  const handleSaveManual = () => {
    const title = draftTitle.trim();
    if (!title) {
      setStatus("제목을 입력하세요.");
      return;
    }
    const item = buildIndexItem({
      id: `manual:${Date.now()}`,
      title,
      createdAt: draftDate,
      categoryRaw: draftCategory,
      tags: [draftCategory],
      source: draftSource,
      detailUrl: infoIndexSourceHomeUrl(draftSource),
    });
    saveManualItems([item, ...manualItems]);
    if (draftPinned) {
      setPinnedIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        writePinnedIds(next);
        return next;
      });
    }
    setComposeOpen(false);
    setStatus("인덱스를 추가했습니다. 우선 표시 항목은 분류·일자·태그 맨 위에 나옵니다.");
  };

  const openLocalDetail = (item: InfoIndexItem) => {
    if (item.localNumericId) onOpenLocalDetail(item.localNumericId);
  };

  const editLocal = (item: InfoIndexItem) => {
    if (item.id === "local-temp:draft" || item.saveStatus === "임시 저장") {
      onOpenTempDraft?.();
      return;
    }
    if (item.localNumericId) onEditLocal?.(item.localNumericId);
  };

  const togglePin = (item: InfoIndexItem) => {
    if (item.source === "local" && item.localNumericId) {
      onToggleLocalPin(item.localNumericId);
      return;
    }
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      writePinnedIds(next);
      return next;
    });
  };

  const groupLabel = (key: string) => {
    if (view === "tag") return key.startsWith("#") ? key : `#${key}`;
    if (view === "date") return key.replace(/-/g, ".");
    return key;
  };

  const canSelectForAppFile = (item: InfoIndexItem) => {
    if (item.saveStatus !== "저장" && item.saveStatus !== "임시 저장") return false;
    if (item.id === "local-temp:draft") return true;
    return item.source === "local" && typeof item.localNumericId === "number";
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportSelectedAppFiles = () => {
    if (!onExportSelectedAppFiles) return;
    const picked = merged.filter(
      (item) => selectedIds.has(item.id) && canSelectForAppFile(item),
    );
    if (!picked.length) return;
    const savedIds = picked
      .map((item) => item.localNumericId)
      .filter((id): id is number => typeof id === "number");
    const commitTempDraft = picked.some((item) => item.saveStatus === "임시 저장");
    setAppFileBusy(true);
    Promise.resolve(onExportSelectedAppFiles({ savedIds, commitTempDraft }))
      .then((message) => {
        if (message) setStatus(message);
        if (typeof message === "string" && message.includes("앱파일을 저장했습니다")) {
          setSelectedIds(new Set());
          setSelectMode(false);
        }
      })
      .finally(() => setAppFileBusy(false));
  };

  const selectedCount = merged.filter(
    (item) => selectedIds.has(item.id) && canSelectForAppFile(item),
  ).length;

  const navItems =
    view === "category"
      ? INFO_INDEX_CATEGORIES.map((category) => ({
          key: category,
          label: category,
          count: groups.find((group) => group.key === category)?.items.length || 0,
        }))
      : groups.map((group) => ({
          key: group.key,
          label: groupLabel(group.key),
          count: group.items.length,
        }));

  const renderTitle = (item: InfoIndexItem) => {
    const title = (
      <span className="infoIndexTitleLine">
        {item.appFileMark ? <AppFileStar mark={item.appFileMark} /> : null}
        <strong>{item.title}</strong>
      </span>
    );
    if (item.saveStatus === "임시 저장") {
      return (
        <button type="button" className="infoIndexTitleButton" onClick={() => onOpenTempDraft?.()}>
          {title}
        </button>
      );
    }
    if (item.appFileMark === "removed") {
      return (
        <button
          type="button"
          className="infoIndexTitleButton"
          onClick={() =>
            setStatus("앱에서 삭제한 항목입니다. 빨간 ★로 인덱스에 남아 있으며, 앱파일 불러오기로 다시 넣을 수 있습니다.")
          }
        >
          {title}
        </button>
      );
    }
    if (item.source === "local" && item.localNumericId) {
      return (
        <button type="button" className="infoIndexTitleButton" onClick={() => openLocalDetail(item)}>
          {title}
        </button>
      );
    }
    if (item.detailUrl || infoIndexSourceHomeUrl(item.source)) {
      return (
        <a
          className="infoIndexTitleButton"
          href={item.detailUrl || infoIndexSourceHomeUrl(item.source)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {title}
        </a>
      );
    }
    return <div className="infoIndexTitleButton">{title}</div>;
  };

  const renderDetail = (item: InfoIndexItem) => {
    const className = `infoIndexDetailButton ${infoIndexSourceClass(item.source)}`;
    if (item.appFileMark === "removed") {
      const tellRemoved = () =>
        setStatus("앱에서 삭제한 항목입니다. 빨간 ★로 인덱스에 남아 있으며, 앱파일 불러오기로 다시 넣을 수 있습니다.");
      return (
        <div className="infoIndexDetailActions">
          <button type="button" className={`${className} isRemoved`} onClick={tellRemoved}>
            수정
          </button>
          <button type="button" className={`${className} isRemoved`} onClick={tellRemoved}>
            보기
          </button>
        </div>
      );
    }
    if (item.source === "local" || item.id === "local-temp:draft") {
      return (
        <div className="infoIndexDetailActions">
          <button type="button" className={className} onClick={() => editLocal(item)}>
            수정
          </button>
          <button
            type="button"
            className={className}
            onClick={() => {
              if (item.id === "local-temp:draft") onOpenTempDraft?.();
              else openLocalDetail(item);
            }}
          >
            보기
          </button>
        </div>
      );
    }
    const href = item.detailUrl || infoIndexSourceHomeUrl(item.source);
    return (
      <div className="infoIndexDetailActions">
        <a className={className} href={href} target="_blank" rel="noopener noreferrer">
          수정
        </a>
        <a className={className} href={href} target="_blank" rel="noopener noreferrer">
          보기
        </a>
      </div>
    );
  };

  return (
    <section className="infoIndexPanel">
      <div className="infoIndexMobileHead">
        <div className="chapterTitleBox infoIndexTitleRow">
          <h2 style={{ margin: 0 }}>정보 인덱스</h2>
          <button
            type="button"
            className="infoIndexPlusBtn"
            onClick={openCompose}
            aria-label="인덱스 입력"
            title="인덱스 입력"
          >
            +
          </button>
        </div>
        <p className="infoIndexHelp">
          제목이나 상세보기를 누르면 작성된 앱으로 가서 내용을 확인합니다. 우선 표시는 분류·일자·태그에서 맨 위에 올립니다.
          노란 ★는 앱파일로 저장한 항목이고, 그 항목을 앱에서 지워도 인덱스에 남습니다. 그때는 빨간 ★로 바뀝니다.
        </p>
      </div>

      {isComposeOpen && (
        <form
          className="infoIndexComposeBox"
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveManual();
          }}
        >
          <strong>인덱스 입력</strong>
          <div className="infoIndexComposeGrid">
            <label>
              분류
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value as InfoIndexCategory)}
              >
                {INFO_INDEX_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              제목
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="제목을 입력하세요"
              />
            </label>
            <label>
              생성일자
              <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} />
            </label>
            <label>
              발생처
              <select
                value={draftSource}
                onChange={(e) => setDraftSource(e.target.value as InfoIndexSource)}
              >
                {INFO_INDEX_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="infoIndexComposePin">
              <input
                type="checkbox"
                checked={draftPinned}
                onChange={(e) => setDraftPinned(e.target.checked)}
              />
              우선 표시 (분류·일자·태그 맨 위)
            </label>
          </div>
          <div className="infoIndexComposeActions">
            <button type="submit" className="primaryButton">
              저장
            </button>
            <button type="button" className="secondaryButton" onClick={() => setComposeOpen(false)}>
              취소
            </button>
          </div>
        </form>
      )}

      <div className="infoIndexSearchRow">
        <input
          className="infoIndexSearchInput"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="제목, 분류, 태그, 발생처, 날짜 검색"
          aria-label="정보 인덱스 검색"
        />
        {searchQuery ? (
          <button type="button" className="secondaryButton" onClick={() => setSearchQuery("")}>
            지우기
          </button>
        ) : null}
      </div>

      <div className="infoIndexDesktop">
        <aside className="infoIndexDesktopNav">
          <div className="infoIndexToolbar">
            <div className="ch3TabBar infoIndexViewTabs">
              <button
                type="button"
                className={`ch3TabBtn ${view === "category" ? "active" : ""}`}
                onClick={() => changeView("category")}
              >
                분류
              </button>
              <button
                type="button"
                className={`ch3TabBtn ${view === "date" ? "active" : ""}`}
                onClick={() => changeView("date")}
              >
                일자
              </button>
              <button
                type="button"
                className={`ch3TabBtn ${view === "tag" ? "active" : ""}`}
                onClick={() => changeView("tag")}
              >
                태그
              </button>
            </div>
          </div>
          <div className="infoIndexCategoryChips">
            {(view === "category" || selectedKey) && (
              <button
                type="button"
                className={`infoIndexChip ${selectedKey === "" ? "active" : ""}`}
                onClick={() => setSelectedKey("")}
              >
                <span>전체</span>
                <span className="infoIndexChipCount">{filtered.length}</span>
              </button>
            )}
            {view === "category" &&
              navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`infoIndexChip ${selectedKey === item.key ? "active" : ""}`}
                  onClick={() => toggleSelectedKey(item.key)}
                >
                  <span>{item.label}</span>
                  <span className="infoIndexChipCount">{item.count}</span>
                </button>
              ))}
          </div>
        </aside>

        <div className="infoIndexDesktopMain">
          <div className="infoIndexDesktopTools">
            <div className="infoIndexAppLinks">
              <a href={IFL_APP_URL} target="_blank" rel="noopener noreferrer">
                insta 열기
              </a>
              <a href={BUILDER_APP_URL} target="_blank" rel="noopener noreferrer">
                builder 열기
              </a>
            </div>
            <button
              type="button"
              className="secondaryButton"
              disabled={loading}
              onClick={() => void loadRemote()}
            >
              {loading ? "불러오는 중…" : "다시 불러오기"}
            </button>
            <button
              type="button"
              className="secondaryButton"
              disabled={appFileBusy || localItems.length === 0}
              onClick={() => {
                if (!onExportLocalAppFiles) return;
                setAppFileBusy(true);
                Promise.resolve(onExportLocalAppFiles())
                  .then((message) => {
                    if (message) setStatus(message);
                  })
                  .finally(() => setAppFileBusy(false));
              }}
            >
              {appFileBusy ? "앱파일 만드는 중…" : "일괄 앱파일"}
            </button>
            {onExportSelectedAppFiles ? (
              <button
                type="button"
                className="secondaryButton"
                disabled={appFileBusy}
                onClick={() => {
                  if (!selectMode) {
                    setSelectMode(true);
                    return;
                  }
                  if (selectedCount === 0) {
                    setSelectMode(false);
                    return;
                  }
                  exportSelectedAppFiles();
                }}
              >
                {selectMode
                  ? selectedCount > 0
                    ? `선택 앱파일 (${selectedCount})`
                    : "선택 취소"
                  : "제목별 앱파일"}
              </button>
            ) : null}
            <label className="secondaryButton" style={{ margin: 0, cursor: "pointer" }}>
              앱파일 불러오기
              <input
                type="file"
                accept=".json,.airzeta-gi.json,application/json"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  const files = event.target.files;
                  event.target.value = "";
                  if (!files?.length || !onImportLocalAppFiles) return;
                  setAppFileBusy(true);
                  Promise.resolve(onImportLocalAppFiles(files))
                    .then((message) => {
                      if (message) setStatus(message);
                    })
                    .finally(() => setAppFileBusy(false));
                }}
              />
            </label>
          </div>

          <div className="infoIndexIflBox">
            <p className="mutedText infoIndexIflNote">
              insta-fact-library는 홈페이지에 목록이 없고 이 기기 IndexedDB에 있습니다. 앱파일 또는 클라우드 토큰으로 가져옵니다.
            </p>
            <div className="infoIndexIflActions">
              <label className="secondaryButton" style={{ margin: 0, cursor: "pointer" }}>
                IFL 앱파일
                <input
                  type="file"
                  accept=".json,.ifl.json,application/json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    handleImportIflFile(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <input
                type="password"
                value={iflToken}
                onChange={(e) => setIflToken(e.target.value)}
                placeholder="IFL API 토큰"
                autoComplete="off"
              />
              <button type="button" className="primaryButton" disabled={loading} onClick={handleFetchIflCloud}>
                클라우드
              </button>
            </div>
          </div>

          <p className="infoIndexAppFileLegend">
            <span><span className="infoIndexAppFileStar isSaved">★</span> 앱파일로 저장됨</span>
            <span><span className="infoIndexAppFileStar isRemoved">★</span> 앱에서 삭제됨. 인덱스에 남음. 앱파일 불러오기로 다시 넣을 수 있음</span>
          </p>

          <p className="mutedText infoIndexStatusLine">
            {sourceNote || "외부 앱 목록"} · 이 앱 {localItems.length}건
            {searchQuery.trim() ? ` · 검색 ${filtered.length}건` : ""}
            {localStatus ? ` · ${localStatus}` : ""} · {status}
          </p>

          {merged.length === 0 ? (
            <p className="mutedText">아직 인덱스에 넣을 항목이 없습니다.</p>
          ) : filtered.length === 0 ? (
            <p className="mutedText">“{searchQuery.trim()}”에 맞는 항목이 없습니다.</p>
          ) : visibleGroups.length === 0 ? (
            <p className="mutedText">선택한 분류에 항목이 없습니다. 전체를 누르면 목록이 다시 나옵니다.</p>
          ) : (
            <div className="infoIndexTableWrap">
              <table className="infoIndexTable">
                <thead>
                  <tr>
                    {selectMode ? <th className="infoIndexSelectCol">선택</th> : null}
                    <th>{view === "category" ? "분류" : view === "date" ? "일자" : "태그"}</th>
                    <th>제목</th>
                    {view !== "date" ? <th className="infoIndexDateCol">일자</th> : null}
                    <th className="infoIndexSourceCol">발생처</th>
                    <th className="infoIndexSaveStatusCell">상태</th>
                    <th>상세보기</th>
                    <th>우선</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroups.map((group) =>
                    group.items.map((item) => (
                      <tr
                        key={`${group.key}-${item.id}`}
                        className={[item.pinned ? "pinned" : "", item.appFileMark === "removed" ? "appFileRemoved" : ""]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {selectMode ? (
                          <td className="infoIndexSelectCol">
                            {canSelectForAppFile(item) ? (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelected(item.id)}
                                aria-label={`${item.title} 선택`}
                              />
                            ) : null}
                          </td>
                        ) : null}
                        <td className="infoIndexGroupCell">
                          <button
                            type="button"
                            className={`infoIndexGroupButton ${selectedKey === group.key ? "active" : ""}`}
                            onClick={() => toggleSelectedKey(group.key)}
                          >
                            {groupLabel(group.key)}
                          </button>
                        </td>
                        <td className="infoIndexTitleCell">{renderTitle(item)}</td>
                        {view !== "date" ? (
                          <td className="infoIndexDateCell infoIndexDateCol">{item.createdAtLabel}</td>
                        ) : null}
                        <td className="infoIndexSourceCell infoIndexSourceCol">
                          <span className={`infoIndexSourceBadge ${infoIndexSourceClass(item.source)}`}>
                            {INFO_INDEX_SOURCE_SHORT[item.source]}
                          </span>
                        </td>
                        <td className="infoIndexSaveStatusCell">
                          {item.source === "local" && item.saveStatus ? (
                            <span className={`infoIndexSaveStatus is-${item.saveStatus === "임시 저장" ? "temp" : item.saveStatus === "삭제됨" ? "removed" : "saved"}`}>
                              {item.saveStatus}
                            </span>
                          ) : (
                            <span className="mutedText">—</span>
                          )}
                        </td>
                        <td className="infoIndexDetailCell">{renderDetail(item)}</td>
                        <td className="infoIndexPinCell">
                          <button
                            type="button"
                            className={`infoIndexPinButton ${item.pinned ? "isPinned" : ""} ${item.thumbUrl ? "hasThumb" : ""}`}
                            onClick={() => togglePin(item)}
                            aria-label={item.pinned ? "우선 해제" : "우선"}
                            title={item.pinned ? "우선 해제" : "우선 표시: 분류·일자·태그 맨 위"}
                          >
                            {item.thumbUrl ? (
                              <img src={item.thumbUrl} alt="" className="infoIndexThumb" />
                            ) : (
                              <PriorityPinIcon active={Boolean(item.pinned)} />
                            )}
                            {item.thumbUrl ? (
                              <span className="infoIndexThumbPin">
                                <PriorityPinIcon active={Boolean(item.pinned)} />
                              </span>
                            ) : null}
                          </button>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
