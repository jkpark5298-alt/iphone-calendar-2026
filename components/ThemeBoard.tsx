"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CollectFormatToolbar } from "./CollectFormatToolbar";
import { CollectWhiteCell } from "./CollectWhiteCell";
import { SlotImagePanel } from "./SlotImagePanel";
import { ClassTagSelect } from "./ClassTagSelect";
import { EntryLookup, plainSnippet, type LookupHit } from "./EntryLookup";
import { HandwritingModal } from "./HandwritingModal";
import { TextToImageModal } from "./TextToImageModal";
import { appendHashtagToEditor } from "../lib/contentClass";
import { stepCollectFontSize } from "../lib/collectFormatPalette";
import { readClipboardImageFiles, runCollectRichCommand } from "../lib/collectRichFormat";
import { makeWhiteCellId, readStackedHtml, removeClassCellFromEvent, splitWhiteCells } from "../lib/collectClassCell";
import {
  IMAGE_SLOT_GUIDE,
  enhanceRichInlineImages,
  findAwaitingSlotId,
  handleRichImageSlotPointer,
  insertImagesAtSlotOrCaret,
  tryConsumeImageTriggerToSlot,
  tryConsumeDateTimeTrigger,
} from "../lib/richImageSlots";
import { compressImageFile, filterUploadImageFiles, imageFilesFromClipboard } from "../lib/compressImageFile";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import {
  createThemeNote,
  deleteThemeNote,
  loadThemeNotes,
  persistThemes,
  type ThemeNote,
} from "../lib/themeNotes";

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
  const [themeLookup, setThemeLookup] = useState("");
  const [themeLookupHits, setThemeLookupHits] = useState<LookupHit[]>([]);
  const [themeLookupStatus, setThemeLookupStatus] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState("");

  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const pendingSlotRef = useRef<string | null>(null);
  const whiteHtmlRef = useRef<Record<string, string>>({});
  const notesRef = useRef<ThemeNote[]>([]);
  const activeIdRef = useRef("");
  const readyRef = useRef(false);
  const appliedIdRef = useRef("");

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    let alive = true;
    void loadThemeNotes().then((items) => {
      if (!alive) return;
      const next = items.length ? items : [createThemeNote("새 테마")];
      if (!items.length) void persistThemes(next, next[0].id);
      const focus = next.find((note) => note.id === initialThemeId) || next[0];
      setNotes(next);
      setActiveId(focus.id);
      setDraftTitle(focus.title);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [initialThemeId]);

  function commitActive(nextTitle?: string) {
    if (!readyRef.current) return;
    const id = activeIdRef.current;
    const editor = editorRef.current;
    if (!id || !editor) return;
    const html = readStackedHtml(editor);
    const title = (nextTitle ?? draftTitle).trim() || "새 테마";
    const updatedAt = new Date().toISOString();
    const next = notesRef.current.map((note) =>
      note.id === id ? { ...note, title, html, updatedAt } : note,
    );
    notesRef.current = next;
    setNotes(next);
    void persistThemes(next, id);
  }

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
    void persistThemes(next, note.id);
    readyRef.current = false;
    appliedIdRef.current = "";
    setDraftTitle(note.title);
    setActiveId(note.id);
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

  async function insertImages(files: File[], slotId?: string | null) {
    const editor = editorRef.current;
    const ready = filterUploadImageFiles(files);
    if (!editor || !ready.length || !activeIdRef.current) return;
    const urls = await uploadThemeImages(ready, activeIdRef.current);
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
        <button type="button" className="pill-btn" onClick={onBack}>📅 캘린더</button>
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
      <div className="themeChipRow" role="tablist" aria-label="테마 목록">
        {notes.map((note) => {
          const title = note.title || "새 테마";
          const confirming = note.id === pendingDeleteId;
          return (
            <div key={note.id} className={`themeChip ${note.id === activeId ? "active" : ""} ${confirming ? "confirming" : ""}`}>
              {confirming ? (
                <>
                  <span>{title} 삭제할까요?</span>
                  <button type="button" className="themeChipConfirm" onClick={() => removeTheme(note.id)}>삭제</button>
                  <button type="button" onClick={() => setPendingDeleteId("")}>취소</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => { setPendingDeleteId(""); switchTheme(note.id); }}>{title}</button>
                  <button type="button" aria-label={`${title} 삭제`} onClick={() => setPendingDeleteId(note.id)}>×</button>
                </>
              )}
            </div>
          );
        })}
      </div>

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
              const slotId = findAwaitingSlotId(editorRef.current);
              if (!slotId) {
                setImageSlotId(null);
                alert(IMAGE_SLOT_GUIDE);
                return;
              }
              pendingSlotRef.current = slotId;
              imageFileRef.current?.click();
            }}
            onPasteImage={() => {
              const slotId = findAwaitingSlotId(editorRef.current);
              if (!slotId) {
                setImageSlotId(null);
                alert(IMAGE_SLOT_GUIDE);
                return;
              }
              void readClipboardImageFiles().then((files) => {
                if (!files.length) {
                  alert("클립보드에서 이미지를 찾지 못했습니다. 사진 칸에 붙여넣으세요.");
                  return;
                }
                void insertImages(files, slotId);
                setImageSlotId(null);
              }).catch(() => {
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
                setWhiteCellIds((prev) => [...prev, id]);
                window.setTimeout(() => commitActive(), 0);
              }}
            >
              ＋ 칸
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const id = whiteCellIds[whiteCellIds.length - 1];
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
              if (!slotId || !imageFileRef.current) return;
              event.preventDefault();
              pendingSlotRef.current = slotId;
              imageFileRef.current.click();
            }}
            onPaste={(event) => {
              const pastedFiles = imageFilesFromClipboard(event.clipboardData);
              if (pastedFiles.length > 0) {
                event.preventDefault();
                const slotId = findAwaitingSlotId(editorRef.current);
                if (!slotId) {
                  setImageSlotId(null);
                  alert(IMAGE_SLOT_GUIDE);
                  return;
                }
                void insertImages(pastedFiles, slotId);
                setImageSlotId(null);
                return;
              }
              event.preventDefault();
              const pasteText = event.clipboardData.getData("text/plain");
              if (pasteText) document.execCommand("insertText", false, pasteText);
              commitActive();
            }}
          />
          {whiteCellIds.map((id) => (
            <CollectWhiteCell
              key={id}
              cellId={id}
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
