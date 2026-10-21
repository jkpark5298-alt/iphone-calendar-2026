"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SavedTravelAlbum } from "../utils/chapter3SavedAlbumUtils";
import {
  albumsAreSameFamily,
  countAlbumPhotos,
  formatAlbumCreatedDate,
  getAlbumDateRangeText,
  searchSavedAlbums,
  sortAlbumsByRecent,
} from "../utils/chapter3SavedAlbumUtils";
import { openTravelAlbumPdfWindow } from "../utils/albumPdfUtils";
import { canSaveAlbumPcBackup, formatAlbumBackupHint } from "../utils/albumFullBackupUtils";
import { photoDisplayUrl } from "../utils/chapter3AlbumSyncUtils";
import { Chapter3AlbumFullscreenViewer } from "./Chapter3AlbumFullscreenViewer";
import { EmptyState } from "./SharedComponents";

export type AlbumListVariant = "saved" | "draft";

export function Chapter3SavedAlbumList({
  variant,
  albums,
  draftAlbums = [],
  deletedAlbums,
  syncStatus,
  storageStatus,
  maxVisible,
  enableGroupBy = false,
  emptyMessage,
  onEdit,
  onResume,
  onDelete,
  onRestore,
  onRestoreAll,
  onUpdateTitle,
  onUpdatePhotoMemo,
  onSharePdf,
  onSaveFullBackup,
  onSaveAllFullBackup,
}: {
  variant: AlbumListVariant;
  albums: SavedTravelAlbum[];
  /** 확정 앨범에서 임시본이 있는 항목을 「수정 중」으로 표시할 때 사용 */
  draftAlbums?: SavedTravelAlbum[];
  deletedAlbums?: SavedTravelAlbum[];
  syncStatus: string;
  storageStatus?: string | null;
  maxVisible?: number;
  /** 개인 앨범 — 보기에서 일자/년도/장소 구분 */
  enableGroupBy?: boolean;
  emptyMessage?: string;
  onEdit?: (album: SavedTravelAlbum) => void;
  onResume?: (album: SavedTravelAlbum) => void;
  onDelete: (id: string) => void;
  onRestore?: (id: string) => void;
  onRestoreAll?: () => void;
  onUpdateTitle?: (id: string, title: string) => void;
  onUpdatePhotoMemo?: (albumId: string, photoId: string, memo: string) => void;
  onSharePdf?: (album: SavedTravelAlbum) => void | Promise<void>;
  onSaveFullBackup?: (
    album: SavedTravelAlbum,
    onProgress: (done: number, total: number) => void,
  ) => Promise<void>;
  onSaveAllFullBackup?: (
    albums: SavedTravelAlbum[],
    onProgress: (done: number, total: number, albumTitle?: string) => void,
  ) => Promise<void>;
}) {
  const [driveState, setDriveState] = useState<"unknown" | "connected" | "broken" | "needed">("needed");
  const [searchTerm, setSearchTerm] = useState("");
  const [showPcBackup, setShowPcBackup] = useState(false);
  const [packBusy, setPackBusy] = useState<{
    id: string;
    mode: "full" | "all";
    done: number;
    total: number;
    albumTitle?: string;
  } | null>(null);

  useEffect(() => {
    setShowPcBackup(canSaveAlbumPcBackup());
  }, []);

  useEffect(() => {
    if (variant !== "saved") return;
    let cancelled = false;
    void fetch("/api/google-drive/status")
      .then((response) => response.json() as Promise<{ connected?: boolean; healthy?: boolean }>)
      .then((status) => {
        if (cancelled) return;
        if (status.connected && status.healthy === false) setDriveState("broken");
        else setDriveState(status.connected ? "connected" : "needed");
      })
      .catch(() => {
        if (!cancelled) setDriveState("needed");
      });
    return () => {
      cancelled = true;
    };
  }, [variant]);
  const [deletedSectionOpen, setDeletedSectionOpen] = useState(false);
  const [selectedDeletedId, setSelectedDeletedId] = useState<string | null>(null);
  const [viewerStartPhotoId, setViewerStartPhotoId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const [viewerAlbumId, setViewerAlbumId] = useState<string | null>(null);

  const startFullBackup = (album: SavedTravelAlbum) => {
    if (!onSaveFullBackup || packBusy) return;
    setPackBusy({ id: album.id, mode: "full", done: 0, total: 0 });
    void onSaveFullBackup(album, (done, total) => {
      setPackBusy({ id: album.id, mode: "full", done, total });
    }).finally(() => setPackBusy(null));
  };

  const startAllFullBackup = () => {
    if (!onSaveAllFullBackup || packBusy) return;
    const targets = visibleAlbums.filter((album) => countAlbumPhotos(album.days) > 0);
    if (targets.length === 0) {
      window.alert("백업할 사진이 있는 앨범이 없습니다.");
      return;
    }
    if (
      !window.confirm(
        `표시 중인 앨범 ${targets.length}개를 PC 완전 백업할까요?\n사진이 하나라도 빠지면 파일을 만들지 않습니다.`,
      )
    ) {
      return;
    }
    setPackBusy({ id: "__all__", mode: "all", done: 0, total: 0 });
    void onSaveAllFullBackup(targets, (done, total, albumTitle) => {
      setPackBusy({ id: "__all__", mode: "all", done, total, albumTitle });
    }).finally(() => setPackBusy(null));
  };

  const packButtonLabel = (albumId: string, mode: "full", idle: string) => {
    if (packBusy?.id !== albumId || packBusy.mode !== mode) return idle;
    if (packBusy.total <= 0) return "준비…";
    return `백업 ${packBusy.done}/${packBusy.total}`;
  };

  const title = variant === "saved" ? "확정 앨범" : "작업 중";
  const emptyText =
    emptyMessage ||
    (variant === "saved"
      ? enableGroupBy
        ? "확정된 개인앨범이 없습니다. 「새 앨범」에서 작성 후 「확정」을 눌러 주세요."
        : "확정된 여행 앨범이 없습니다. 「새 앨범」에서 작성 후 「확정」을 눌러 주세요."
      : "작업 중 앨범이 없습니다. 편집 중 「작업 중 저장」을 누르거나, 확정 앨범에서 「수정」을 시작하면 여기에 표시됩니다.");

  const viewerAlbum = useMemo(
    () => albums.find((album) => album.id === viewerAlbumId) || null,
    [albums, viewerAlbumId],
  );

  const visibleAlbums = useMemo(() => {
    const filtered = searchSavedAlbums(albums, searchTerm);
    const sorted = sortAlbumsByRecent(filtered);
    if (variant === "saved" && maxVisible && !searchTerm.trim()) {
      return sorted.slice(0, maxVisible);
    }
    return sorted;
  }, [albums, searchTerm, variant, maxVisible]);

  const handlePdf = async (album: SavedTravelAlbum) => {
    setPdfBusyId(album.id);
    try {
      if (onSharePdf) {
        await Promise.resolve(onSharePdf(album));
        return;
      }
      const ok = await openTravelAlbumPdfWindow(album);
      if (!ok) {
        window.alert("PDF를 만들지 못했습니다. 팝업 차단을 해제한 뒤 다시 시도해 주세요.");
      }
    } catch (error) {
      console.error("album PDF failed", error);
      window.alert("PDF 작성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPdfBusyId(null);
    }
  };

  return (
    <div className="chapter3SavedAlbumList">
      <div className="chapter3SavedAlbumListHeader">
        <div>
          <h3>{title}</h3>
          <p className="chapter3Muted">{syncStatus}</p>
          {storageStatus && <p className="chapter3Muted">{storageStatus}</p>}
          {variant === "saved" && driveState === "connected" && (
            <p className="chapter3Muted">Google Drive 연결됨</p>
          )}
          {variant === "saved" && driveState === "broken" && (
            <p className="chapter3Muted" role="alert">
              ⚠️ Google Drive 연결이 끊겼습니다. 새 앨범 탭에서 다시 연결해 주세요.
            </p>
          )}
          {variant === "saved" && !searchTerm.trim() && maxVisible && albums.length > maxVisible && (
            <p className="chapter3AlbumListHint">
              최신 {maxVisible}개만 표시합니다. 제목·여행일자·여행지로 검색하면 전체를 볼 수 있습니다.
            </p>
          )}
        </div>
        <div className="chapter3AlbumListHeaderActions">
          {variant === "saved" && showPcBackup && onSaveAllFullBackup && (
            <button
              type="button"
              className="secondaryButton"
              disabled={Boolean(packBusy) || albums.length === 0}
              title="PC에만 저장됩니다. 사진이 100%일 때만 zip을 만듭니다."
              onClick={startAllFullBackup}
            >
              {packBusy?.mode === "all"
                ? packBusy.total <= 0
                  ? "전체 백업 준비…"
                  : `${packBusy.albumTitle || "백업"} ${packBusy.done}/${packBusy.total}`
                : "전체 PC 백업"}
            </button>
          )}
          <div className="searchBox">
            <span>🔎</span>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={
                enableGroupBy ? "제목·일자·장소로 검색" : "제목·여행일자·여행지로 검색"
              }
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm("")}>
                초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {visibleAlbums.length === 0 ? (
        <EmptyState
          icon="📷"
          text={searchTerm ? "검색 조건에 맞는 앨범이 없습니다." : emptyText}
        />
      ) : (
        <div className="bundleList chapter3AlbumBundleList">
          {visibleAlbums.map((album) => {
            const photoCount = countAlbumPhotos(album.days);
            const firstPhoto = album.days
              .flatMap((d) => d.places.flatMap((p) => p.photos))
              .find((p) => photoDisplayUrl(p));
            const isTitleEditing = editingId === album.id;
            const isEditingInDraft =
              variant === "saved" &&
              draftAlbums.some(
                (draft) =>
                  draft.originAlbumId === album.id ||
                  (draft.sourcePlanId &&
                    album.sourcePlanId &&
                    draft.sourcePlanId === album.sourcePlanId) ||
                  albumsAreSameFamily(draft, album),
              );

            return (
              <article className="bundleCard compact chapter3SavedAlbumCard" key={album.id}>
                {firstPhoto && (
                  <div className="bundleThumbnail" aria-hidden="true">
                    <img
                      src={photoDisplayUrl(firstPhoto)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}
                <div className="bundleCompactInfo chapter3AlbumListMeta">
                  {isTitleEditing ? (
                    <input
                      className="chapter3SavedAlbumTitleInput"
                      value={editTitle}
                      autoFocus
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && onUpdateTitle) {
                          onUpdateTitle(album.id, editTitle);
                          setEditingId(null);
                        }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <p className="chapter3AlbumListTitle">
                      {album.title}
                      {isEditingInDraft && (
                        <span className="chapter3AlbumEditingBadge" aria-label="수정 중">
                          {" "}
                          수정 중
                        </span>
                      )}
                    </p>
                  )}
                  <p className="chapter3AlbumListTravelDate">
                    {enableGroupBy || album.kind === "personal" ? "기간" : "여행"}{" "}
                    {getAlbumDateRangeText(album.days)}
                  </p>
                  <p className="chapter3AlbumListCreatedDate">
                    작성 {formatAlbumCreatedDate(album.createdAt)} · {album.days.length}일 ·{" "}
                    {photoCount}장
                  </p>
                </div>
                <div className="chapter3SavedAlbumActions">
                  <button
                    type="button"
                    className={`secondaryButton chapter3AlbumViewerButton${
                      variant === "saved" ? " chapter3AlbumConfirmViewButton" : ""
                    }`}
                    disabled={photoCount === 0}
                    onClick={() => {
                      setViewerStartPhotoId(null);
                      setViewerAlbumId(album.id);
                    }}
                  >
                    앨범
                  </button>
                  {variant === "saved" && onEdit && (
                    <button type="button" className="secondaryButton" onClick={() => onEdit(album)}>
                      수정
                    </button>
                  )}
                  {variant === "draft" && onResume && (
                    <button type="button" className="secondaryButton" onClick={() => onResume(album)}>
                      이어하기
                    </button>
                  )}
                  {onUpdateTitle &&
                    (isTitleEditing ? (
                      <button
                        type="button"
                        className="secondaryButton"
                        onClick={() => {
                          onUpdateTitle(album.id, editTitle);
                          setEditingId(null);
                        }}
                      >
                        제목 저장
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondaryButton"
                        onClick={() => {
                          setEditingId(album.id);
                          setEditTitle(album.title);
                        }}
                      >
                        제목
                      </button>
                    ))}
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={pdfBusyId === album.id}
                    onClick={() => void handlePdf(album)}
                  >
                    {pdfBusyId === album.id ? "PDF…" : "PDF"}
                  </button>
                  {variant === "saved" && showPcBackup && onSaveFullBackup && (
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={photoCount === 0 || Boolean(packBusy)}
                      title="앨범 기록+사진을 PC zip으로 저장합니다. 100% 성공 시에만 파일이 만들어집니다."
                      onClick={() => startFullBackup(album)}
                    >
                      {packButtonLabel(album.id, "full", "PC 완전 백업")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondaryButton"
                    style={{ color: "#ef4444" }}
                    onClick={() => {
                      const backupHint =
                        variant === "saved" && photoCount > 0
                          ? `\n\n${formatAlbumBackupHint(album)}\n삭제 전에 「PC 완전 백업」을 받아 두세요.`
                          : "";
                      if (
                        window.confirm(
                          `「${album.title}」 앨범을 삭제할까요?${backupHint}`,
                        )
                      ) {
                        onDelete(album.id);
                        if (viewerAlbumId === album.id) setViewerAlbumId(null);
                      }
                    }}
                  >
                    삭제
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {viewerAlbum && (
        <Chapter3AlbumFullscreenViewer
          key={`${viewerAlbum.id}:${viewerStartPhotoId ?? "start"}`}
          album={viewerAlbum}
          startPhotoId={viewerStartPhotoId ?? undefined}
          enableYearFilter={enableGroupBy}
          onClose={() => {
            setViewerAlbumId(null);
            setViewerStartPhotoId(null);
          }}
          onUpdateMemo={
            onUpdatePhotoMemo
              ? (photoId, memo) => onUpdatePhotoMemo(viewerAlbum.id, photoId, memo)
              : undefined
          }
        />
      )}

      {variant === "saved" && onRestore && (deletedAlbums?.length || 0) > 0 && (
        <section className="chapter3AlbumDeletedBox">
          <div className="chapter3AlbumDeletedHeader">
            <button
              type="button"
              className={
                deletedSectionOpen
                  ? "chapter3AlbumDeletedToggle active"
                  : "chapter3AlbumDeletedToggle"
              }
              aria-expanded={deletedSectionOpen}
              onClick={() => {
                setDeletedSectionOpen((open) => {
                  if (open) setSelectedDeletedId(null);
                  return !open;
                });
              }}
            >
              <span>
                최근 삭제된 앨범 ({deletedAlbums!.length})
              </span>
              <span className="chapter3AlbumDeletedToggleHint">
                {deletedSectionOpen ? "접기" : "열기"}
              </span>
            </button>
            {deletedSectionOpen && onRestoreAll && (
              <button type="button" className="secondaryButton" onClick={onRestoreAll}>
                전체 복원
              </button>
            )}
          </div>
          {deletedSectionOpen ? (
            <>
              <p className="chapter3Muted chapter3AlbumDeletedHelp">
                항목을 누르면 제목·상세·복원이 열립니다.
              </p>
              <ul className="chapter3AlbumDeletedList">
                {deletedAlbums!.slice(0, 8).map((album, index) => {
                  const selected = selectedDeletedId === album.id;
                  const photoCount = countAlbumPhotos(album.days);
                  return (
                    <li key={album.id} className="chapter3AlbumDeletedItem">
                      <button
                        type="button"
                        className={
                          selected
                            ? "chapter3AlbumDeletedSelect active"
                            : "chapter3AlbumDeletedSelect"
                        }
                        aria-expanded={selected}
                        onClick={() => setSelectedDeletedId(selected ? null : album.id)}
                      >
                        <span className="chapter3AlbumDeletedTitle">
                          {selected ? album.title : `삭제된 앨범 ${index + 1}`}
                        </span>
                      </button>
                      {selected ? (
                        <div className="chapter3AlbumDeletedDetail">
                          <p>
                            {enableGroupBy || album.kind === "personal" ? "기간" : "여행"}{" "}
                            {getAlbumDateRangeText(album.days)} · {album.days.length}일 · 사진{" "}
                            {photoCount}장
                          </p>
                          <p>
                            {album.deletedAt
                              ? `삭제 ${new Date(album.deletedAt).toLocaleString("ko-KR")}`
                              : "삭제 시각 없음"}
                          </p>
                          <button
                            type="button"
                            className="secondaryButton"
                            onClick={() => onRestore(album.id)}
                          >
                            복원
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
