import type { Response } from "express";

const CONSOLE_METHOD: Record<string, "log" | "warn" | "error"> = {
  info: "log",
  warn: "warn",
  error: "error",
};

function write(
  level: "info" | "warn" | "error",
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
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
