import { describe, it, expect } from "vitest";
import { maskAccountHash } from "../src/utils/requestLog.js";

describe("maskAccountHash", () => {
  it("returns empty string for empty input", () => {
    expect(maskAccountHash("")).toBe("");
  });

  it("fully masks overly short values", () => {
    expect(maskAccountHash("short")).toBe("****");
    expect(maskAccountHash("12345678901")).toBe("****");
  });

  it("keeps first 6 and last 4 of normal-length hashes", () => {
    const hash = "abcdef1234567890";
    expect(maskAccountHash(hash)).toBe("abcdef...7890");
  });

  it("keeps real 64-char sha256 hashes masked in the middle", () => {
    const hash = "a".repeat(64);
    expect(maskAccountHash(hash)).toBe(`${"a".repeat(6)}...${"a".repeat(4)}`);
    expect(maskAccountHash(hash)).not.toContain(hash.slice(6, 60));
  });
});
