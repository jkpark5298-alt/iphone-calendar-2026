# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

모든 답변과 설명은 항상 한국어로 한다. 코드 주석과 화면 문구도 한국어로 쓴다.

## Commands

- `npm run dev`: Next.js dev server bound to `0.0.0.0:3000`, so an iPhone on the same Wi-Fi can open `http://<PC IP>:3000`.
- `npm run build`: production build. Run it before deploying when you add server routes or native deps (e.g. `sharp`).
- `npm run start`: serve the production build locally.
- `npx tsc --noEmit -p .`: type check. There is no lint script and no test suite.
  - After a route is deleted, `.next/types/validator.ts` can report it as missing until the next dev or build run. That error can be ignored.
- No test runner is installed. Verify changes by running the dev server and checking the page in headless Chrome (Chrome DevTools protocol) or by calling the API routes directly.
  - `scripts/album-merge-check.ts` is a standalone check for album merge logic.
- Node 24 can import `.ts` files directly (type stripping), but only when they have no extensionless relative imports. `lib/googleDrive.ts` qualifies.

**The dev server uses the production Supabase project** (`.env.local`). Any save made while testing writes real data. Use throwaway rows and files (e.g. a large dummy `id`) and delete them afterwards.

## Deploy

- Vercel deploys automatically on push to `main`.
- The working branch is `cursor/personal-album-port`, and it is kept identical to `main`. Push the same commit to both: `git push origin HEAD:main && git push origin HEAD:cursor/personal-album-port`.
- Deploy status: `gh api repos/jkpark5298-alt/iphone-calendar-2026/commits/<sha>/status`.
- Production URL: `https://iphone-calendar-2026.vercel.app`.
- Files use CRLF line endings. Preserve them when editing programmatically.

## Architecture

### One big client page
`app/page.tsx` (~7900 lines) is the whole app.
- A `view` state switches between `calendar | diary | info | schedule | redDate | markDate | theme`. There is no per-view routing.
- Most data access happens in the browser through the anon client in `lib/supabaseClient.ts`.
- Larger features are split out:
  - `hooks/useTravelDiaryGeneralInfoState.ts`: 일반정보수집 (collected web/Instagram info, rich-text paragraphs).
  - `components/InfoIndexPanel.tsx`: 정보 인덱스 list.
  - `components/ThemeBoard.tsx`: theme notes.
  - `features/personal-album/`: 개인앨범, ported from a separate travel-diary app. It is dynamically imported inside the `info` view and opened with `?personalAlbum=1`.

### Data: Supabase is the source of truth, localStorage is a cache
- Per-day localStorage keys follow `iphone-diary-2026-<type>-MM-DD` (`storageKey()` in `page.tsx`).
- When Supabase is configured, the remote copy wins on load. Local copies matter only for unsynced edits.
- Main tables:

| Area | Tables |
|---|---|
| Diary and info vault (unique `entry_date`) | `diary_entries`, `info_entries` |
| Photos and cards | `diary_photos`, `info_photos`, `info_text_cards` |
| Calendar | `calendar_marks`, `red_dates`, `calendar_schedules` |
| Collected info, themes, index | `general_info_items`, `theme_notes`, `information_entries` |
| Personal album (single JSON row, `session_id='default'`) | `travel_albums_state` |

- Saves use `upsert(..., { onConflict })`, which needs matching unique constraints.
  - The project was migrated in 2026-10 and the constraints went missing; `supabase/migrations/20261021_entry_unique_constraints.sql` restores them.
  - `upsertEntryByDate()` in `page.tsx` falls back to update-then-insert on error `42P10`.
- The full schema is not in the repo. Migrations are applied by hand in the Supabase SQL Editor.

### Storage buckets

| Bucket | Contents |
|---|---|
| `info-photos` | `general-info/…` = 일반정보수집 images (`mirror-<sha1>.jpg` = copied remote/Instagram images); date folders = 정보보관소 photos |
| `diary-photos` | Diary photos and `themes/<id>/…` |
| `travel-diary-files` | Album originals under `travel-items/…` (`TRAVEL_DIARY_BUCKET` in `lib/supabaseClient.ts`) |
| `travel-diary-private` | `google-drive-auth.json` (Drive refresh token, service-role only) |

Note: `lib/generalInfoHelpers.ts` has its own local `TRAVEL_DIARY_BUCKET = "info-photos"`. Don't confuse the two constants.

