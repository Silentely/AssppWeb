import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import {
  durationMs,
  safeHeaderValue,
  logInfo,
  logWarn,
} from "../utils/requestLog.js";

const TRACE_SCOPE = "ApiTrace";

function normalizeRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  // Keep request IDs header-safe and reasonably bounded.
  if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) {
    return null;
  }
  return value;
}

export function requestTrace(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  const headerValue = Array.isArray(req.headers["x-request-id"])
    ? req.headers["x-request-id"][0]
    : req.headers["x-request-id"];
  const requestId = normalizeRequestId(headerValue) ?? randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  logInfo(TRACE_SCOPE, requestId, "request start", {
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    userAgent: safeHeaderValue(req.headers["user-agent"], 120),
  });

  res.on("finish", () => {
    logInfo(TRACE_SCOPE, requestId, "request finish", {
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: durationMs(startedAt),
    });
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      logWarn(TRACE_SCOPE, requestId, "request aborted by client", {
        method: req.method,
        path: req.originalUrl || req.url,
        durationMs: durationMs(startedAt),
      });
    }
  });

  next();
}
