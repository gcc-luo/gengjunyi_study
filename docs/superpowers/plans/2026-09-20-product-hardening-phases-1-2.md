# Product hardening phases 1 and 2

## Goal

Implement the highest-value product corrections identified during the product review: make production access explicit, separate parent-wide data from child-scoped data, make upload failures actionable, make video removal recoverable, persist the child catalog preference on the server, improve upload/search semantics, and record viewing events with correct pause/play meaning.

## Architecture

Keep the current PostgreSQL + MinIO architecture and the existing React Query remote store. Add a small server-owned settings resource rather than another client-side state system. Keep child catalog reads on the existing `/api/child/courses` endpoint and keep parent management reads on `/api/courses`. Change video deletion into archive/restore so learning history remains intact. Retain the local-storage fallback for the local demo provider only.

## Tech Stack

TypeScript, React 18, React Router, TanStack Query, Fastify, Prisma PostgreSQL, Vitest, Testing Library, Playwright.

## For agentic workers

Run each task in order. Before changing production code, add or update a failing test. Preserve unrelated untracked files in the workspace. Run the focused test after each task and the full verification suite before claiming completion.

## Phase 1 — safety and data boundaries

### Task 1: Add a real login route and secure production defaults

Files:

- Modify `src/App.tsx`.
- Add `src/features/auth/LoginPage.tsx` and its tests.
- Modify `src/context/AuthProvider.tsx` only where navigation/session refresh requires it.
- Modify `server/src/config.ts`, `ops/.env.production.example`, `ops/compose.production.yaml`, and `README.md`.
- Update `src/App.test.tsx` and `server/test/app.test.ts`.

Steps:

1. Add a failing UI test that an unauthenticated private route redirects to `/login` and that the login form posts credentials, refreshes the session, and returns to the requested path.
2. Add the login page with accessible email/password fields, loading state, server error state, and a safe `next` path (same-origin relative path only).
3. Change `RequireAuth` to navigate unauthenticated users to login and keep the existing service-error state for session-check failures.
4. Make `AUTH_BYPASS` default true only in development and false in production/test unless explicitly configured. Update production examples and README to document explicit bootstrap/login instead of public bypass.
5. Run focused frontend and server config/auth tests.

### Task 2: Separate parent-wide reporting from child content

Files:

- Modify `server/src/routes/learning.ts` and `server/src/routes/records.ts`.
- Modify `src/context/AppStore.tsx` and child pages that read the catalog.
- Update route and remote-store tests.

Steps:

1. Add failing tests proving an active child selection does not narrow `/api/overview` or an unfiltered parent `/api/records` request, while an explicit `childId` filter remains supported and scoped.
2. Make `/api/overview` and `/api/records` parent-wide by default; only apply a child filter when the parent explicitly requests one.
3. Add remote child catalog queries using `/api/child/courses` and expose child catalog data separately from parent management data.
4. Update child home/course/watch pages to use the child catalog and keep local-provider behavior unchanged.
5. Run focused route/store/child tests.

### Task 3: Make upload compatibility failures actionable

Files:

- Modify `src/features/parent/UploadsPage.tsx` and upload tests.
- Modify `server/src/services/media-validation.ts` only if the returned reason needs clearer diagnostics.
- Update README upload guidance.

Steps:

1. Add failing tests for rejecting non-MP4 files before creating an upload and for showing codec-specific server validation guidance.
2. Centralize upload error mapping so H.264, AAC, MOV/MP4, duration, and unreadable-media errors are shown in concise Chinese product copy.
3. Keep server-side ffprobe validation as the source of truth; do not pretend browser extension checks can verify codecs.
4. Run upload page and media-validation tests.

### Task 4: Replace destructive video deletion with recoverable archive/restore

Files:

- Modify `server/src/services/uploads.ts`, `server/src/routes/videos.ts`, and `src/context/AppStore.tsx`.
- Modify `src/features/parent/CourseDetail.tsx` and parent UI tests.
- Update upload route tests and add a Prisma migration only if the existing `ARCHIVED` status is insufficient.

Steps:

1. Add failing tests proving archive preserves watch progress/events/favorites and does not delete the media object; add restore tests.
2. Implement archive as an idempotent status change, aborting only active multipart uploads. Keep quota accounting correct and retain stored objects for restoration.
3. Add `POST /api/videos/:videoId/restore` with object-existence validation and client-store support.
4. Replace destructive wording with archive/restore wording and show archived entries in the parent catalog with a restore action.
5. Run focused upload/video/course tests.

## Phase 2 — consistency and usability

### Task 5: Persist the family child-catalog preference

Files:

- Modify `server/prisma/schema.prisma` and add a migration.
- Add `server/src/routes/settings.ts` and register it in `server/src/app.ts`.
- Modify `src/features/parent/SettingsPage.tsx`, `src/features/child/CoursesPage.tsx`, and preference tests.

Steps:

1. Add failing route/UI tests for reading and updating `freeChoice` per authenticated admin.
2. Add a server-owned key/value preference model with a unique admin/key constraint and default `freeChoice=true`.
3. Add `GET/PATCH /api/settings`, query it in both parent settings and child course views, and retain local-storage fallback only for local demo mode/eye-care.
4. Run migration generation, focused route/UI tests, and server type generation.

### Task 6: Fix global search semantics and upload task recovery copy

Files:

- Modify `src/components/ParentShell.tsx`, `src/features/parent/CoursesPage.tsx`, and related tests.
- Modify `src/features/parent/UploadsPage.tsx` and related tests.

Steps:

1. Add failing tests for the global search label and navigation behavior.
2. Make the global search promise match its behavior (course/video management search), or route to a small result state that clearly includes the supported result types.
3. Replace “重新选择原文件即可继续” with explicit states for resumable versus restart-required tasks, and keep server completion reconciliation visible.
4. Run focused parent tests.

### Task 7: Correct play/pause event semantics and verification

Files:

- Modify `src/features/child/WatchPage.tsx`, `src/context/AppStore.tsx`, and `server/src/routes/learning.ts`.
- Update playback/progress tests and add an E2E assertion where practical.

Steps:

1. Add a failing test showing a native pause emits `PAUSE` with `isPlaying=false` and does not count pause time as watched.
2. Track event type independently from the previous playing state; use explicit `PLAY`, `PAUSE`, `SEEK`, and `ENDED` events while preserving heartbeat `PROGRESS` events.
3. Verify seek/resume keeps the signed playback URL stable and displays the target position during buffering.
4. Run full frontend, server, E2E, and build verification.

## Verification

Run:

- `npm test -- --run`
- `npm run test:server`
- `npm run build`
- `npm run test:e2e`

Review `git diff --check`, `git status --short`, and the final diff before commit/push.
