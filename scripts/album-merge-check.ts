import {
  keepRemoteAlbumsMissingLocally,
  mergeTravelAlbumsStates,
  type TravelAlbumsState,
} from "../features/personal-album/utils/travelAlbumsSupabaseUtils";
import {
  repairAndDedupeAlbums,
  type SavedTravelAlbum,
} from "../features/personal-album/utils/chapter3SavedAlbumUtils";
import { restoreMissingAlbumPhotos } from "../features/personal-album/utils/albumEditorGuard";
import {
  createEmptyAlbumDay,
  type Chapter3AlbumDay,
  type Chapter3AlbumPhoto,
} from "../features/personal-album/utils/chapter3Utils";

function album(
  id: string,
  status: "saved" | "draft",
  updatedAt: string,
  sourcePlanId = `plan-${id}`,
): SavedTravelAlbum {
  return {
    id,
    title: id,
    status,
    kind: "personal",
    sourcePlanId,
    days: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function state(
  albums: SavedTravelAlbum[],
  updatedAt: string,
  deletedAlbums: SavedTravelAlbum[] = [],
): TravelAlbumsState {
  return { albums, deletedAlbums, updatedAt };
}

function ids(result: TravelAlbumsState | null): string[] {
  return (result?.albums || []).map((item) => item.id).sort();
}

let failed = 0;
function check(name: string, actual: string[], expected: string[]) {
  const ok = actual.join(",") === expected.join(",");
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: [${actual.join(", ")}]`);
  if (!ok) {
    console.log(`  expected [${expected.join(", ")}]`);
    failed += 1;
  }
}

const remoteSaved = album("me-saved", "saved", "2026-10-16T14:10:43.071Z", "fresh-me");
const remoteDraft = album("me-draft", "draft", "2026-10-17T01:53:13.789Z", "fresh-me");
remoteDraft.originAlbumId = "me-saved";
const remote = state([remoteSaved, remoteDraft], "2026-10-17T01:53:13.791Z");

const phonePartial = state(
  [album("phone-only", "draft", "2026-10-17T02:30:00.000Z", "fresh-phone")],
  "2026-10-17T02:30:00.000Z",
);
check(
  "newer partial phone keeps server albums",
  ids(mergeTravelAlbumsStates(phonePartial, remote)),
  ["me-draft", "me-saved", "phone-only"].sort(),
);

const phoneEmpty = state([], "2026-10-17T03:00:00.000Z");
check(
  "newer empty phone keeps server albums",
  ids(mergeTravelAlbumsStates(phoneEmpty, remote)),
  ["me-draft", "me-saved"].sort(),
);

const deletedSaved = {
  ...remoteSaved,
  deletedAt: "2026-10-17T04:00:00.000Z",
  updatedAt: "2026-10-17T04:00:00.000Z",
};
const phoneDeleted = state(
  [album("phone-only", "draft", "2026-10-17T04:01:00.000Z", "fresh-phone")],
  "2026-10-17T04:01:00.000Z",
  [deletedSaved],
);
check(
  "explicit delete still hides that album and its draft",
  ids(mergeTravelAlbumsStates(phoneDeleted, remote)),
  ["phone-only"],
);

const kept = keepRemoteAlbumsMissingLocally(phonePartial, remote);
check(
  "save keeps server albums missing on this device",
  kept.albums.map((item) => item.id).sort(),
  ["me-draft", "me-saved", "phone-only"].sort(),
);

const savedAfterDelete = keepRemoteAlbumsMissingLocally(phoneDeleted, remote);
check(
  "save does not restore an explicitly deleted album",
  savedAfterDelete.albums.map((item) => item.id).sort(),
  ["phone-only"],
);

const staleLocalDraft = { ...remoteDraft, updatedAt: "2026-10-17T01:00:00.000Z", title: "stale" };
const newerRemote = keepRemoteAlbumsMissingLocally(
  state([remoteSaved, staleLocalDraft], "2026-10-17T03:40:00.000Z"),
  state([remoteSaved, { ...remoteDraft, title: "fresh" }], "2026-10-17T03:00:00.000Z"),
);
check(
  "save keeps the newer server copy of the same album",
  newerRemote.albums.filter((item) => item.id === "me-draft").map((item) => item.title),
  ["fresh"],
);

const migratedSaved = {
  ...remoteSaved,
  confirmedAt: "2026-10-16T14:10:43.071Z",
  updatedAt: "2026-10-17T03:00:00.000Z",
};
check(
  "draft survives when its confirmed album is only re-saved by compression",
  repairAndDedupeAlbums([migratedSaved, remoteDraft]).map((item) => item.id).sort(),
  ["me-draft", "me-saved"],
);

const reconfirmed = { ...remoteSaved, confirmedAt: "2026-10-17T05:00:00.000Z", updatedAt: "2026-10-17T05:00:00.000Z" };
check(
  "draft older than the last confirm is still dropped",
  repairAndDedupeAlbums([reconfirmed, remoteDraft]).map((item) => item.id),
  ["me-saved"],
);

const absorbedTomb = { ...remoteDraft, deletedAt: "2026-10-17T05:00:00.000Z", deletedReason: "confirmed" as const };
check(
  "confirm record keeps another device's stale draft from coming back",
  ids(
    mergeTravelAlbumsStates(
      state([reconfirmed], "2026-10-17T05:00:00.000Z", [absorbedTomb]),
      state([remoteSaved, remoteDraft], "2026-10-17T04:00:00.000Z"),
    ),
  ),
  ["me-saved"],
);

function photo(id: string, takenAt: string): Chapter3AlbumPhoto {
  return {
    id,
    dataUrl: `https://example.com/${id}.jpg`,
    fileUrl: `https://example.com/${id}.jpg`,
    fileName: `${id}.jpg`,
    memo: "",
    exifTakenAt: Date.parse(takenAt),
    createdAt: takenAt,
  };
}

function dayWith(day: number, dateIso: string, photos: Chapter3AlbumPhoto[]): Chapter3AlbumDay {
  const base = createEmptyAlbumDay(day, { dateIso });
  return {
    ...base,
    dateIso,
    places: base.places.map((place, index) => (index === 0 ? { ...place, photos } : place)),
  };
}

function photoIds(days: Chapter3AlbumDay[]): string[] {
  return days.flatMap((d) => d.places.flatMap((p) => p.photos.map((ph) => ph.id))).sort();
}

const storedDays = [
  dayWith(1, "2024-12-14", [photo("old-1", "2024-12-14T10:00:00Z"), photo("old-2", "2024-12-14T11:00:00Z")]),
  dayWith(2, "2026-10-11", [photo("old-3", "2026-10-11T09:00:00Z")]),
];
const editorOnlyNew = [dayWith(1, "2016-04-28", [photo("new-1", "2016-04-28T08:00:00Z")])];
check(
  "empty editor upload keeps existing album photos",
  photoIds(restoreMissingAlbumPhotos(editorOnlyNew, storedDays, new Set()).days),
  ["new-1", "old-1", "old-2", "old-3"],
);
check(
  "photos the user deleted stay deleted",
  photoIds(restoreMissingAlbumPhotos(editorOnlyNew, storedDays, new Set(["old-2"])).days),
  ["new-1", "old-1", "old-3"],
);

if (failed > 0) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
