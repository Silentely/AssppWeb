// 前端统一日志工具。
// 目标：默认静默，避免每个操作 3-5 条 info 日志刷屏；需要排障时一键开启。
// 开启方式（任选其一）：
//   1. URL 追加 ?debug=1（如 https://host/?debug=1）
//   2. localStorage 设置 asspp-debug=1
// 开启后输出 info/debug 级日志；warn/error 始终输出。

const DEBUG_KEY = "asspp-debug";

let cachedDebug: boolean | null = null;

function isDebugEnabled(): boolean {
  if (cachedDebug !== null) return cachedDebug;
  try {
    const fromUrl =
      typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("debug") === "1";
    const fromStorage =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(DEBUG_KEY) === "1";
    cachedDebug = fromUrl || fromStorage;
  } catch {
    cachedDebug = false;
  }
  return cachedDebug;
}

/** 显式刷新调试开关（供测试或运行时切换）。 */
export function setDebugEnabled(enabled: boolean): void {
  cachedDebug = enabled;
}

type LogLevel = "debug" | "info" | "warn" | "error";

function write(
  level: LogLevel,
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const line = `[${scope}] ${message}`;
  if (level === "debug" || level === "info") {
    if (!isDebugEnabled()) return;
    (level === "debug" ? console.debug : console.info)(line, meta ?? "");
    return;
  }
  (level === "warn" ? console.warn : console.error)(line, meta ?? "");
}

export const log = {
  debug: (scope: string, message: string, meta?: Record<string, unknown>) =>
    write("debug", scope, message, meta),
  info: (scope: string, message: string, meta?: Record<string, unknown>) =>
    write("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: Record<string, unknown>) =>
    write("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: Record<string, unknown>) =>
    write("error", scope, message, meta),
};
