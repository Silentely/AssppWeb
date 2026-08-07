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
  // 限制请求 ID 为响应头安全字符集与合理长度
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

  // 每个请求只输出一行完成日志（含全部元数据），
  // 相比 start/finish 双行可显著降低高频轮询接口的日志量。
  res.on("finish", () => {
    logInfo(TRACE_SCOPE, requestId, "request", {
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
      userAgent: safeHeaderValue(req.headers["user-agent"], 120),
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
