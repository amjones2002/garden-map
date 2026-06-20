import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function sign(secret: string, payloadB64: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Create a signed session token: base64url(payload) + "." + base64url(hmac).
 * @param ttlSeconds lifetime in seconds
 * @param now epoch seconds (defaults to current time) — injectable for tests
 */
export function createToken(secret: string, ttlSeconds: number, now = Math.floor(Date.now() / 1000)): string {
  const payload = { iat: now, exp: now + ttlSeconds };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(secret, payloadB64)}`;
}

/**
 * Verify a session token's signature and expiry.
 * @param now epoch seconds (defaults to current time) — injectable for tests
 */
export function verifyToken(secret: string, token: string | undefined, now = Math.floor(Date.now() / 1000)): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return false;
  if (!safeEqual(sig, sign(secret, payloadB64))) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number") return false;
    return payload.exp > now;
  } catch {
    return false;
  }
}
