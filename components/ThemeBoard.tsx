"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CollectFormatToolbar } from "./CollectFormatToolbar";
import { CollectWhiteCell } from "./CollectWhiteCell";
import { SlotImagePanel } from "./SlotImagePanel";
import { ClassTagSelect } from "./ClassTagSelect";
import { EntryLookup, plainSnippet, type LookupHit } from "./EntryLookup";
import { HandwritingModal } from "./HandwritingModal";
import { SaveStatusBar, type SaveBarState } from "./SaveStatusBar";
import { TextToImageModal } from "./TextToImageModal";
import { appendHashtagToEditor } from "../lib/contentClass";
import { stepCollectFontSize } from "../lib/collectFormatPalette";
import { readClipboardImageFiles, runCollectRichCommand } from "../lib/collectRichFormat";
import { makeWhiteCellId, readStackedHtml, removeClassCellFromEvent, splitWhiteCells } from "../lib/collectClassCell";
import {
  IMAGE_SLOT_GUIDE,
  ensureImageSlot,
  removeImageSlot,
  enhanceRichInlineImages,
  findAwaitingSlotId,
  handleRichImageSlotPointer,
  insertImagesAtSlotOrCaret,
  tryConsumeImageTriggerToSlot,
  tryConsumeDateTimeTrigger,
} from "../lib/richImageSlots";
import { compressImageFile, filterUploadImageFiles } from "../lib/compressImageFile";
import { insertPositionForNewCell, moveWhiteCell, removeTargetCellId } from "../lib/whiteCellOps";
import { PASTE_IMAGE_FAILED_MESSAGE, pasteClipboardImages, readPastedClipboard } from "../lib/richPaste";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import {
  createThemeNote,
  deleteThemeNote,
  loadThemeNotesWithStatus,
  persistThemes,
  writeLocalThemes,
  type ThemeNote,
} from "../lib/themeNotes";

/** 목록 위에 바로 보이는 테마 칩 수(고정한 테마 + 최근 수정한 테마). 나머지는 [전체 보기]에서 고른다. */
const VISIBLE_THEME_CHIPS = 6;
const THEME_PINS_KEY = "iphone-calendar-2026-theme-pins";

function readPinnedThemeIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(THEME_PINS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function formatThemeDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

async function uploadThemeImages(files: File[], themeId: string) {
  const ready = filterUploadImageFiles(files).slice(0, 8);
  const urls: string[] = [];
  for (const file of ready) {
    let compressed = file;
    try {
      compressed = await compressImageFile(file);
    } catch {
      compressed = file;
    }
    if (isSupabaseConfigured && supabase) {
      try {
        const storagePath = `themes/${themeId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${compressed.name || "photo.jpg"}`;
        const { error } = await supabase.storage.from("diary-photos").upload(storagePath, compressed, {
          contentType: compressed.type || "image/jpeg",
          cacheControl: "31536000",
          upsert: true,
        });
        if (!error) {
          const { data } = supabase.storage.from("diary-photos").getPublicUrl(storagePath);
          if (data.publicUrl) {
            urls.push(data.publicUrl);
            continue;
          }
        }
      } catch (error) {
        console.warn("테마 이미지 업로드 실패", error);
      }
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("read failed"));
        reader.readAsDataURL(compressed);
      });
      if (dataUrl) urls.push(dataUrl);
    } catch {
      /* skip */
    }
  }
  return urls;
}

