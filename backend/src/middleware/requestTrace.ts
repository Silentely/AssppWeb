import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import {
  durationMs,
  safeHeaderValue,
  logInfo,
  logDebug,
  logWarn,
} from "../utils/requestLog.js";

const TRACE_SCOPE = "ApiTrace";

// 高频轮询接口：GET 列表类端点（无资源 id 子路径）。
// 这些请求每 2s 由前端轮询一次，走 debug 级日志避免刷屏。
const POLLABLE_PATHS = new Set(["/api/downloads", "/api/packages"]);

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
  // 轮询类 GET 列表接口进一步降级为 debug，避免每 2s 一行的噪音。
  res.on("finish", () => {
    const isPollable =
      req.method === "GET" && POLLABLE_PATHS.has(req.path);
    const meta = {
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
      userAgent: safeHeaderValue(req.headers["user-agent"], 120),
      statusCode: res.statusCode,
      durationMs: durationMs(startedAt),
    };
    if (isPollable) {
      logDebug(TRACE_SCOPE, requestId, "request", meta);
    } else {
      logInfo(TRACE_SCOPE, requestId, "request", meta);
    }
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
