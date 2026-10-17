import {
  keepRemoteAlbumsMissingLocally,
  mergeTravelAlbumsStates,
  type TravelAlbumsState,
} from "../features/personal-album/utils/travelAlbumsSupabaseUtils";
import type { SavedTravelAlbum } from "../features/personal-album/utils/chapter3SavedAlbumUtils";

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

if (failed > 0) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
