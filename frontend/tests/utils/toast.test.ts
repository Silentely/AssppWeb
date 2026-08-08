import { describe, it, expect } from "vitest";
import { getTaskErrorMessage } from "../../src/utils/toast";

// 轻量 i18n 桩：仅返回键名，验证映射走对路径
const stubT = ((key: string) => `translated:${key}`) as any;

describe("getTaskErrorMessage", () => {
  it("maps known errorCode to localized message", () => {
    const task = { error: "Download timed out", errorCode: "timeout" };
    expect(getTaskErrorMessage(task, stubT)).toBe(
      "translated:errors.downloadTask.timeout",
    );
  });

  it("maps too-large errorCode", () => {
    const task = { error: "File too large", errorCode: "too-large" };
    expect(getTaskErrorMessage(task, stubT)).toBe(
      "translated:errors.downloadTask.tooLarge",
    );
  });

  it("falls back to raw error for unknown errorCode", () => {
    const task = { error: "Something weird", errorCode: "unknown-code" };
    expect(getTaskErrorMessage(task, stubT)).toBe("Something weird");
  });

  it("falls back to unknownError when error and errorCode are missing", () => {
    const task = {};
    expect(getTaskErrorMessage(task, stubT)).toBe(
      "translated:toast.unknownError",
    );
  });
});
