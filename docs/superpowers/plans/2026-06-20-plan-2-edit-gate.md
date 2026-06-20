# Plan 2 — Edit Gate & Write Infrastructure

**Goal:** A password-gated "edit mode": unlock with `EDIT_PASSWORD` → signed httpOnly cookie → server route handlers perform writes via the service-role client, gated by the cookie. UI exposes an unlock/lock toggle and an `unlocked` flag for later plans.

**Architecture:** Pure HMAC token logic in `auth-core` (testable, no env/no server-only). A server-only `auth` wrapper reads `EDIT_PASSWORD` and derives the signing key. App Router route handlers issue/clear/check the cookie; a `requireEdit()` guard protects write routes. A client `EditModeProvider` context drives the UI.

**Tech:** Next 16 route handlers (`await cookies()` is async), node:crypto HMAC, React context.

## Global constraints
- Service-role key stays server-only. `EDIT_PASSWORD` from `.env.local`.
- Session key derived as `sha256("garden-map-session::" + EDIT_PASSWORD)` — no new env var. Changing the password invalidates sessions (acceptable).
- Cookie `gm_edit`: httpOnly, sameSite=lax, secure in production, path=/, 30-day expiry.
- TDD the pure core; verify routes live.

## Files
- Create `src/lib/auth-core.ts` — pure: `createToken`, `verifyToken`, `safeEqual`
- Create `src/lib/auth.ts` — server-only: `getSessionKey`, `checkPassword`, `issueToken`, `isUnlocked`
- Create `src/app/api/edit/unlock/route.ts` — POST {password} → set cookie
- Create `src/app/api/edit/lock/route.ts` — POST → clear cookie
- Create `src/app/api/edit/status/route.ts` — GET → {unlocked}
- Create `src/lib/require-edit.ts` — server guard returning 401 when locked
- Create `src/app/api/vendors/route.ts` — representative gated write (POST creates vendor)
- Create `src/lib/edit-mode.tsx` — client `EditModeProvider` + `useEditMode()`
- Create `src/components/EditToggle.tsx` — unlock/lock control
- Modify `src/app/layout.tsx` — wrap in provider, render `EditToggle`
- Test `tests/auth-core.test.ts`

## Token format
`token = base64url(payloadJSON) + "." + base64url(HMAC_SHA256(key, payloadJSON))`,
payload `{ iat:number, exp:number }`. Verify: recompute HMAC (constant-time compare), check `exp > now`.

## Tasks

### Task 1: auth-core (TDD)
- [ ] Test `tests/auth-core.test.ts`: roundtrip valid; tampered payload invalid; tampered sig invalid; expired invalid; `safeEqual` true/false.
- [ ] Implement `src/lib/auth-core.ts`.
- [ ] Run tests green. Commit.

### Task 2: server auth wrapper
- [ ] `src/lib/auth.ts` (server-only): derive key from `EDIT_PASSWORD`, `checkPassword` (timingSafeEqual), `issueToken`, `isUnlocked(token)`.
- [ ] Commit.

### Task 3: edit routes
- [ ] `POST /api/edit/unlock`, `POST /api/edit/lock`, `GET /api/edit/status` using `await cookies()`.
- [ ] `src/lib/require-edit.ts` guard.
- [ ] Commit.

### Task 4: representative gated write
- [ ] `POST /api/vendors` — `requireEdit` then insert via service-role client; 401 when locked.
- [ ] Commit.

### Task 5: edit-mode UI
- [ ] `EditModeProvider` + `useEditMode`; `EditToggle`; wire into layout.
- [ ] Commit.

### Task 6: verify + merge
- [ ] `npm test` green, `next build` clean.
- [ ] Live: unlock with correct/incorrect password, status reflects it, gated write 401 when locked / 200 when unlocked.
- [ ] Merge to main, push.
