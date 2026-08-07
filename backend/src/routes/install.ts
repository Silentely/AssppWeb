import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { getAllTasks } from "../services/downloadManager.js";
import { buildManifest, getWhitePng } from "../services/manifestBuilder.js";
import { getIdParam } from "../utils/route.js";
import {
  durationMs,
  getRequestId,
  logInfo,
  logWarn,
} from "../utils/requestLog.js";

const router = Router();
const LOG_SCOPE = "InstallRoute";

export function getBaseUrl(req: Request): string {
  const configured = normalizeBaseUrl(config.publicBaseUrl);
  if (configured) return configured;

  // 信任 x-forwarded-proto 判断协议（安全，仅影响 URL scheme），
  // 但直接使用 host 头（而非 x-forwarded-host）防止开放重定向
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = forwardedProto === "https" || req.secure ? "https" : "http";
  const host = req.headers["host"] || "localhost";

  // 校验 host 头防止注入
  const sanitizedHost = host.replace(/[^\w.\-:]/g, "");

  // 支持 X-Forwarded-Port：反向代理剥离 Host 头端口时使用。
  // 常见于非 443 端口部署 HTTPS（如 nginx 配置 $host 而非 $http_host）。
  // 若不处理，manifest plist 的 URL 会默认落到 443 端口，iOS 将无法拉取 payload。
  if (!sanitizedHost.includes(":")) {
    const forwardedPort = req.headers["x-forwarded-port"];
    if (typeof forwardedPort === "string") {
      const port = forwardedPort.replace(/\D/g, "");
      const isDefault =
        (proto === "https" && port === "443") ||
        (proto === "http" && port === "80");
      if (port && !isDefault) {
        return `${proto}://${sanitizedHost}:${port}`;
      }
    }
  }

  return `${proto}://${sanitizedHost}`;
}

function normalizeBaseUrl(value?: string): string {
  if (!value) return "";
  return value.trim().replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

// iTMS 安装用的 manifest plist
router.get("/install/:id/manifest.plist", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const id = getIdParam(req);
  logInfo(LOG_SCOPE, reqId, "manifest request start", { taskId: id });
  const task = getAllTasks().find(
    (t) => t.id === id && t.status === "completed",
  );

  if (!task || !task.filePath) {
    logWarn(LOG_SCOPE, reqId, "manifest request package not found", {
      taskId: id,
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Package not found" });
    return;
  }

  const baseUrl = getBaseUrl(req);
  const payloadUrl = joinUrl(baseUrl, `/api/install/${id}/payload.ipa`);
  const smallIconUrl = joinUrl(baseUrl, `/api/install/${id}/icon-small.png`);
  const largeIconUrl = joinUrl(baseUrl, `/api/install/${id}/icon-large.png`);

  const manifest = buildManifest(
    task.software,
    payloadUrl,
    smallIconUrl,
    largeIconUrl,
  );

  res.setHeader("Content-Type", "application/xml");
  logInfo(LOG_SCOPE, reqId, "manifest request completed", {
    taskId: id,
    bundleID: task.software.bundleID,
    version: task.software.version,
    durationMs: durationMs(startedAt),
  });
  res.send(manifest);
});

router.get("/install/:id/url", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const id = getIdParam(req);
  logInfo(LOG_SCOPE, reqId, "install url request start", { taskId: id });
  const task = getAllTasks().find(
    (t) => t.id === id && t.status === "completed",
  );

  if (!task || !task.filePath) {
    logWarn(LOG_SCOPE, reqId, "install url request package not found", {
      taskId: id,
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Package not found" });
    return;
  }

  const baseUrl = getBaseUrl(req);
  const manifestUrl = joinUrl(baseUrl, `/api/install/${id}/manifest.plist`);
  const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(
    manifestUrl,
  )}`;

  logInfo(LOG_SCOPE, reqId, "install url request completed", {
    taskId: id,
    manifestUrl,
    durationMs: durationMs(startedAt),
  });
  res.json({ installUrl, manifestUrl });
});

// 流式返回 IPA payload 供安装
router.get("/install/:id/payload.ipa", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const id = getIdParam(req);
  logInfo(LOG_SCOPE, reqId, "payload stream request start", { taskId: id });
  const task = getAllTasks().find(
    (t) => t.id === id && t.status === "completed",
  );

  if (!task || !task.filePath || !fs.existsSync(task.filePath)) {
    logWarn(LOG_SCOPE, reqId, "payload stream package not found", {
      taskId: id,
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Package not found" });
    return;
  }

  // 确认文件路径位于 packages 目录内
  const packagesBase = path.resolve(path.join(config.dataDir, "packages"));
  const resolvedPath = path.resolve(task.filePath);
  if (!resolvedPath.startsWith(packagesBase + path.sep)) {
    logWarn(LOG_SCOPE, reqId, "payload stream path validation failed", {
      taskId: id,
      durationMs: durationMs(startedAt),
    });
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.setHeader("Content-Type", "application/octet-stream");
  const stats = fs.statSync(resolvedPath);
  res.setHeader("Content-Length", stats.size);
  logInfo(LOG_SCOPE, reqId, "payload stream started", {
    taskId: id,
    fileSizeBytes: stats.size,
    durationMs: durationMs(startedAt),
  });

  const stream = fs.createReadStream(resolvedPath);
  stream.on("close", () => {
    logInfo(LOG_SCOPE, reqId, "payload stream completed", {
      taskId: id,
    });
  });
  stream.pipe(res);
});

// 小尺寸图标占位图（57x57）
router.get("/install/:id/icon-small.png", (_req: Request, res: Response) => {
  const png = getWhitePng();
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", png.length);
  res.send(png);
});

// 大尺寸图标占位图（512x512）
router.get("/install/:id/icon-large.png", (_req: Request, res: Response) => {
  const png = getWhitePng();
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", png.length);
  res.send(png);
});

export default router;
