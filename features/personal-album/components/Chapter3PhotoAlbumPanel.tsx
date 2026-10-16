"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Chapter3AlbumPhoto } from "../utils/chapter3Utils";
import type { useTravelDiaryChapter3State } from "../hooks/useTravelDiaryChapter3State";
import { isDomesticPhotoLocation, isGpsCoordinateLabel, getPhotoExifPlaceName } from "../utils/exifUtils";
import { sortAlbumPhotos } from "../utils/albumPhotoOrderUtils";
import { useAlbumPhotoPointerReorder } from "../hooks/useAlbumPhotoPointerReorder";
import { geocodePhotoAddress } from "../utils/photoAddressGeocodeUtils";
import { photoDisplayUrl } from "../utils/chapter3AlbumSyncUtils";
import { Chapter3PhotoRouteMap } from "./Chapter3PhotoRouteMap";
import { PhotoZoomModal } from "./PhotoZoomModal";

type AlbumState = Pick<
  ReturnType<typeof useTravelDiaryChapter3State>,
  | "addPhotosToPlace"
  | "addPhotosFromClipboard"
  | "updatePhotoMemo"
  | "updatePhotoExifPlaceName"
  | "updatePhotoLocation"
  | "updatePhotoMemoInDay"
  | "updatePhotoExifPlaceNameInDay"
  | "resolvePhotoPlaceFromGps"
  | "removePhoto"
  | "reorderAlbumPhotos"
>;

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
}

export function getPhotoExifPlace(photo: Chapter3AlbumPhoto): string {
  return getPhotoExifPlaceName(photo);
}

function isPlaceResolving(photo: Chapter3AlbumPhoto): boolean {
  if (photo.exifPlaceEdited) return false;
  if (typeof photo.exifLat !== "number" || typeof photo.exifLng !== "number") return false;
  const raw = photo.exifPlaceName?.trim() || "";
  if (!raw) return true;
  if (isGpsCoordinateLabel(raw)) return true;
  if (/사진 앨범$/.test(raw)) return true;
  return false;
}

