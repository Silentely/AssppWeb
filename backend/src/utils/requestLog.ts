import type { Response } from "express";

function write(
  level: "info" | "warn" | "error",
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const line = `[${scope}] [${requestId}] ${message}`;
  if (level === "warn") {
    if (meta) {
      console.warn(line, meta);
      return;
    }
    console.warn(line);
    return;
  }
  if (level === "error") {
    if (meta) {
      console.error(line, meta);
      return;
    }
    console.error(line);
    return;
  }
  if (meta) {
    console.log(line, meta);
    return;
  }
  console.log(line);
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

export function maskAccountHash(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 12) {
    return value;
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
