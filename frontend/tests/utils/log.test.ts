import { describe, it, expect, vi, afterEach } from "vitest";
import { log, setDebugEnabled } from "../../src/utils/log";

describe("log utility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setDebugEnabled(false);
  });

  it("suppresses info level when debug is disabled", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    setDebugEnabled(false);
    log.info("Scope", "hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits info level when debug is enabled", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    setDebugEnabled(true);
    log.info("Scope", "hello", { a: 1 });
    expect(spy).toHaveBeenCalledWith("[Scope] hello", { a: 1 });
  });

  it("always emits warn and error regardless of debug flag", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDebugEnabled(false);
    log.warn("Scope", "warn message");
    log.error("Scope", "error message");
    expect(warnSpy).toHaveBeenCalledWith("[Scope] warn message", "");
    expect(errorSpy).toHaveBeenCalledWith("[Scope] error message", "");
  });

  it("suppresses debug level when debug is disabled", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    setDebugEnabled(false);
    log.debug("Scope", "debug message");
    expect(spy).not.toHaveBeenCalled();
  });
});
