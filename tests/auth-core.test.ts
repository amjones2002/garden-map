import { describe, it, expect } from "vitest";
import { createToken, verifyToken, safeEqual } from "../src/lib/auth-core";

const SECRET = "test-secret-key";

describe("auth-core", () => {
  it("verifies a freshly created token", () => {
    const t = createToken(SECRET, 3600);
    expect(verifyToken(SECRET, t)).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const t = createToken(SECRET, 3600);
    expect(verifyToken("other-secret", t)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const t = createToken(SECRET, 3600);
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ iat: 0, exp: 9999999999 })).toString("base64url");
    expect(verifyToken(SECRET, `${forged}.${sig}`)).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = 1_000_000;
    const t = createToken(SECRET, 10, now);
    expect(verifyToken(SECRET, t, now + 11)).toBe(false);
    expect(verifyToken(SECRET, t, now + 5)).toBe(true);
  });

  it("rejects malformed tokens", () => {
    expect(verifyToken(SECRET, "")).toBe(false);
    expect(verifyToken(SECRET, "nodot")).toBe(false);
    expect(verifyToken(SECRET, undefined)).toBe(false);
  });

  it("safeEqual compares correctly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
