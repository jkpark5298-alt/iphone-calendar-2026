import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DayPlan } from "../types";
import {
  buildAlbumDaysFromPlans,
  buildAlbumDaysFromManualPlans,
  mergeAlbumDays,
  mergeManualAlbumDays,
  manualTripAlbumPlanId,
  addAlbumDayToList,
  removeAlbumDayFromList,
  updateAlbumDayDateInList,
  withResolvedPlaceDescriptions,
  type Chapter3AlbumDay,
  type Chapter3AlbumPhoto,
} from "../utils/chapter3Utils";
import { readChapter3Album, writeChapter3Album } from "../utils/chapter3Storage";
import {
  fileToAlbumDataUrl,
  isAlbumImageFile,
  isGpsCoordinateLabel,
  readImageExif,
  resolveExifPlaceName,
  getPhotoExifPlaceName,
  type ImageExifInfo,
} from "../utils/exifUtils";
import {
  applyPhotoSortOrdersToDay,
  mergePhotosByExifDate,
  normalizeAlbumDaysPhotos,
  reorderPhotosByIds,
  sortAlbumPhotos,
} from "../utils/albumPhotoOrderUtils";
import { uploadAlbumPhotoToStorage } from "../utils/chapter3AlbumSyncUtils";
import { fileToViewJpegFile } from "../utils/albumPhotoPackUtils";
import { storageNeedsArchive } from "../utils/albumArchivePressure";
import { ARCHIVE_JPEG_MAX_BYTES } from "../utils/albumArchivePlan";
import { uploadCompressedJpegToDrive } from "../utils/googleDriveClient";
import { isSupabaseConfigured } from "../../../lib/supabaseClient";
import { uploadFileToSupabaseStorage } from "../utils/supabaseUtils";
import {
  ALBUM_UPLOAD_MAX_FILES,
  ALBUM_UPLOAD_MAX_ROUNDS,
  albumFileIdentityKeys,
  albumUploadPercent,
  collectAlbumDedupeKeys,
  gateAlbumUploadBatch,
  isDuplicateAlbumFile,
  preferredAlbumDedupeKey,
} from "../utils/albumUploadBatch";

export type AddAlbumPhotosResult = {
  status: "empty" | "over-limit" | "round-limit" | "added" | "duplicates-only" | "no-image" | "failed";
  added: number;
  skippedDuplicates: number;
  selected: number;
};

export interface UseTravelDiaryChapter3StateProps {
  dayPlans: DayPlan[];
  albumPlanId: string;
  showPasteHint: (msg: string) => void;
  enabled: boolean;
  manualMode?: boolean;
  /** 새 앨범을 확정하기 전에 사진을 더 올릴 때 붙이는 안내. 호출 시점의 값을 읽는다. */
  uploadProgressNoteRef?: { current: string | undefined };
  /** 용량이 찰 때·이미 압축된 앨범에는 원본 대신 압축 사진을 올린다. */
  archiveUploadRef?: { current: { albumId?: string; required: boolean } };
}

