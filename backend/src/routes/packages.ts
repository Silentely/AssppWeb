import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { MIN_ACCOUNT_HASH_LENGTH } from "../config.js";
import { getAllTasks } from "../services/downloadManager.js";
import { getIdParam } from "../utils/route.js";
import {
  durationMs,
  getRequestId,
  logInfo,
  logDebug,
  logWarn,
  maskAccountHash,
} from "../utils/requestLog.js";
import type { PackageInfo } from "../types/index.js";

const router = Router();
const LOG_SCOPE = "PackagesRoute";

// 净化 Content-Disposition 文件名，防止响应头注入
function sanitizeFilename(name: string): string {
  // 移除控制字符、引号、反斜杠与非 ASCII 字符
  return name
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/[\r\n]/g, "")
    .slice(0, 200);
}

// 按账号哈希过滤列出包
router.get("/packages", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const hashesParam = req.query.accountHashes;
  if (!hashesParam || typeof hashesParam !== "string") {
    logWarn(LOG_SCOPE, reqId, "list packages without valid accountHashes", {
      durationMs: durationMs(startedAt),
    });
    res.json([]);
    return;
  }
  const hashes = new Set(hashesParam.split(",").filter(Boolean));
  if (hashes.size === 0) {
    logWarn(LOG_SCOPE, reqId, "list packages empty accountHashes set", {
      durationMs: durationMs(startedAt),
    });
    res.json([]);
    return;
  }

  const packages: Omit<PackageInfo, "filePath">[] = [];
  const completedTasks = getAllTasks().filter(
    (t) => t.status === "completed" && t.filePath && hashes.has(t.accountHash),
  );

  for (const task of completedTasks) {
    if (!task.filePath || !fs.existsSync(task.filePath)) continue;

    // 优先使用任务完成时缓存的大小，避免对每个文件重复 stat
    let fileSize = task.fileSize;
    if (fileSize === undefined) {
      try {
        fileSize = fs.statSync(task.filePath).size;
      } catch {
        continue;
      }
    }
    packages.push({
      id: task.id,
      software: task.software,
      accountHash: task.accountHash,
      fileSize,
      createdAt: task.createdAt,
    });
  }

  // 首页/下载页均会轮询该接口，使用 debug 级日志避免刷屏
  logDebug(LOG_SCOPE, reqId, "list packages completed", {
    hashCount: hashes.size,
    resultCount: packages.length,
    durationMs: durationMs(startedAt),
  });
  res.json(packages);
});

// 流式返回 IPA 文件（需 accountHash）
router.get("/packages/:id/file", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const accountHash = req.query.accountHash as string;
  if (!accountHash || accountHash.length < MIN_ACCOUNT_HASH_LENGTH) {
    logWarn(LOG_SCOPE, reqId, "download package file missing accountHash", {
      packageId: getIdParam(req),
      durationMs: durationMs(startedAt),
    });
    res.status(400).json({ error: "Missing or invalid accountHash" });
    return;
  }

  const id = getIdParam(req);
  const task = getAllTasks().find(
    (t) => t.id === id && t.status === "completed",
  );

  if (!task || !task.filePath || !fs.existsSync(task.filePath)) {
    logWarn(LOG_SCOPE, reqId, "download package file not found", {
      packageId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Package not found" });
    return;
  }

  if (task.accountHash !== accountHash) {
    logWarn(LOG_SCOPE, reqId, "download package file ownership check failed", {
      packageId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // 确认文件路径位于 packages 目录内
  const packagesBase = path.resolve(path.join(config.dataDir, "packages"));
  const resolvedPath = path.resolve(task.filePath);
  if (!resolvedPath.startsWith(packagesBase + path.sep)) {
    logWarn(LOG_SCOPE, reqId, "download package file path validation failed", {
      packageId: id,
      durationMs: durationMs(startedAt),
    });
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const safeName = sanitizeFilename(task.software.name);
  const safeVersion = sanitizeFilename(task.software.version);
  const fileName = `${safeName}_${safeVersion}.ipa`;
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Type", "application/octet-stream");

  const fileSize = task.fileSize ?? fs.statSync(resolvedPath).size;
  res.setHeader("Content-Length", fileSize);
  logInfo(LOG_SCOPE, reqId, "download package file stream started", {
    packageId: id,
    accountHash: maskAccountHash(accountHash),
    fileSizeBytes: fileSize,
    durationMs: durationMs(startedAt),
  });

  const stream = fs.createReadStream(resolvedPath);
  stream.on("close", () => {
    logInfo(LOG_SCOPE, reqId, "download package file stream completed", {
      packageId: id,
    });
  });
  stream.pipe(res);
});

// 删除包（需 accountHash）
router.delete("/packages/:id", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const accountHash = req.query.accountHash as string;
  if (!accountHash || accountHash.length < MIN_ACCOUNT_HASH_LENGTH) {
    logWarn(LOG_SCOPE, reqId, "delete package missing accountHash", {
      packageId: getIdParam(req),
      durationMs: durationMs(startedAt),
    });
    res.status(400).json({ error: "Missing or invalid accountHash" });
    return;
  }

  const id = getIdParam(req);
  const packagesDir = path.join(config.dataDir, "packages");
  const packagesBase = path.resolve(packagesDir);

  const task = getAllTasks().find((t) => t.id === id);
  if (!task || !task.filePath) {
    logWarn(LOG_SCOPE, reqId, "delete package not found", {
      packageId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Package not found" });
    return;
  }

  if (task.accountHash !== accountHash) {
    logWarn(LOG_SCOPE, reqId, "delete package ownership check failed", {
      packageId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // 确认文件路径位于 packages 目录内
  const resolvedPath = path.resolve(task.filePath);
  if (!resolvedPath.startsWith(packagesBase + path.sep)) {
    logWarn(LOG_SCOPE, reqId, "delete package path validation failed", {
      packageId: id,
      durationMs: durationMs(startedAt),
    });
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);

    // 清理空的父目录
    let dir = path.dirname(resolvedPath);
    while (dir !== packagesBase && dir.startsWith(packagesBase)) {
      const contents = fs.readdirSync(dir);
      if (contents.length === 0) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      } else {
        break;
      }
    }
  }

  logInfo(LOG_SCOPE, reqId, "delete package completed", {
    packageId: id,
    accountHash: maskAccountHash(accountHash),
    durationMs: durationMs(startedAt),
  });
  res.json({ success: true });
});

export default router;