export function ThemeBoard({ onBack, initialThemeId = "" }: { onBack: () => void; initialThemeId?: string }) {
  const [notes, setNotes] = useState<ThemeNote[]>([]);
  const [activeId, setActiveId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [whiteCellIds, setWhiteCellIds] = useState<string[]>([]);
  const [fontSizePx, setFontSizePx] = useState(15);
  const [showHandwriting, setShowHandwriting] = useState(false);
  const [imageSlotId, setImageSlotId] = useState<string | null>(null);
  const [showTextImage, setShowTextImage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [themeLookup, setThemeLookup] = useState("");
  const [themeLookupHits, setThemeLookupHits] = useState<LookupHit[]>([]);
  const [themeLookupStatus, setThemeLookupStatus] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [themeListQuery, setThemeListQuery] = useState("");
  const [themeListSort, setThemeListSort] = useState<"recent" | "name">("recent");
  const [saveState, setSaveState] = useState<{ state: SaveBarState; at: string | null } | null>(null);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const pendingSlotRef = useRef<string | null>(null);
  const whiteHtmlRef = useRef<Record<string, string>>({});
  const notesRef = useRef<ThemeNote[]>([]);
  const activeIdRef = useRef("");
  const readyRef = useRef(false);
  const appliedIdRef = useRef("");
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveRetryRef = useRef<number | null>(null);
  const pendingSavesRef = useRef(0);
  const draftTitleRef = useRef("");
  draftTitleRef.current = draftTitle;

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    let alive = true;
    setRemoteFailed(false);
    void loadThemeNotesWithStatus().then(({ notes: items, remoteOk }) => {
      if (!alive) return;
      setRemoteFailed(!remoteOk);
      // 서버를 못 읽었는데 기기에도 없으면 빈 테마를 만들어 서버에 올리지 않고 안내만 보여 준다.
      if (!items.length && !remoteOk) {
        setNotes([]);
        setLoaded(true);
        return;
      }
      const next = items.length ? items : [createThemeNote("새 테마")];
      if (!items.length) void persistThemes(next, next[0].id);
      const focus = next.find((note) => note.id === initialThemeId) || next[0];
      // 다시 시도로 목록이 바뀌어도 편집창이 새로 채워지도록 한다.
      appliedIdRef.current = "";
      readyRef.current = false;
      setNotes(next);
      setActiveId(focus.id);
      setDraftTitle(focus.title);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [initialThemeId, reloadTick]);

  /** 서버 저장을 순서대로 보냅니다(늦게 끝난 옛 저장이 새 내용을 덮어쓰지 않도록 항상 최신 내용을 보냄). */
  function saveToServer(id: string): Promise<boolean> {
    if (saveRetryRef.current) {
      window.clearTimeout(saveRetryRef.current);
      saveRetryRef.current = null;
    }
    pendingSavesRef.current += 1;
    setSaveState((prev) => ({ state: "saving", at: prev?.at ?? null }));
    const job = saveChainRef.current.then(async () => {
      const ok = await persistThemes(notesRef.current, id);
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current > 0) return ok; // 뒤에 저장이 더 남아 있으면 마지막 결과만 표시
      setSaveState({ state: ok ? "saved" : "error", at: new Date().toISOString() });
      if (!ok) {
        saveRetryRef.current = window.setTimeout(() => {
          saveRetryRef.current = null;
          void saveToServer(id);
        }, 5000);
      }
      return ok;
    });
    saveChainRef.current = job.catch(() => false);
    return job;
  }

  function commitActive(nextTitle?: string): Promise<boolean> | undefined {
    if (!readyRef.current) return undefined;
    const id = activeIdRef.current;
    const editor = editorRef.current;
    if (!id || !editor) return undefined;
    const html = readStackedHtml(editor);
    const title = (nextTitle ?? draftTitleRef.current).trim() || "새 테마";
    const updatedAt = new Date().toISOString();
    const next = notesRef.current.map((note) =>
      note.id === id ? { ...note, title, html, updatedAt } : note,
    );
    notesRef.current = next;
    setNotes(next);
    writeLocalThemes(next);
    return saveToServer(id);
  }

  // 앱을 닫거나 다른 앱으로 넘어갈 때 마지막 내용을 바로 보냅니다.
  useEffect(() => {
    const flush = () => void commitActive();
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!loaded) return;
    const editor = editorRef.current;
    const note = notes.find((item) => item.id === activeId);
    if (!editor || !note) return;
    if (appliedIdRef.current === activeId && readyRef.current) return;

    readyRef.current = false;
    const parsed = splitWhiteCells(note.html || "");
    editor.innerHTML = parsed.main;
    const ids = parsed.extras.map((html) => {
      const id = makeWhiteCellId();
      whiteHtmlRef.current[id] = html;
      return id;
    });
    setWhiteCellIds(ids);
    setDraftTitle(note.title);
    enhanceRichInlineImages(editor);
    appliedIdRef.current = activeId;
    readyRef.current = true;
  }, [loaded, activeId, notes]);

  function switchTheme(id: string) {
    if (id === activeIdRef.current) return;
    commitActive();
    readyRef.current = false;
    appliedIdRef.current = "";
    const note = notesRef.current.find((item) => item.id === id);
    setDraftTitle(note?.title || "");
    setActiveId(id);
  }

  function addTheme() {
    commitActive();
    const note = createThemeNote("새 테마");
    const next = [...notesRef.current, note];
    notesRef.current = next;
    setNotes(next);
    writeLocalThemes(next);
    void saveToServer(note.id);
    readyRef.current = false;
    appliedIdRef.current = "";
    setDraftTitle(note.title);
    setActiveId(note.id);
  }

  useEffect(() => {
    setPinnedIds(readPinnedThemeIds());
  }, []);

  function togglePin(id: string) {
    const next = pinnedIds.includes(id) ? pinnedIds.filter((item) => item !== id) : [...pinnedIds, id];
    setPinnedIds(next);
    try {
      localStorage.setItem(THEME_PINS_KEY, JSON.stringify(next));
    } catch {
      /* 저장 공간이 없으면 이번 화면에서만 적용 */
    }
  }

  function removeTheme(id: string) {
    if (pendingDeleteId !== id) return;
    const note = notesRef.current.find((item) => item.id === id);
    if (!note) return;
    setPendingDeleteId("");
    const next = notesRef.current.filter((item) => item.id !== id);
    const fallback = next.length ? next : [createThemeNote("새 테마")];
    notesRef.current = fallback;
    setNotes(fallback);
    void persistThemes(fallback);
    void deleteThemeNote(id);
    if (activeIdRef.current === id) {
      readyRef.current = false;
      appliedIdRef.current = "";
      setDraftTitle(fallback[0].title);
      setActiveId(fallback[0].id);
    }
  }

  async function insertImages(files: File[], slotId?: string | null, extraUrls: string[] = []) {
    const editor = editorRef.current;
    const ready = filterUploadImageFiles(files);
    if (!editor || (!ready.length && !extraUrls.length) || !activeIdRef.current) return;
    const uploaded = ready.length ? await uploadThemeImages(ready, activeIdRef.current) : [];
    const urls = [...uploaded, ...extraUrls];
    if (!urls.length) return;
    editor.focus();
    enhanceRichInlineImages(editor);
    const inserted = insertImagesAtSlotOrCaret(
      editor,
      urls.map((src) => ({ src })),
      slotId,
    );
    if (inserted) {
      enhanceRichInlineImages(editor);
      commitActive();
    }
  }

  function runCommand(command: string, value?: string) {
    runCollectRichCommand(editorRef.current, command, value);
    commitActive();
  }

  function lookupThemes() {
    const keyword = themeLookup.trim().toLowerCase();
    if (!keyword) {
      setThemeLookupHits([]);
      setThemeLookupStatus("조회할 내용을 입력하세요.");
      return;
    }
    const hits = notes
      .filter((note) => `${note.title} ${plainSnippet(note.html, 4000)}`.toLowerCase().includes(keyword))
      .slice(0, 20)
      .map((note) => ({
        id: note.id,
        title: note.title || "새 테마",
        snippet: plainSnippet(note.html),
      }));
    setThemeLookupHits(hits);
    setThemeLookupStatus(hits.length ? `${hits.length}건` : "맞는 테마가 없습니다.");
  }

  function applyClass(label: string) {
    const editor = editorRef.current;
    if (!editor) return;
    appendHashtagToEditor(editor, label);
    commitActive();
  }

  const active = notes.find((note) => note.id === activeId);

  return (
    <section className="themeBoard">
      <div className="themeBoardHead">
        <button type="button" className="pill-btn" onClick={() => { void commitActive(draftTitle); onBack(); }}>📅 캘린더</button>
        <h1>테마</h1>
        <button type="button" className="pill-btn themeAddBtn" onClick={addTheme}>+ 테마</button>
      </div>
      <p className="themeBoardHint">일자별이 아니라 테마별로 작성합니다. 서식, 칸 추가, 이미지 추가는 일기장과 같습니다.</p>
      <EntryLookup
        placeholder="테마 내용 조회"
        query={themeLookup}
        onQuery={setThemeLookup}
        onSearch={lookupThemes}
        hits={themeLookupHits}
        status={themeLookupStatus}
        onOpen={switchTheme}
      />
      {!loaded ? <p className="themeBoardHint">테마를 불러오는 중…</p> : null}
      {remoteFailed ? (
        <p className="themeBoardHint" role="alert" style={{ color: "#c0392b" }}>
          서버에서 테마를 불러오지 못했습니다{notes.length ? " (이 기기에 있는 것만 표시 중)" : ""}.{" "}
          <button type="button" className="pill-btn compact-pill" onClick={() => { setLoaded(false); setReloadTick((tick) => tick + 1); }}>
            다시 시도
          </button>
        </p>
      ) : null}
      {(() => {
        const pinnedSet = new Set(pinnedIds);
        const byRecent = [...notes].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const pinned = byRecent.filter((note) => pinnedSet.has(note.id));
        const rest = byRecent.filter((note) => !pinnedSet.has(note.id));
        const chipNotes = [...pinned, ...rest.slice(0, Math.max(0, VISIBLE_THEME_CHIPS - pinned.length))];
        const activeNote = notes.find((note) => note.id === activeId);
        if (activeNote && !chipNotes.some((note) => note.id === activeNote.id)) chipNotes.push(activeNote);
        const renderDeleteConfirm = (note: ThemeNote) => (
          <>
            <span>{note.title || "새 테마"} 삭제할까요?</span>
            <button type="button" className="themeChipConfirm" onClick={() => removeTheme(note.id)}>삭제</button>
            <button type="button" onClick={() => setPendingDeleteId("")}>취소</button>
          </>
        );

        const query = themeListQuery.trim().toLowerCase();
        const listed = notes
          .filter((note) => !query || (note.title || "새 테마").toLowerCase().includes(query))
          .sort((a, b) => {
            const pin = Number(pinnedSet.has(b.id)) - Number(pinnedSet.has(a.id));
            if (pin) return pin;
            return themeListSort === "name"
              ? (a.title || "").localeCompare(b.title || "", "ko")
              : String(b.updatedAt).localeCompare(String(a.updatedAt));
          });

        return (
          <>
            <div className="themeChipRow" role="tablist" aria-label="테마 목록">
              {chipNotes.map((note) => {
                const title = note.title || "새 테마";
                const confirming = note.id === pendingDeleteId;
                const isPinned = pinnedSet.has(note.id);
                return (
                  <div key={note.id} className={`themeChip ${note.id === activeId ? "active" : ""} ${confirming ? "confirming" : ""}`}>
                    {confirming ? (
                      renderDeleteConfirm(note)
                    ) : (
                      <>
                        <button type="button" onClick={() => { setPendingDeleteId(""); switchTheme(note.id); }}>{title}</button>
                        <button
                          type="button"
                          className={`themePinBtn ${isPinned ? "is-pinned" : ""}`}
                          aria-label={isPinned ? `${title} 고정 해제` : `${title} 맨 앞에 고정`}
                          title={isPinned ? "고정 해제" : "맨 앞에 고정"}
                          onClick={() => togglePin(note.id)}
                        >
                          {isPinned ? "★" : "☆"}
                        </button>
                        <button type="button" aria-label={`${title} 삭제`} onClick={() => setPendingDeleteId(note.id)}>×</button>
                      </>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="themeShowAllBtn"
                aria-expanded={showAllThemes}
                onClick={() => setShowAllThemes((open) => !open)}
              >
                {showAllThemes ? "목록 접기 ▴" : `전체 ${notes.length}개 ▾`}
              </button>
            </div>
            {showAllThemes && (
              <div className="themeAllList">
                <div className="themeAllListTools">
                  <input
                    value={themeListQuery}
                    onChange={(event) => setThemeListQuery(event.target.value)}
                    placeholder="테마 이름 찾기"
                    aria-label="테마 이름 찾기"
                  />
                  <button type="button" className={themeListSort === "recent" ? "is-on" : ""} onClick={() => setThemeListSort("recent")}>최근순</button>
                  <button type="button" className={themeListSort === "name" ? "is-on" : ""} onClick={() => setThemeListSort("name")}>이름순</button>
                </div>
                <div className="themeAllListRows">
                  {listed.length === 0 ? <p className="themeAllListEmpty">맞는 테마가 없습니다.</p> : null}
                  {listed.map((note) => {
                    const title = note.title || "새 테마";
                    const isPinned = pinnedSet.has(note.id);
                    return (
                      <div key={note.id} className={`themeAllRow ${note.id === activeId ? "active" : ""}`}>
                        {note.id === pendingDeleteId ? (
                          renderDeleteConfirm(note)
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`themePinBtn ${isPinned ? "is-pinned" : ""}`}
                              aria-label={isPinned ? `${title} 고정 해제` : `${title} 맨 앞에 고정`}
                              onClick={() => togglePin(note.id)}
                            >
                              {isPinned ? "★" : "☆"}
                            </button>
                            <button
                              type="button"
                              className="themeAllRowTitle"
                              onClick={() => {
                                setPendingDeleteId("");
                                switchTheme(note.id);
                                setShowAllThemes(false);
                              }}
                            >
                              {title}
                            </button>
                            <span className="themeAllRowDate">{formatThemeDate(note.updatedAt)}</span>
                            <button type="button" className="themeAllRowDel" aria-label={`${title} 삭제`} onClick={() => setPendingDeleteId(note.id)}>×</button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {active && (
        <div className="generalInfoTextBox generalInfoRichTextBox themeEditorBox">
          <label className="themeTitleField">
            <span>테마 이름</span>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => commitActive(draftTitle)}
              placeholder="테마 이름"
            />
          </label>
          <div className="generalInfoRichTextHeader">
            <strong>Text 입력 / 편집</strong>
            <span>줄바꿈, 띄어쓰기, 글자색, 굵게, 밑줄, 형광, 크기 편집 가능</span>
          </div>
          <SaveStatusBar
            state={saveState?.state ?? null}
            at={saveState?.at ?? null}
            onSave={() => void commitActive(draftTitle)}
          />
          <CollectFormatToolbar
            onUndo={() => runCommand("undo")}
            onRedo={() => runCommand("redo")}
            onBold={() => runCommand("bold")}
            onUnderline={() => runCommand("underline")}
            onFontSize={(px) => {
              setFontSizePx(px);
              runCommand("fontSizePx", String(px));
            }}
            onFontSizeStep={(delta) => {
              const next = stepCollectFontSize(fontSizePx, delta);
              setFontSizePx(next);
              runCommand("fontSizePx", String(next));
            }}
            onColor={(color) => runCommand("foreColor", color)}
            onHighlight={(color) => runCommand("highlight", color)}
            onInsertChar={(ch) => runCommand("insertText", ch)}
            onImage={() => {
              // 빈 사진 칸이 없으면 커서 위치에 만든다 (s. 입력 없이도 사용 가능)
              const { slotId } = ensureImageSlot(editorRef.current);
              if (!slotId) {
                setImageSlotId(null);
                alert(IMAGE_SLOT_GUIDE);
                return;
              }
              pendingSlotRef.current = slotId;
              imageFileRef.current?.click();
            }}
            onPasteImage={() => {
              const { slotId, created } = ensureImageSlot(editorRef.current);
              if (!slotId) {
                setImageSlotId(null);
                alert(IMAGE_SLOT_GUIDE);
                return;
              }
              const dropCreatedSlot = () => {
                if (created) removeImageSlot(editorRef.current, slotId);
              };
              void readClipboardImageFiles().then((files) => {
                if (!files.length) {
                  dropCreatedSlot();
                  alert("클립보드에서 이미지를 찾지 못했습니다. 이미지를 복사한 뒤 다시 눌러 주세요.");
                  return;
                }
                void insertImages(files, slotId);
                setImageSlotId(null);
              }).catch(() => {
                dropCreatedSlot();
                alert("클립보드 읽기가 막혀 있습니다. 사진 칸의 붙여넣기 칸에 직접 붙여넣으세요.");
              });
            }}
            onTextImage={() => setShowTextImage(true)}
            onHandwriting={() => setShowHandwriting(true)}
          />
          <div className="collectFormatSlotRow">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const id = makeWhiteCellId();
                whiteHtmlRef.current[id] = "";
                // 커서가 있는 칸 바로 아래에 끼워 넣습니다(커서 위치를 모르면 맨 아래).
                const position = insertPositionForNewCell(whiteCellIds);
                setWhiteCellIds((prev) => [...prev.slice(0, position), id, ...prev.slice(position)]);
                window.setTimeout(() => commitActive(), 0);
              }}
            >
              ＋ 칸
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const id = removeTargetCellId(whiteCellIds);
                if (!id) {
                  alert("삭제할 칸이 없습니다.");
                  return;
                }
                const cell = document.querySelector(`[data-white-id="${id}"] .collect-white-cell`);
                const text = cell?.textContent?.replace(/\u00a0/g, " ").trim() || "";
                if (text && !window.confirm("이 칸을 지울까요?")) return;
                delete whiteHtmlRef.current[id];
                setWhiteCellIds((prev) => prev.filter((item) => item !== id));
                window.setTimeout(() => commitActive(), 0);
              }}
            >
              － 칸
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("removeFormat")}>
              서식 지우기
            </button>
          </div>
          <div className="classTagRow">
            <ClassTagSelect onSelect={applyClass} />
            <span>분류를 고르면 이 칸 본문에 #태그가 붙습니다. 본문에 직접 입력할 수도 있습니다.</span>
          </div>
          <input
            ref={imageFileRef}
            type="file"
            accept="image/*,.heic,.heif,.jpeg,.jpg,.png,.webp"
            multiple
            className="offscreen-file-input"
            onChange={(event) => {
              const list = Array.from(event.target.files || []);
              const slotId = pendingSlotRef.current;
              pendingSlotRef.current = null;
              event.target.value = "";
              if (list.length) void insertImages(list, slotId);
            }}
          />
          <div
            key={activeId}
            ref={editorRef}
            className="generalInfoRichTextEditor collectPaperEditor diaryPaperEditor"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            tabIndex={0}
            data-placeholder="이 테마의 기록을 남겨보세요...."
            onInput={() => {
              const editor = editorRef.current;
              if (!editor) return;
              tryConsumeDateTimeTrigger(editor);
              const slotId = tryConsumeImageTriggerToSlot(editor);
              if (slotId) {
                enhanceRichInlineImages(editor);
                setImageSlotId(slotId);
              } else if (!findAwaitingSlotId(editor)) {
                setImageSlotId(null);
              }
              commitActive();
            }}
            onKeyUp={() => {
              const editor = editorRef.current;
              if (!editor) return;
              const stamped = tryConsumeDateTimeTrigger(editor);
              const slotId = tryConsumeImageTriggerToSlot(editor);
              if (slotId) {
                enhanceRichInlineImages(editor);
                setImageSlotId(slotId);
                commitActive();
              } else if (stamped) {
                commitActive();
              }
            }}
            onBlur={() => commitActive()}
            onClick={(event) => {
              const editor = editorRef.current;
              if (!editor) return;
              const target = event.target as HTMLElement;
              if (removeClassCellFromEvent(editor, target)) {
                event.preventDefault();
                commitActive();
                return;
              }
              if (handleRichImageSlotPointer(editor, target)) {
                event.preventDefault();
                if (!findAwaitingSlotId(editor)) setImageSlotId(null);
                commitActive();
                return;
              }
              if (!target.closest(".rich-inline-img-del, .generalInfoInlineImageRemove, .rich-img-slot-del")) {
                editor.querySelectorAll(".is-image-selected").forEach((node) => node.classList.remove("is-image-selected"));
                const media = target.closest("img, video");
                if (media && editor.contains(media)) {
                  if (media.tagName === "IMG") enhanceRichInlineImages(editor);
                  const wrap = media.closest(".rich-inline-img-wrap, .generalInfoInlineImageBlock");
                  (wrap || media).classList.add("is-image-selected");
                }
              }
              const slot = target.closest?.(".rich-img-slot") as HTMLElement | null;
              if (!slot || !editor.contains(slot) || slot.classList.contains("rich-inline-img-wrap") || slot.querySelector("img")) return;
              const slotId = slot.getAttribute("data-img-slot");
              if (!slotId) return;
              event.preventDefault();
              // 사진찍기 · 사진보관함 · 붙여넣기 중에서 고르는 창을 띄운다
              setImageSlotId(slotId);
            }}
            onPaste={(event) => {
              event.preventDefault();
              const clip = readPastedClipboard(event.clipboardData);
              if (clip.text) document.execCommand("insertText", false, clip.text);
              commitActive();
              pasteClipboardImages(
                editorRef.current,
                clip,
                (files, slotId, urls) => insertImages(files, slotId, urls),
                () => alert(PASTE_IMAGE_FAILED_MESSAGE),
              );
              setImageSlotId(null);
            }}
          />
          {whiteCellIds.map((id, cellIndex) => (
            <CollectWhiteCell
              key={id}
              cellId={id}
              onMove={(direction) => {
                const moved = moveWhiteCell(whiteCellIds, id, direction, editorRef.current);
                if (!moved) return;
                if ("ids" in moved) setWhiteCellIds(moved.ids);
                window.setTimeout(() => commitActive(), 0);
              }}
              canMoveDown={cellIndex < whiteCellIds.length - 1}
              initialHtml={whiteHtmlRef.current[id] || ""}
              placeholder="이 테마의 기록을 남겨보세요...."
              imageDeleteOnly
              showClassTag
              onUploadImages={(files) => uploadThemeImages(files, activeIdRef.current)}
              onInput={() => commitActive()}
              onRemove={() => {
                const cell = document.querySelector(`[data-white-id="${id}"] .collect-white-cell`);
                const text = cell?.textContent?.replace(/\u00a0/g, " ").trim() || "";
                if (text && !window.confirm("이 칸을 지울까요?")) return;
                delete whiteHtmlRef.current[id];
                setWhiteCellIds((prev) => prev.filter((item) => item !== id));
                window.setTimeout(() => commitActive(), 0);
              }}
            />
          ))}
          {imageSlotId ? (
            <SlotImagePanel
              onFiles={(files) => {
                void insertImages(files, imageSlotId);
                setImageSlotId(null);
              }}
              onClose={() => setImageSlotId(null)}
            />
          ) : null}
        </div>
      )}

      {showHandwriting && (
        <HandwritingModal
          onCancel={() => setShowHandwriting(false)}
          onInsert={(dataUrl) => {
            const editor = editorRef.current;
            if (editor && dataUrl) {
              editor.focus();
              enhanceRichInlineImages(editor);
              if (insertImagesAtSlotOrCaret(editor, [{ src: dataUrl }])) {
                enhanceRichInlineImages(editor);
                commitActive();
              }
            }
            setShowHandwriting(false);
          }}
        />
      )}
      {showTextImage && (
        <TextToImageModal
          initialText={String(editorRef.current?.innerText || "").slice(0, 800)}
          onCancel={() => setShowTextImage(false)}
          onInsert={(dataUrl) => {
            const editor = editorRef.current;
            if (editor && dataUrl) {
              editor.focus();
              enhanceRichInlineImages(editor);
              if (insertImagesAtSlotOrCaret(editor, [{ src: dataUrl }])) {
                enhanceRichInlineImages(editor);
                commitActive();
              }
            }
            setShowTextImage(false);
          }}
        />
      )}
    </section>
  );
}