export function useTravelDiaryChapter3State({
  dayPlans,
  albumPlanId,
  showPasteHint,
  enabled,
  manualMode = false,
  uploadProgressNoteRef,
  archiveUploadRef,
}: UseTravelDiaryChapter3StateProps) {
  const skeleton = useMemo(
    () =>
      enabled && dayPlans.length > 0
        ? manualMode
          ? buildAlbumDaysFromManualPlans(dayPlans)
          : buildAlbumDaysFromPlans(dayPlans)
        : [],
    [dayPlans, enabled, manualMode],
  );

  const mergeFn = manualMode ? mergeManualAlbumDays : mergeAlbumDays;
  const hydratedPlanIdRef = useRef<string | null>(null);
  const explicitDaysLoadedRef = useRef(false);
  const geocodedPhotoIdsRef = useRef<Set<string>>(new Set());
  const albumDaysRef = useRef<Chapter3AlbumDay[]>([]);
  /** 편집기에서 사용자가 직접 지운 사진 — 자동 저장이 이 사진만 빼고 나머지는 지키게 한다 */
  const removedPhotoIdsRef = useRef<Set<string>>(new Set());

  const [albumDays, setAlbumDays] = useState<Chapter3AlbumDay[]>([]);
  albumDaysRef.current = albumDays;
  const [expandedPlaceId, setExpandedPlaceId] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  /** 저장된 앨범을 편집기에 올린다. 이어지는 계획서 동기화가 다른 저장 키로 덮어쓰지 않는다. */
  const loadAlbumDays = useCallback((days: Chapter3AlbumDay[]) => {
    explicitDaysLoadedRef.current = true;
    removedPhotoIdsRef.current = new Set();
    setAlbumDays(days);
  }, []);

  // 계획서 변경 시: 새 planId면 localStorage 로드, 아니면 메모리 사진 유지하며 골격만 동기화
  useEffect(() => {
    if (!enabled || !albumPlanId) {
      setAlbumDays([]);
      hydratedPlanIdRef.current = null;
      explicitDaysLoadedRef.current = false;
      return;
    }

    if (explicitDaysLoadedRef.current) {
      explicitDaysLoadedRef.current = false;
      hydratedPlanIdRef.current = albumPlanId;
      setAlbumDays((prev) => normalizeAlbumDaysPhotos(mergeFn(skeleton, prev)));
      return;
    }

    if (hydratedPlanIdRef.current !== albumPlanId) {
      const saved = readChapter3Album(albumPlanId);
      setAlbumDays(normalizeAlbumDaysPhotos(mergeFn(skeleton, saved || [])));
      hydratedPlanIdRef.current = albumPlanId;
      geocodedPhotoIdsRef.current = new Set();
      return;
    }

    setAlbumDays((prev) => normalizeAlbumDaysPhotos(mergeFn(skeleton, prev)));
  }, [albumPlanId, skeleton, enabled, manualMode, mergeFn]);

  // 위 effect가 이번 커밋에 돌지 않았으면 표시를 남겨 두지 않는다 (다음 계획서 전환은 정상 로드)
  useEffect(() => {
    explicitDaysLoadedRef.current = false;
  }, [albumDays]);

  useEffect(() => {
    if (!enabled || albumDays.length === 0) return;
    const resolved = withResolvedPlaceDescriptions(albumDays);
    if (resolved === albumDays) return;
    setAlbumDays(resolved);
  }, [albumDays, enabled]);

  useEffect(() => {
    if (!enabled || !albumPlanId || albumDays.length === 0) return;
    const ok = writeChapter3Album(albumPlanId, albumDays);
    if (!ok) {
      showPasteHint(
        "⚠️ 이 기기 저장 공간이 부족합니다. 사진을 줄이거나, 클라우드 업로드 후 다시 저장해 주세요.",
      );
    }
  }, [albumDays, albumPlanId, enabled, showPasteHint]);

  const updatePlaceDescription = useCallback((day: number, placeId: string, description: string) => {
    setAlbumDays((prev) =>
      prev.map((d) =>
        d.day !== day
          ? d
          : {
              ...d,
              places: d.places.map((p) => (p.id === placeId ? { ...p, description } : p)),
            },
      ),
    );
  }, []);

  const updatePhotoMemo = useCallback(
    (day: number, placeId: string, photoId: string, memo: string) => {
      setAlbumDays((prev) =>
        prev.map((d) =>
          d.day !== day
            ? d
            : {
                ...d,
                places: d.places.map((p) =>
                  p.id !== placeId
                    ? p
                    : {
                        ...p,
                        photos: p.photos.map((ph) => (ph.id === photoId ? { ...ph, memo } : ph)),
                      },
                ),
              },
        ),
      );
    },
    [],
  );

  /** GPS 사진 — 수동 장소명 대신 역지오코딩 지명만 초기값으로 사용 */
  function pickInitialExifPlaceName(
    exif: ImageExifInfo,
    options?: { placeName?: string },
  ): string | undefined {
    const fromExifText = exif.placeName?.trim();
    if (fromExifText && !isGpsCoordinateLabel(fromExifText)) return fromExifText;

    const hasGps = typeof exif.lat === "number" && typeof exif.lng === "number";
    if (hasGps) return undefined;

    return options?.placeName?.trim() || undefined;
  }

  function shouldResolveGpsPlaceName(photo: Chapter3AlbumPhoto): boolean {
    if (photo.exifPlaceEdited) return false;
    if (typeof photo.exifLat !== "number" || typeof photo.exifLng !== "number") return false;

    const current = getPhotoExifPlaceName(photo);
    if (!current) return true;
    if (isGpsCoordinateLabel(current)) return true;
    // 예전 버전: 오전/오후 사진 앨범 등 블록명이 들어간 경우 GPS 지명으로 다시 변환
    if (/사진 앨범$/.test(current)) return true;
    return false;
  }

  const applyPhotoExifPlaceName = useCallback(
    (
      day: number,
      placeId: string,
      photoId: string,
      exifPlaceName: string,
      fromUser = false,
    ) => {
      setAlbumDays((prev) =>
        prev.map((d) =>
          d.day !== day
            ? d
            : {
                ...d,
                places: d.places.map((p) =>
                  p.id !== placeId
                    ? p
                    : {
                        ...p,
                        photos: p.photos.map((ph) =>
                          ph.id === photoId
                            ? {
                                ...ph,
                                exifPlaceName,
                                exifPlaceEdited: fromUser ? true : ph.exifPlaceEdited,
                              }
                            : ph,
                        ),
                      },
                ),
              },
        ),
      );
    },
    [],
  );

  const updatePhotoExifPlaceName = useCallback(
    (day: number, placeId: string, photoId: string, exifPlaceName: string) => {
      applyPhotoExifPlaceName(day, placeId, photoId, exifPlaceName, true);
    },
    [applyPhotoExifPlaceName],
  );

  const updatePhotoLocation = useCallback(
    (
      day: number,
      placeId: string,
      photoId: string,
      location: { lat: number; lng: number; placeName: string },
    ) => {
      setAlbumDays((prev) =>
        prev.map((d) =>
          d.day !== day
            ? d
            : {
                ...d,
                places: d.places.map((p) =>
                  p.id !== placeId
                    ? p
                    : {
                        ...p,
                        photos: p.photos.map((ph) =>
                          ph.id === photoId
                            ? {
                                ...ph,
                                exifLat: location.lat,
                                exifLng: location.lng,
                                exifPlaceName: location.placeName,
                                exifLocationLabel: location.placeName,
                                exifPlaceEdited: true,
                              }
                            : ph,
                        ),
                      },
                ),
              },
        ),
      );
    },
    [],
  );

  const updatePhotoMemoInDay = useCallback((day: number, photoId: string, memo: string) => {
    setAlbumDays((prev) =>
      prev.map((d) =>
        d.day !== day
          ? d
          : {
              ...d,
              places: d.places.map((p) => ({
                ...p,
                photos: p.photos.map((ph) => (ph.id === photoId ? { ...ph, memo } : ph)),
              })),
            },
      ),
    );
  }, []);

  const updatePhotoExifPlaceNameInDay = useCallback(
    (day: number, photoId: string, exifPlaceName: string) => {
      setAlbumDays((prev) =>
        prev.map((d) =>
          d.day !== day
            ? d
            : {
                ...d,
                places: d.places.map((p) => ({
                  ...p,
                  photos: p.photos.map((ph) =>
                    ph.id === photoId
                      ? { ...ph, exifPlaceName, exifPlaceEdited: true }
                      : ph,
                  ),
                })),
              },
        ),
      );
    },
    [],
  );

  const resolvePhotoPlaceFromGps = useCallback(
    async (day: number, placeId: string, photoId: string) => {
      const albumDay = albumDays.find((d) => d.day === day);
      const place = albumDay?.places.find((p) => p.id === placeId);
      const photo = place?.photos.find((p) => p.id === photoId);
      if (!photo || !shouldResolveGpsPlaceName(photo)) return;

      try {
        const placeName = await resolveExifPlaceName(photo.exifLat!, photo.exifLng!);
        if (placeName && !isGpsCoordinateLabel(placeName)) {
          applyPhotoExifPlaceName(day, placeId, photoId, placeName, false);
        }
      } catch {
        // 백필 effect에서 재시도
      }
    },
    [albumDays, applyPhotoExifPlaceName],
  );

  // GPS가 있는데 장소명이 없거나 좌표만 있으면 역지오코딩으로 지명 보강
  useEffect(() => {
    if (!enabled || albumDays.length === 0) return;
    let cancelled = false;

    const resolveOne = async (
      dayNum: number,
      placeId: string,
      photo: Chapter3AlbumPhoto,
      current: string,
      geocodeKey: string,
      attempt: number,
    ) => {
      const placeName = await resolveExifPlaceName(photo.exifLat!, photo.exifLng!);
      if (cancelled) return;
      if (placeName && !isGpsCoordinateLabel(placeName)) {
        applyPhotoExifPlaceName(dayNum, placeId, photo.id, placeName, false);
        return;
      }
      if (attempt < 3) {
        window.setTimeout(() => {
          if (!cancelled) {
            void resolveOne(dayNum, placeId, photo, current, geocodeKey, attempt + 1);
          }
        }, 2500 * (attempt + 1));
        return;
      }
      geocodedPhotoIdsRef.current.delete(geocodeKey);
    };

    for (const day of albumDays) {
      for (const place of day.places) {
        for (const photo of place.photos) {
          if (!shouldResolveGpsPlaceName(photo)) continue;

          const geocodeKey = `${photo.id}:${photo.exifLat!.toFixed(5)},${photo.exifLng!.toFixed(5)}`;
          if (geocodedPhotoIdsRef.current.has(geocodeKey)) continue;
          geocodedPhotoIdsRef.current.add(geocodeKey);

          void resolveOne(
            day.day,
            place.id,
            photo,
            getPhotoExifPlaceName(photo),
            geocodeKey,
            0,
          );
        }
      }
    }

    return () => {
      cancelled = true;
    };
  }, [albumDays, enabled, applyPhotoExifPlaceName]);

  const removePhoto = useCallback((day: number, placeId: string, photoId: string) => {
    removedPhotoIdsRef.current.add(photoId);
    setAlbumDays((prev) =>
      prev.map((d) =>
        d.day !== day
          ? d
          : {
              ...d,
              places: d.places.map((p) =>
                p.id !== placeId ? p : { ...p, photos: p.photos.filter((ph) => ph.id !== photoId) },
              ),
            },
      ),
    );
  }, []);

  const addPhotosToPlace = useCallback(
    async (
      day: number,
      placeId: string,
      files: FileList | File[] | null,
      options?: {
        placeName?: string;
        uploadBatch?: { completedRounds: number };
        onProgress?: (percent: number) => void;
      },
    ): Promise<AddAlbumPhotosResult> => {
      const fileList = files
        ? Array.isArray(files)
          ? files
          : Array.from(files)
        : [];
      const emptyResult: AddAlbumPhotosResult = {
        status: "empty",
        added: 0,
        skippedDuplicates: 0,
        selected: fileList.length,
      };
      if (fileList.length === 0) return emptyResult;

      const withProgress = (message: string) => {
        const note = uploadProgressNoteRef?.current;
        return note ? `${note} ${message}` : message;
      };

      if (options?.uploadBatch) {
        const gate = gateAlbumUploadBatch(fileList.length, options.uploadBatch.completedRounds);
        if (gate.ok === false && gate.reason === "round-limit") {
          showPasteHint(withProgress(`사진 올리기는 ${ALBUM_UPLOAD_MAX_ROUNDS}회까지입니다.`));
          return { ...emptyResult, status: "round-limit" };
        }
        if (gate.ok === false && gate.reason === "too-many") {
          showPasteHint(
            withProgress(
              `한 번에 ${ALBUM_UPLOAD_MAX_FILES}장까지입니다. ${fileList.length}장을 선택했습니다. ${ALBUM_UPLOAD_MAX_FILES}장 이하로 다시 선택해 주세요.`,
            ),
          );
          return { ...emptyResult, status: "over-limit" };
        }
      }

      try {
        const newPhotos: Chapter3AlbumPhoto[] = [];
        const seenKeys = collectAlbumDedupeKeys(albumDaysRef.current);
        let skippedDuplicates = 0;
        let uploadFailed = 0;
        let lastPercent = -1;
        const reportProgress = (done: number) => {
          const percent = albumUploadPercent(done, fileList.length);
          if (percent === lastPercent) return;
          lastPercent = percent;
          options?.onProgress?.(percent);
        };
        reportProgress(0);

        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          if (!isAlbumImageFile(file)) {
            reportProgress(i + 1);
            continue;
          }

          const exif = await readImageExif(file);
          if (isDuplicateAlbumFile(file, exif.takenAtMs, seenKeys)) {
            skippedDuplicates += 1;
            reportProgress(i + 1);
            continue;
          }
          const dedupeKey = preferredAlbumDedupeKey(file, exif.takenAtMs);
          const identityKeys = albumFileIdentityKeys(file, exif.takenAtMs);
          identityKeys.forEach((key) => seenKeys.add(key));

          const photoId = `photo-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
          const initialPlaceName = pickInitialExifPlaceName(exif, options);

          let photo: Chapter3AlbumPhoto = {
            id: photoId,
            dataUrl: "",
            fileName: file.name,
            memo: "",
            dedupeKey,
            fileSize: file.size,
            exifDateTime: exif.dateTime,
            exifTakenAt: exif.takenAtMs,
            exifLat: exif.lat,
            exifLng: exif.lng,
            exifLocationLabel: exif.locationLabel,
            exifPlaceName: initialPlaceName,
            createdAt: new Date().toISOString(),
          };

          const archiveTarget = archiveUploadRef?.current;
          const uploadCompressed = Boolean(archiveTarget?.required) || storageNeedsArchive();
          // 여유가 있으면 원본을 올리고, 80% 이상이거나 이미 압축된 앨범이면 압축본만 올린다.
          if (isSupabaseConfigured && uploadCompressed && archiveTarget?.albumId) {
            try {
              const jpeg = await fileToViewJpegFile(file);
              if (jpeg.size > ARCHIVE_JPEG_MAX_BYTES) throw new Error("compressed photo is too large");
              const uploaded = await uploadCompressedJpegToDrive(jpeg, archiveTarget.albumId, photoId);
              photo = {
                ...photo,
                dataUrl: uploaded.fileUrl,
                fileUrl: uploaded.fileUrl,
                driveFileId: uploaded.fileId,
                storagePath: undefined,
                archived: true,
              };
            } catch (error) {
              console.error("compressed album photo upload failed", error);
            }
          } else if (isSupabaseConfigured) {
            try {
              const uploaded = await uploadFileToSupabaseStorage(file);
              photo = {
                ...photo,
                dataUrl: uploaded.fileUrl,
                fileUrl: uploaded.fileUrl,
                storagePath: uploaded.storagePath,
              };
            } catch (error) {
              console.error("direct album photo upload failed", error);
            }
          }

          // 2순위: 압축 dataUrl → Storage 업로드 / 로컬 보관. 압축 앨범에는 원본을 다시 넣지 않는다.
          if (!photo.fileUrl && !uploadCompressed) {
            const dataUrl = await fileToAlbumDataUrl(file);
            if (!dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
              identityKeys.forEach((key) => seenKeys.delete(key));
              reportProgress(i + 1);
              continue;
            }
            photo = { ...photo, dataUrl };
            if (isSupabaseConfigured) {
              photo = await uploadAlbumPhotoToStorage(photo);
            }
          }

          if (!photo.dataUrl && !photo.fileUrl) {
            if (uploadCompressed) uploadFailed += 1;
            identityKeys.forEach((key) => seenKeys.delete(key));
            reportProgress(i + 1);
            continue;
          }

          newPhotos.push(photo);
          reportProgress(i + 1);
        }

        if (newPhotos.length === 0) {
          if (uploadFailed > 0) {
            showPasteHint(
              withProgress(
                `⚠️ Google Drive 업로드에 실패해 사진 ${uploadFailed}장을 넣지 못했습니다. 연결을 확인하고 다시 올려 주세요.`,
              ),
            );
            return {
              status: "failed",
              added: 0,
              skippedDuplicates,
              selected: fileList.length,
            };
          }
          if (skippedDuplicates > 0) {
            showPasteHint(
              withProgress(
                options?.uploadBatch
                  ? `이미 올린 사진 ${skippedDuplicates}장은 다시 넣지 않았습니다.`
                  : `이미 있는 사진 ${skippedDuplicates}장은 한 장만 유지합니다.`,
              ),
            );
            return {
              status: "duplicates-only",
              added: 0,
              skippedDuplicates,
              selected: fileList.length,
            };
          }
          showPasteHint(withProgress("⚠️ 이미지 파일만 추가할 수 있습니다. (JPEG·PNG·HEIC 등)"));
          return {
            status: "no-image",
            added: 0,
            skippedDuplicates,
            selected: fileList.length,
          };
        }

        const summary = {
          datedCount: 0,
          undatedCount: 0,
          dayCount: 0,
          focusDay: null as number | null,
          focusPlaceId: null as string | null,
        };
        setAlbumDays((prev) => {
          const merged = mergePhotosByExifDate(prev, newPhotos, {
            fallbackDay: day,
            fallbackPlaceId: placeId,
            manualMode,
          });
          summary.datedCount = merged.datedCount;
          summary.undatedCount = merged.undatedCount;
          summary.dayCount = merged.dayCount;
          summary.focusDay = merged.focusDay;
          summary.focusPlaceId = merged.focusPlaceId;
          return merged.days;
        });
        if (summary.focusDay != null) setExpandedDay(summary.focusDay);
        if (summary.focusPlaceId) setExpandedPlaceId(summary.focusPlaceId);

        const arranged =
          summary.datedCount > 0
            ? `촬영일 ${summary.dayCount}개로 정리`
            : "촬영일이 없어 날짜를 만들지 못함";
        const undatedNote =
          summary.undatedCount > 0 ? ` · 촬영일 없는 사진 ${summary.undatedCount}장` : "";
        const uploadedCount = newPhotos.filter((p) => p.fileUrl?.startsWith("http")).length;
        const cloudNote =
          uploadedCount === newPhotos.length && isSupabaseConfigured
            ? " · 클라우드 저장 완료"
            : uploadedCount > 0
              ? " · 일부만 클라우드 저장"
              : "";
        const roundNote = options?.uploadBatch
          ? `${options.uploadBatch.completedRounds + 1}회 완료 · `
          : "";
        const duplicateNote =
          skippedDuplicates > 0 ? ` · 중복 ${skippedDuplicates}장은 제외` : "";
        const failedNote =
          uploadFailed > 0
            ? ` · ⚠️ Drive 업로드 실패 ${uploadFailed}장은 빠졌습니다. 다시 올려 주세요`
            : "";
        showPasteHint(
          withProgress(
            `📷 ${roundNote}사진 ${newPhotos.length}장 · ${arranged}${undatedNote}${duplicateNote}${cloudNote}${failedNote}`,
          ),
        );

        // GPS → 위치명(주소)으로 변환해 촬영 장소에 표시
        for (const photo of newPhotos) {
          if (typeof photo.exifLat !== "number" || typeof photo.exifLng !== "number") continue;
          try {
            const placeName = await resolveExifPlaceName(photo.exifLat, photo.exifLng);
            if (placeName && !isGpsCoordinateLabel(placeName)) {
              setAlbumDays((prev) =>
                prev.map((albumDay) => ({
                  ...albumDay,
                  places: albumDay.places.map((place) => ({
                    ...place,
                    photos: place.photos.map((item) =>
                      item.id === photo.id && !item.exifPlaceEdited
                        ? { ...item, exifPlaceName: placeName }
                        : item,
                    ),
                  })),
                })),
              );
            }
          } catch {
            // ignore — 백필 effect에서 재시도
          }
        }
        return {
          status: "added",
          added: newPhotos.length,
          skippedDuplicates,
          selected: fileList.length,
        };
      } catch (err) {
        console.error("album photo add failed", err);
        showPasteHint(
          withProgress("⚠️ 사진을 불러오지 못했습니다. 다른 사진으로 다시 시도해 주세요."),
        );
        return {
          status: "failed",
          added: 0,
          skippedDuplicates: 0,
          selected: fileList.length,
        };
      }
    },
    [showPasteHint, manualMode, uploadProgressNoteRef, archiveUploadRef],
  );

  const addPhotosFromClipboard = useCallback(
    async (day: number, placeId: string, data: DataTransfer | null) => {
      if (!data) return;
      const files: File[] = [];
      for (const item of data.items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) {
        showPasteHint("⚠️ 붙여넣을 이미지가 없습니다.");
        return;
      }
      await addPhotosToPlace(day, placeId, files);
    },
    [addPhotosToPlace, showPasteHint],
  );

  const getPlacePhotos = useCallback(
    (day: number, placeId: string) => {
      const albumDay = albumDays.find((d) => d.day === day);
      return sortAlbumPhotos(albumDay?.places.find((p) => p.id === placeId)?.photos ?? []);
    },
    [albumDays],
  );

  const reorderAlbumPhotos = useCallback((day: number, orderedIds: string[]) => {
    if (orderedIds.length < 2) return;
    setAlbumDays((prev) =>
      prev.map((d) => {
        if (d.day !== day) return d;
        const ordered = reorderPhotosByIds(
          d.places.flatMap((place) => place.photos),
          orderedIds,
        );
        return ordered ? applyPhotoSortOrdersToDay(d, ordered) : d;
      }),
    );
  }, []);

  const addAlbumDay = useCallback(() => {
    setAlbumDays((prev) => addAlbumDayToList(prev, manualMode));
    showPasteHint("📅 일차를 추가했습니다.");
  }, [manualMode, showPasteHint]);

  const removeAlbumDay = useCallback(
    (day: number) => {
      setAlbumDays((prev) => {
        if (prev.length <= 1) {
          showPasteHint("⚠️ 최소 1일차는 유지해야 합니다.");
          return prev;
        }
        prev
          .find((d) => d.day === day)
          ?.places.forEach((place) =>
            place.photos.forEach((photo) => removedPhotoIdsRef.current.add(photo.id)),
          );
        return removeAlbumDayFromList(prev, day);
      });
      setExpandedDay((cur) => (cur === day ? null : cur));
      showPasteHint("🗑️ 일차를 삭제했습니다.");
    },
    [showPasteHint],
  );

  const updateAlbumDayDate = useCallback((day: number, dateIso: string) => {
    setAlbumDays((prev) => updateAlbumDayDateInList(prev, day, dateIso));
  }, []);

  return {
    albumDays,
    setAlbumDays,
    loadAlbumDays,
    removedPhotoIdsRef,
    expandedPlaceId,
    setExpandedPlaceId,
    expandedDay,
    setExpandedDay,
    addAlbumDay,
    removeAlbumDay,
    updateAlbumDayDate,
    updatePlaceDescription,
    updatePhotoMemo,
    updatePhotoExifPlaceName,
    updatePhotoLocation,
    updatePhotoMemoInDay,
    updatePhotoExifPlaceNameInDay,
    resolvePhotoPlaceFromGps,
    removePhoto,
    addPhotosToPlace,
    addPhotosFromClipboard,
    getPlacePhotos,
    reorderAlbumPhotos,
  };
}

export { manualTripAlbumPlanId };
