import "server-only";
import { createHash } from "node:crypto";
import { createToken, verifyToken, safeEqual } from "./auth-core";

export const EDIT_COOKIE = "gm_edit";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function editPassword(): string {
  const pw = process.env.EDIT_PASSWORD;
  if (!pw) throw new Error("EDIT_PASSWORD is not set");
  return pw;
}

/** Signing key derived from the edit password — no separate secret env var needed. */
function sessionKey(): string {
  return createHash("sha256").update(`garden-map-session::${editPassword()}`).digest("hex");
}

/** Constant-time check of a submitted password against EDIT_PASSWORD. */
export function checkPassword(input: string): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  return safeEqual(input, editPassword());
}

/** Issue a fresh signed session token. */
export function issueToken(): string {
  return createToken(sessionKey(), SESSION_TTL_SECONDS);
}

/** True when the supplied cookie token is a valid, unexpired session. */
export function isUnlocked(token: string | undefined): boolean {
  if (!process.env.EDIT_PASSWORD) return false;
  return verifyToken(sessionKey(), token);
}
