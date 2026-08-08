import type { Response } from "express";

const CONSOLE_METHOD: Record<string, "log" | "warn" | "error" | "debug"> = {
  info: "log",
  warn: "warn",
  error: "error",
  debug: "debug",
};

// 调试日志开关：默认静默，避免高频轮询接口刷屏；排障时设 LOG_DEBUG=true
const DEBUG_ENABLED = process.env.LOG_DEBUG === "true";

function write(
  level: "info" | "warn" | "error" | "debug",
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (level === "debug" && !DEBUG_ENABLED) {
    return;
  }
  const line = `[${new Date().toISOString()}] [${scope}] [${requestId}] ${message}`;
  const method = CONSOLE_METHOD[level];
  if (meta) {
    console[method](line, meta);
    return;
  }
  console[method](line);
}

export function getRequestId(res: Response): string {
  const requestId = res.locals?.requestId;
  if (typeof requestId === "string" && requestId.trim()) {
    return requestId.trim();
  }
  return "missing-request-id";
}

export function logInfo(
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  write("info", scope, requestId, message, meta);
}

export function logWarn(
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  write("warn", scope, requestId, message, meta);
}

export function logError(
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  write("error", scope, requestId, message, meta);
}

// 调试级日志：仅 LOG_DEBUG=true 时输出。
// 用于高频轮询等噪音来源，默认静默但保留排障能力。
export function logDebug(
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  write("debug", scope, requestId, message, meta);
}

// 系统级日志：无请求上下文时使用固定 scope 与 requestId，
// 保持与请求日志一致的结构化格式，便于统一收集与过滤
export function logSystem(
  message: string,
  meta?: Record<string, unknown>,
): void {
  write("info", "System", "system", message, meta);
}

// 账号哈希应视为敏感标识：过短的值直接整体掩码，正常值保留首尾便于关联日志
export function maskAccountHash(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length < 12) {
    return "****";
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function durationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export function safeHeaderValue(
  value: string | string[] | undefined,
  maxLength: number = 96,
): string {
  const raw = Array.isArray(value) ? value.join(", ") : value ?? "";
  if (raw.length <= maxLength) {
    return raw;
  }
  return `${raw.slice(0, maxLength)}...`;
}