### Sync patterns (keep Supabase egress low; the free plan is 5GB/month)
- **Diary autosave:** debounced (0.7s), serialized save queue. Unsynced text is kept in localStorage with `pending: true` and wins on reload. The `[저장]` button flushes the queue immediately.
- **일반정보수집 polling:** every 30s it calls `GET /api/general-info?probe=1`, a small signature over id/title/category/confirmed/created_at. The full list is reloaded only when the signature changes or 5 minutes have passed. The `general-info:reload` window event forces a reload.
- **Album polling:** checks only `travel_albums_state.updated_at_kst` (`probeTravelAlbumsUpdatedAt`).
  - `loadTravelAlbumsFromSupabase` dedupes concurrent loads and reuses results for 3s.
  - Saves call `forgetRecentTravelAlbumsLoad()` so the pre-save merge always reads fresh data.

### Storage pressure → Google Drive
- `lib/storageUsage.ts` measures **all buckets**; `GET /api/storage-usage?summary=1` exposes it. The quota is `NEXT_PUBLIC_SUPABASE_STORAGE_QUOTA_BYTES` (1e9). Both the UI and the archive logic must use this number.
- At ≥80% usage, two archivers run until usage drops below 70%:
  - **Album photos (client side):** `features/personal-album/utils/albumArchiveMigration.ts` compresses in the browser, uploads through `/api/google-drive/upload`, then rewrites the album JSON.
  - **일반정보수집 images (server side):** `lib/generalInfoArchive.ts` via `POST /api/storage-archive`, triggered by `components/StorageArchiveRunner.tsx` in the layout. Steps: download → `sharp` compress → Drive upload and verify → rewrite `general_info_items` URLs → only then delete the Supabase original. `?force=1&only=<path>` works only when `NODE_ENV !== "production"`.
  - Diary, theme and info-vault photos are not archived.
- `lib/googleDrive.ts` holds one owner connection (`drive.file` scope, folder "개인 앨범").
  - Reconnecting with a different Google account is rejected (`DriveOwnerMismatchError`). Optional allowlist env: `GOOGLE_DRIVE_ALLOWED_EMAILS`.
  - The access-token cache is keyed by refresh token. Keep it that way, otherwise the owner check can be bypassed.
  - `/api/google-drive/status` performs a real token refresh and account check (`healthy`, `reason: "token-revoked"`).
  - Drive photos are served through `/api/google-drive/file?id=` with immutable caching. 일반정보수집 rows store the absolute URL (`driveAbsolutePhotoUrl`) because other apps read that data.
  - The OAuth consent screen (GCP project `travel-501405`) is published to production, which is required to avoid 7-day token expiry. `/privacy` exists for that.

### Images coming in
- Browser uploads go through `lib/compressImageFile.ts`. `GENERAL_INFO_COMPRESS` (1920px, q0.82, skip under 600KB) is applied inside the general-info `uploadFileToSupabaseStorage`.
- `/api/extract-url` copies the og:image (including Instagram, whose CDN URLs expire after a few days) into `info-photos` via `lib/mirrorImage.ts` (server-side `sharp`, SSRF-checked redirects).
- `components/LegacyMediaUrlFix.tsx` rewrites URLs that still point at the old Supabase project (`ykumumrvcapnehafexdl`) to the current one, both in the DOM and in localStorage.

### API route security
- Routes use `lib/apiSecurity.ts`: `assertAppApiAccess` (same-origin or `Bearer APP_API_TOKEN`), `isSameOriginRequest`, `assertRateLimit`, and `assertSafePublicHttpUrl` (SSRF guard).
- The app has no user login, so same-origin checks are the main protection for routes with side effects.
- Server routes that need full access create a service-role client from `SUPABASE_SERVICE_ROLE_KEY`.

## Environment
- Set in `.env.local` and in Vercel:
  - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_STORAGE_QUOTA_BYTES`
  - Google Drive and site URL: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `NEXT_PUBLIC_SITE_URL`
  - API access: `APP_API_TOKEN`, `CORS_ALLOWED_ORIGINS`
  - Other services: `GEMINI_API_KEY`, `KMA_SERVICE_KEY`, `GOOGLE_CALENDAR_ICS_URL`, Naver/Google map keys
- `.env.migrate.local` holds the credentials used for the one-time project migration. It is untracked and must not be committed.