function PhotoTile({
  photo,
  day,
  placeId,
  albumState,
  selected,
  onSelect,
  reorderable,
  dragging,
  dragOver,
  pointerProps,
  handleProps,
  shouldIgnoreClick,
  regionHint,
}: {
  photo: Chapter3AlbumPhoto;
  day: number;
  placeId: string;
  albumState: AlbumState;
  selected: boolean;
  onSelect: () => void;
  reorderable: boolean;
  dragging: boolean;
  dragOver: boolean;
  pointerProps: React.HTMLAttributes<HTMLDivElement>;
  handleProps: React.HTMLAttributes<HTMLButtonElement>;
  shouldIgnoreClick: () => boolean;
  regionHint?: string;
}) {
  const placeValue = getPhotoExifPlace(photo);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [addressDraft, setAddressDraft] = useState(placeValue);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "error">("idle");
  const [memoDraft, setMemoDraft] = useState(photo.memo || "");
  const memoTimerRef = useRef<number | null>(null);
  const hasGps = typeof photo.exifLat === "number" && typeof photo.exifLng === "number";
  const resolving = isPlaceResolving(photo);

  useEffect(() => {
    setAddressDraft(placeValue);
  }, [placeValue]);

  useEffect(() => {
    setMemoDraft(photo.memo || "");
  }, [photo.id, photo.memo]);

  useEffect(() => {
    return () => {
      if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasGps || photo.exifPlaceEdited) return;
    if (placeValue && !/사진 앨범$/.test(photo.exifPlaceName || "")) return;
    void albumState.resolvePhotoPlaceFromGps(day, placeId, photo.id);
  }, [
    hasGps,
    placeValue,
    photo.exifPlaceEdited,
    photo.exifPlaceName,
    photo.id,
    day,
    placeId,
    albumState,
  ]);

  const persistPlaceName = (value: string) => {
    albumState.updatePhotoExifPlaceName(day, placeId, photo.id, value);
  };

  const persistMemo = (value: string) => {
    if (value === (photo.memo || "")) return;
    albumState.updatePhotoMemo(day, placeId, photo.id, value);
  };

  const scheduleMemoPersist = (value: string) => {
    if (memoTimerRef.current != null) window.clearTimeout(memoTimerRef.current);
    memoTimerRef.current = window.setTimeout(() => {
      memoTimerRef.current = null;
      persistMemo(value);
    }, 350);
  };

  const applyAddressToMap = async () => {
    const query = addressDraft.trim();
    if (!query) return;
    // 지오코딩 성공 여부와 무관하게 입력 주소는 앨범에 남김 (앱 재진입 시 소실 방지)
    persistPlaceName(query);
    setGeoStatus("loading");
    const hit = await geocodePhotoAddress(query, regionHint);
    if (!hit) {
      setGeoStatus("error");
      return;
    }
    albumState.updatePhotoLocation(day, placeId, photo.id, {
      lat: hit.lat,
      lng: hit.lng,
      placeName: query,
    });
    setGeoStatus("idle");
  };

  return (
    <div
      className={`chapter3PhotoTile${selected ? " selected" : ""}${reorderable ? " reorderable" : ""}${
        dragging ? " dragging" : ""
      }${dragOver ? " dragOver" : ""}`}
      {...pointerProps}
    >
      {reorderable && (
        <button
          type="button"
          className="chapter3PhotoReorderBadge"
          aria-label="끌어 순서 변경"
          {...handleProps}
        >
          ⇅
        </button>
      )}
      <button
        type="button"
        className="chapter3PhotoTileBtn"
        onClick={() => {
          if (shouldIgnoreClick()) return;
          onSelect();
        }}
        aria-pressed={selected}
      >
        <img src={photoDisplayUrl(photo)} alt={photo.fileName || "여행 사진"} draggable={false} />
      </button>
      <button
        type="button"
        className="chapter3PhotoZoomBtn"
        aria-label="사진 확대"
        onClick={(e) => {
          e.stopPropagation();
          setZoomOpen(true);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        🔍
      </button>
      <PhotoZoomModal
        src={photoDisplayUrl(photo)}
        alt={photo.fileName || "여행 사진"}
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
      />

      <div className="chapter3PhotoTileCaption">
        {selected && (
          <label className="chapter3PhotoTileField">
            <span className="chapter3PhotoTileFieldLabel">메모</span>
            <input
              type="text"
              className="chapter3PhotoTileMemoInput"
              value={memoDraft}
              placeholder="사진 메모 (예: 공항 도착)"
              onPointerDown={(e) => e.stopPropagation()}
              onPaste={(e) => e.stopPropagation()}
              onCopy={(e) => e.stopPropagation()}
              onCut={(e) => e.stopPropagation()}
              onChange={(e) => {
                const value = e.target.value;
                setMemoDraft(value);
                scheduleMemoPersist(value);
              }}
              onBlur={() => {
                if (memoTimerRef.current != null) {
                  window.clearTimeout(memoTimerRef.current);
                  memoTimerRef.current = null;
                }
                persistMemo(memoDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </label>
        )}

        {photo.exifDateTime ? (
          <div className="chapter3PhotoTileExifMeta">
            <span>📅 {photo.exifDateTime}</span>
          </div>
        ) : (
          <div className="chapter3PhotoTileExifMeta chapter3PhotoTileNoDate">
            <span>📅 촬영 시각 없음 · 노란 ⇅으로 순서 변경</span>
          </div>
        )}

        <label className="chapter3PhotoTileField">
          <span className="chapter3PhotoTileFieldLabel">
            {hasGps
              ? resolving
                ? "촬영 위치 (GPS→지명 변환 중…)"
                : "촬영 위치 (지도 표시)"
              : "촬영 위치 (주소 입력 → 지도 표시)"}
          </span>
          <input
            type="text"
            className="chapter3PhotoTilePlaceInput"
            value={hasGps ? placeValue : addressDraft || placeValue}
            placeholder={
              hasGps
                ? resolving
                  ? "EXIF GPS를 지명으로 변환 중…"
                  : "촬영 지명 (직접 수정 가능)"
                : "도로명·지번 주소 (예: 조천리 2725-5)"
            }
            onPointerDown={(e) => e.stopPropagation()}
            onPaste={(e) => e.stopPropagation()}
            onCopy={(e) => e.stopPropagation()}
            onCut={(e) => e.stopPropagation()}
            onChange={(e) => {
              const next = e.target.value;
              setGeoStatus("idle");
              setAddressDraft(next);
              // GPS 유무와 관계없이 입력값을 앨범에 즉시 저장
              persistPlaceName(next);
            }}
            onBlur={() => {
              const query = addressDraft.trim();
              if (!query || hasGps) return;
              persistPlaceName(query);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!hasGps) void applyAddressToMap();
              }
            }}
          />
        </label>
        {!hasGps && (
          <button
            type="button"
            className="chapter3PhotoTileMapBtn"
            disabled={geoStatus === "loading" || !addressDraft.trim()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void applyAddressToMap()}
          >
            {geoStatus === "loading" ? "찾는 중…" : "지도에 표시"}
          </button>
        )}
        {geoStatus === "error" && (
          <p className="chapter3PhotoTileGeoError">
            주소를 찾지 못했습니다. 지번 예: 제주시 조천읍 조천리 2725-5
          </p>
        )}

        <button
          type="button"
          className="chapter3PhotoTileDelete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => albumState.removePhoto(day, placeId, photo.id)}
        >
          삭제
        </button>
      </div>
    </div>
  );
}

export function Chapter3PhotoAlbumPanel({
  day,
  placeId,
  placeName,
  photos,
  albumState,
  defaultOpen = true,
  regionHint,
}: {
  day: number;
  placeId: string;
  placeName?: string;
  photos: Chapter3AlbumPhoto[];
  albumState: AlbumState;
  defaultOpen?: boolean;
  regionHint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen || photos.length > 0);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const inputIdPrefix = useId();
  const isMobile = isMobileDevice();
  const canUseCamera =
    typeof window !== "undefined" &&
    (window.isSecureContext || window.location.hostname === "localhost");

  const addOptions = placeName ? { placeName } : undefined;
  const orderedPhotos = useMemo(() => sortAlbumPhotos(photos), [photos]);
  const orderedIds = useMemo(() => orderedPhotos.map((photo) => photo.id), [orderedPhotos]);
  const canReorderPhoto = useCallback((id: string) => orderedIds.includes(id), [orderedIds]);
  const handleReorder = useCallback(
    (nextIds: string[]) => {
      albumState.reorderAlbumPhotos(day, nextIds);
    },
    [albumState.reorderAlbumPhotos, day],
  );
  const reorder = useAlbumPhotoPointerReorder({
    itemIds: orderedIds,
    canReorderId: canReorderPhoto,
    onReorder: handleReorder,
    itemAttr: "data-album-photo-id",
  });
  const canManualReorder = orderedPhotos.length >= 2;

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || isUploading) return;
      setUploadPercent(0);
      setIsUploading(true);
      try {
        await albumState.addPhotosToPlace(day, placeId, files, {
          ...addOptions,
          onProgress: setUploadPercent,
        });
      } finally {
        setIsUploading(false);
        setUploadPercent(0);
      }
    },
    [albumState, day, placeId, addOptions, isUploading],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      e.preventDefault();
      void albumState.addPhotosFromClipboard(day, placeId, e.clipboardData);
    },
    [albumState, day, placeId],
  );

  const openCamera = useCallback(() => {
    if (!canUseCamera && isMobile) {
      window.alert("카메라·사진첩은 HTTPS(또는 localhost)에서만 사용할 수 있습니다.");
      return;
    }
    cameraInputRef.current?.click();
  }, [canUseCamera, isMobile]);

  const openGallery = useCallback(() => {
    galleryInputRef.current?.click();
  }, []);

  return (
    <div className="chapter3SegmentPhotoSection">
      <button
        type="button"
        className={`chapter3PhotoAlbumToggle ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        📷 사진 앨범 {photos.length > 0 ? `(${photos.length}장)` : ""}
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="chapter3SegmentPhotoPanel"
          tabIndex={0}
          onPaste={handlePaste}
        >
          <p className="chapter3SegmentPhotoHint">
            GPS가 있는 사진은 지도에 표시됩니다. GPS·주소가 없는 사진은 아래에 주소를 입력한 뒤
            「지도에 표시」를 누르세요.
            {canManualReorder
              ? isMobile
                ? " 사진 순서는 노란 ⇅을 길게 누른 뒤 끌어 바꿀 수 있습니다."
                : " 사진 순서는 노란 ⇅(또는 사진)을 마우스로 끌어 바꿀 수 있습니다."
              : ""}
          </p>

          <div className="chapter3PhotoActions">
            <button
              type="button"
              className="chapter3PhotoActionBtn"
              disabled={isUploading}
              onClick={openCamera}
            >
              {isUploading ? `올리는 중 ${uploadPercent}%` : "📸 촬영"}
            </button>
            <button
              type="button"
              className="chapter3PhotoActionBtn"
              disabled={isUploading}
              onClick={openGallery}
            >
              {isUploading ? `올리는 중 ${uploadPercent}%` : "🖼️ 사진첩"}
            </button>
            <span className="chapter3PhotoActionHint">또는 이 영역에 붙여넣기</span>
          </div>

          <input
            id={`${inputIdPrefix}-camera`}
            ref={cameraInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            {...(isMobile ? { capture: "environment" as const } : {})}
            className="chapter3HiddenFileInput"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            id={`${inputIdPrefix}-gallery`}
            ref={galleryInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="chapter3HiddenFileInput"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <div className="chapter3PhotoGrid chapter3PhotoTileGrid">
            {orderedPhotos.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                day={day}
                placeId={placeId}
                albumState={albumState}
                selected={selectedPhotoId === photo.id}
                onSelect={() =>
                  setSelectedPhotoId((prev) => (prev === photo.id ? null : photo.id))
                }
                reorderable={canReorderPhoto(photo.id)}
                dragging={reorder.draggingId === photo.id}
                dragOver={reorder.overId === photo.id && reorder.draggingId !== photo.id}
                pointerProps={reorder.getItemProps(photo.id) as React.HTMLAttributes<HTMLDivElement>}
                handleProps={reorder.getHandleProps(photo.id) as React.HTMLAttributes<HTMLButtonElement>}
                shouldIgnoreClick={reorder.shouldIgnoreClick}
                regionHint={regionHint}
              />
            ))}

            <button
              type="button"
              className="chapter3PhotoAddSlot chapter3PhotoTileAdd"
              disabled={isUploading}
              onClick={openGallery}
            >
              <span>＋</span>
              <small>{isUploading ? `올리는 중 ${uploadPercent}%` : "사진 추가"}</small>
            </button>
          </div>
          {reorder.draggingId && reorder.ghost && (
            <div
              className="chapter3PhotoDragGhost"
              style={{ left: reorder.ghost.x, top: reorder.ghost.y }}
              aria-hidden
            >
              ⇅
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Chapter3DayPhotoLocationMap({
  photos,
  day,
  albumState,
  title = "📍 사진 촬영 위치 지도",
}: {
  photos: Chapter3AlbumPhoto[];
  day?: number;
  albumState?: Pick<AlbumState, "reorderAlbumPhotos" | "updatePhotoMemoInDay">;
  title?: string;
}) {
  const withGps = useMemo(
    () =>
      sortAlbumPhotos(
        photos.filter((p) => typeof p.exifLat === "number" && typeof p.exifLng === "number"),
      ),
    [photos],
  );
  const gpsIds = useMemo(() => withGps.map((photo) => photo.id), [withGps]);
  const canReorderPhoto = useCallback((id: string) => gpsIds.includes(id), [gpsIds]);
  const handleReorder = useCallback(
    (nextIds: string[]) => {
      if (day == null || !albumState?.reorderAlbumPhotos) return;
      albumState.reorderAlbumPhotos(day, nextIds);
    },
    [albumState?.reorderAlbumPhotos, day],
  );
  const reorder = useAlbumPhotoPointerReorder({
    itemIds: gpsIds,
    canReorderId: canReorderPhoto,
    onReorder: handleReorder,
    itemAttr: "data-album-map-photo-id",
  });
  const canManualReorder = withGps.length >= 2 && day != null && Boolean(albumState?.reorderAlbumPhotos);
  const isMobile = isMobileDevice();

  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [mapMemoDraft, setMapMemoDraft] = useState("");
  const mapMemoTimerRef = useRef<number | null>(null);
  const canEditMapMemo =
    day != null && typeof albumState?.updatePhotoMemoInDay === "function";

  useEffect(() => {
    if (withGps.length === 0) {
      setSelectedPhotoId(null);
      return;
    }
    setSelectedPhotoId((prev) =>
      prev && withGps.some((p) => p.id === prev) ? prev : withGps[0].id,
    );
  }, [withGps]);

  const selectedIndex = withGps.findIndex((p) => p.id === selectedPhotoId);
  const selectedPhoto = withGps.length > 0
    ? withGps[selectedIndex >= 0 ? selectedIndex : 0] ?? withGps[0]
    : null;
  const selectedNumber = selectedPhoto
    ? (selectedIndex >= 0 ? selectedIndex + 1 : 1)
    : 1;
  const isDomestic =
    withGps.length > 0 &&
    withGps.every((p) => isDomesticPhotoLocation(p.exifLat!, p.exifLng!));
  const selectedPlace = selectedPhoto ? getPhotoExifPlace(selectedPhoto) : "";

  useEffect(() => {
    setMapMemoDraft(selectedPhoto?.memo || "");
  }, [selectedPhoto?.id, selectedPhoto?.memo]);

  useEffect(() => {
    return () => {
      if (mapMemoTimerRef.current != null) window.clearTimeout(mapMemoTimerRef.current);
    };
  }, []);

  const persistMapMemo = (value: string) => {
    if (!canEditMapMemo || day == null || !albumState?.updatePhotoMemoInDay || !selectedPhoto) {
      return;
    }
    if (value === (selectedPhoto.memo || "")) return;
    albumState.updatePhotoMemoInDay(day, selectedPhoto.id, value);
  };

  const scheduleMapMemoPersist = (value: string) => {
    if (mapMemoTimerRef.current != null) window.clearTimeout(mapMemoTimerRef.current);
    mapMemoTimerRef.current = window.setTimeout(() => {
      mapMemoTimerRef.current = null;
      persistMapMemo(value);
    }, 350);
  };

  if (withGps.length === 0 || !selectedPhoto) {
    if (photos.length === 0) return null;
    return (
      <section className="chapter3DayPhotoMap">
        <h5>{title}</h5>
        <p className="chapter3DayPhotoMapHint">
          아직 지도에 올릴 위치가 없습니다. 앨범 사진에서 주소를 입력한 뒤 「지도에 표시」를 누르면
          여기에 핀과 이동 경로가 나타납니다.
        </p>
      </section>
    );
  }

  return (
    <section className="chapter3DayPhotoMap">
      <h5>{title}</h5>
      <p className="chapter3DayPhotoMapHint">
        사진 순서대로 번호·이동 경로가 표시됩니다. 지도의 번호를 누르거나 아래 사진을 선택하면 해당
        위치로 이동합니다.
        {canManualReorder
          ? isMobile
            ? " 순서를 바꾸려면 노란 ⇅을 길게 누른 뒤 끌어 옮기세요."
            : " 순서를 바꾸려면 노란 ⇅(또는 사진)을 마우스로 끌어 옮기세요."
          : ""}
      </p>

      <div className="chapter3DayPhotoMapLayout">
        <div className="chapter3DayPhotoMapMain">
          <Chapter3PhotoRouteMap
            photos={withGps}
            selectedPhotoId={selectedPhoto.id}
            onPhotoSelect={setSelectedPhotoId}
            previewImageUrl={photoDisplayUrl(selectedPhoto)}
            selectedNumber={selectedNumber}
            height={380}
          />
          {selectedPlace && (
            <div className="chapter3DayPhotoMapSelectedAddress">
              <span className="chapter3DayPhotoMapSelectedNum">{selectedNumber}</span>
              <span className="chapter3DayPhotoMapSelectedPlace">📍 {selectedPlace}</span>
            </div>
          )}
          {canEditMapMemo && (
            <label className="chapter3DayPhotoMapMemoField">
              <span className="chapter3DayPhotoMapMemoLabel">선택한 사진 메모</span>
              <input
                type="text"
                className="chapter3PhotoTileMemoInput"
                value={mapMemoDraft}
                placeholder="사진 메모 (예: 공항 도착)"
                onChange={(e) => {
                  const value = e.target.value;
                  setMapMemoDraft(value);
                  scheduleMapMemoPersist(value);
                }}
                onBlur={() => {
                  if (mapMemoTimerRef.current != null) {
                    window.clearTimeout(mapMemoTimerRef.current);
                    mapMemoTimerRef.current = null;
                  }
                  persistMapMemo(mapMemoDraft);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            </label>
          )}
          <p className="chapter3Muted chapter3DayPhotoMapMapNote">
            {isDomestic
              ? "국내: 네이버·자동차 도로 경로"
              : "해외: 자동차 도로 경로"}
          </p>
        </div>

        <div className="chapter3DayPhotoMapStrip" role="listbox" aria-label="촬영 위치 사진 선택">
          {withGps.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              role="option"
              aria-selected={photo.id === selectedPhoto.id}
              className={`chapter3DayPhotoMapThumbBtn${
                photo.id === selectedPhoto.id ? " active" : ""
              }${canReorderPhoto(photo.id) ? " reorderable" : ""}${
                reorder.draggingId === photo.id ? " dragging" : ""
              }${
                reorder.overId === photo.id && reorder.draggingId !== photo.id ? " dragOver" : ""
              }`}
              {...(canManualReorder ? reorder.getItemProps(photo.id) : {})}
              onClick={() => {
                if (reorder.shouldIgnoreClick()) return;
                setSelectedPhotoId(photo.id);
              }}
              title={getPhotoExifPlace(photo) || photo.fileName || `사진 ${index + 1}`}
            >
              <span className="chapter3DayPhotoMapThumbNum">{index + 1}</span>
              {canReorderPhoto(photo.id) && (
                <span
                  className="chapter3DayPhotoMapThumbHandle"
                  aria-label="끌어 순서 변경"
                  {...(canManualReorder ? reorder.getHandleProps(photo.id) : {})}
                >
                  ⇅
                </span>
              )}
              <img src={photoDisplayUrl(photo)} alt="" draggable={false} />
            </button>
          ))}
        </div>
        {reorder.draggingId && reorder.ghost && (
          <div
            className="chapter3PhotoDragGhost"
            style={{ left: reorder.ghost.x, top: reorder.ghost.y }}
            aria-hidden
          >
            ⇅
          </div>
        )}
      </div>
    </section>
  );
}
