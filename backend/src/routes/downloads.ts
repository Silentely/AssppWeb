import { Router, Request, Response } from "express";
import { config } from "../config.js";
import {
  createTask,
  getAllTasks,
  getTask,
  deleteTask,
  pauseTask,
  resumeTask,
  addProgressListener,
  removeProgressListener,
  sanitizeTaskForResponse,
  validateDownloadURL,
} from "../services/downloadManager.js";
import {
  getIdParam,
  requireAccountHash,
  verifyTaskOwnership,
} from "../utils/route.js";
import {
  durationMs,
  getRequestId,
  logError,
  logInfo,
  logWarn,
  maskAccountHash,
  safeErrorMessage,
} from "../utils/requestLog.js";

const router = Router();
const LOG_SCOPE = "DownloadsRoute";

function safeSoftwareMeta(software: unknown): Record<string, unknown> {
  if (!software || typeof software !== "object") {
    return {};
  }
  const item = software as Record<string, unknown>;
  return {
    appId: item.id ?? "",
    bundleID: item.bundleID ?? "",
    version: item.version ?? "",
    name: item.name ?? "",
  };
}

async function fetchDownloadSizeBytes(
  downloadURL: string,
  reqId: string,
): Promise<number | null> {
  const startedAt = Date.now();
  logInfo(LOG_SCOPE, reqId, "start apple size probe", {
    downloadHost: (() => {
      try {
        return new URL(downloadURL).host;
      } catch {
        return "";
      }
    })(),
  });

  const headResponse = await fetch(downloadURL, {
    method: "HEAD",
    redirect: "follow",
  });
  if (!headResponse.ok) {
    throw new Error(`HEAD failed: HTTP ${headResponse.status}`);
  }

  const contentLength = parseInt(
    headResponse.headers.get("content-length") || "0",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > 0) {
    logInfo(LOG_SCOPE, reqId, "apple size probe completed via HEAD", {
      fileSizeBytes: contentLength,
      durationMs: durationMs(startedAt),
    });
    return contentLength;
  }

  const rangeResponse = await fetch(downloadURL, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
  });
  try {
    if (rangeResponse.status !== 206 && rangeResponse.status !== 200) {
      throw new Error(`Range probe failed: HTTP ${rangeResponse.status}`);
    }

    const contentRange = rangeResponse.headers.get("content-range") || "";
    const match = contentRange.match(/\/(\d+)\s*$/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        logInfo(LOG_SCOPE, reqId, "apple size probe completed via range", {
          fileSizeBytes: parsed,
          durationMs: durationMs(startedAt),
        });
        return parsed;
      }
    }

    if (rangeResponse.status === 200) {
      const fallbackLength = parseInt(
        rangeResponse.headers.get("content-length") || "0",
        10,
      );
      if (Number.isFinite(fallbackLength) && fallbackLength > 0) {
        logInfo(
          LOG_SCOPE,
          reqId,
          "apple size probe completed via fallback content-length",
          {
            fileSizeBytes: fallbackLength,
            durationMs: durationMs(startedAt),
          },
        );
        return fallbackLength;
      }
    }

    logWarn(LOG_SCOPE, reqId, "apple size probe did not return size", {
      durationMs: durationMs(startedAt),
    });
    return null;
  } finally {
    try {
      await rangeResponse.body?.cancel();
    } catch {
      // best-effort cleanup
    }
  }
}

// Start a new download
router.post("/downloads", async (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const { software, accountHash, downloadURL, sinfs, iTunesMetadata } =
    req.body;

  logInfo(LOG_SCOPE, reqId, "create download request start", {
    hasSoftware: Boolean(software),
    hasAccountHash: Boolean(accountHash),
    hasDownloadURL: Boolean(downloadURL),
    hasSinfs: Boolean(sinfs),
    sinfCount: Array.isArray(sinfs) ? sinfs.length : 0,
    hasITunesMetadata: Boolean(iTunesMetadata),
    accountHash: typeof accountHash === "string" ? maskAccountHash(accountHash) : "",
    ...safeSoftwareMeta(software),
  });

  if (!software || !accountHash || !downloadURL || !sinfs) {
    logWarn(LOG_SCOPE, reqId, "create download missing required fields", {
      durationMs: durationMs(startedAt),
      hasSoftware: Boolean(software),
      hasAccountHash: Boolean(accountHash),
      hasDownloadURL: Boolean(downloadURL),
      hasSinfs: Boolean(sinfs),
    });
    res.status(400).json({
      error:
        "Missing required fields: software, accountHash, downloadURL, sinfs",
    });
    return;
  }

  // Validate download URL before creating task
  try {
    validateDownloadURL(downloadURL);
  } catch (err) {
    logWarn(LOG_SCOPE, reqId, "create download invalid downloadURL", {
      durationMs: durationMs(startedAt),
      message: safeErrorMessage(err),
    });
    res.status(400).json({
      error: err instanceof Error ? err.message : "Invalid download URL",
    });
    return;
  }

  if (config.maxDownloadMB > 0) {
    try {
      const fileSizeBytes = await fetchDownloadSizeBytes(downloadURL, reqId);
      if (!fileSizeBytes) {
        logWarn(LOG_SCOPE, reqId, "create download size check returned empty", {
          durationMs: durationMs(startedAt),
        });
        res.status(400).json({
          error: "Unable to verify file size from Apple",
        });
        return;
      }
      const sizeMB = fileSizeBytes / (1024 * 1024);
      if (sizeMB > config.maxDownloadMB) {
        logWarn(LOG_SCOPE, reqId, "create download exceeded max size", {
          sizeMB: Number(sizeMB.toFixed(2)),
          maxDownloadMB: config.maxDownloadMB,
          durationMs: durationMs(startedAt),
        });
        res.status(413).json({
          error: `File size exceeds the maximum limit of ${config.maxDownloadMB} MB`,
        });
        return;
      }
    } catch (err) {
      logError(LOG_SCOPE, reqId, "create download size probe failed", {
        message: safeErrorMessage(err),
        durationMs: durationMs(startedAt),
      });
      res.status(502).json({ error: "Failed to verify file size from Apple" });
      return;
    }
  }

  try {
    const task = createTask(
      software,
      accountHash,
      downloadURL,
      sinfs,
      iTunesMetadata,
    );
    logInfo(LOG_SCOPE, reqId, "create download request completed", {
      taskId: task.id,
      status: task.status,
      accountHash: maskAccountHash(task.accountHash),
      ...safeSoftwareMeta(task.software),
      durationMs: durationMs(startedAt),
    });
    res.status(201).json(sanitizeTaskForResponse(task));
  } catch (err) {
    logError(LOG_SCOPE, reqId, "create download request failed", {
      message: safeErrorMessage(err),
      durationMs: durationMs(startedAt),
    });
    res.status(400).json({ error: "Failed to create download" });
  }
});

// List downloads filtered by account hashes
router.get("/downloads", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const hashesParam = req.query.accountHashes;
  if (!hashesParam || typeof hashesParam !== "string") {
    logWarn(LOG_SCOPE, reqId, "list downloads without valid accountHashes", {
      durationMs: durationMs(startedAt),
    });
    res.json([]);
    return;
  }
  const hashes = new Set(hashesParam.split(",").filter(Boolean));
  if (hashes.size === 0) {
    logWarn(LOG_SCOPE, reqId, "list downloads empty accountHashes set", {
      durationMs: durationMs(startedAt),
    });
    res.json([]);
    return;
  }
  const filtered = getAllTasks()
    .filter((t) => hashes.has(t.accountHash))
    .map(sanitizeTaskForResponse);
  logInfo(LOG_SCOPE, reqId, "list downloads completed", {
    hashCount: hashes.size,
    resultCount: filtered.length,
    durationMs: durationMs(startedAt),
  });
  res.json(filtered);
});

// Get single download (requires accountHash)
router.get("/downloads/:id", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) {
    logWarn(LOG_SCOPE, reqId, "get download missing accountHash", {
      downloadId: getIdParam(req),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    logWarn(LOG_SCOPE, reqId, "get download not found", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) {
    logWarn(LOG_SCOPE, reqId, "get download ownership check failed", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  logInfo(LOG_SCOPE, reqId, "get download completed", {
    downloadId: id,
    status: task.status,
    accountHash: maskAccountHash(accountHash),
    durationMs: durationMs(startedAt),
  });
  res.json(sanitizeTaskForResponse(task));
});

// SSE progress stream (requires accountHash)
router.get("/downloads/:id/progress", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) {
    logWarn(LOG_SCOPE, reqId, "open progress stream missing accountHash", {
      downloadId: getIdParam(req),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    logWarn(LOG_SCOPE, reqId, "open progress stream download not found", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) {
    logWarn(LOG_SCOPE, reqId, "open progress stream ownership check failed", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send current state immediately
  res.write(`data: ${JSON.stringify(sanitizeTaskForResponse(task))}\n\n`);
  logInfo(LOG_SCOPE, reqId, "progress stream opened", {
    downloadId: id,
    status: task.status,
    accountHash: maskAccountHash(accountHash),
    durationMs: durationMs(startedAt),
  });

  const listener = (updatedTask: typeof task) => {
    res.write(
      `data: ${JSON.stringify(sanitizeTaskForResponse(updatedTask))}\n\n`,
    );
  };

  addProgressListener(id, listener);

  req.on("close", () => {
    removeProgressListener(id, listener);
    logInfo(LOG_SCOPE, reqId, "progress stream closed", {
      downloadId: id,
      durationMs: durationMs(startedAt),
    });
  });
});

// Pause download (requires accountHash)
router.post("/downloads/:id/pause", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) {
    logWarn(LOG_SCOPE, reqId, "pause download missing accountHash", {
      downloadId: getIdParam(req),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    logWarn(LOG_SCOPE, reqId, "pause download not found", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) {
    logWarn(LOG_SCOPE, reqId, "pause download ownership check failed", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const success = pauseTask(id);
  if (!success) {
    logWarn(LOG_SCOPE, reqId, "pause download rejected", {
      downloadId: id,
      status: task.status,
      durationMs: durationMs(startedAt),
    });
    res.status(400).json({ error: "Cannot pause this download" });
    return;
  }
  const updated = getTask(id);
  logInfo(LOG_SCOPE, reqId, "pause download completed", {
    downloadId: id,
    status: updated?.status ?? "",
    durationMs: durationMs(startedAt),
  });
  res.json(updated ? sanitizeTaskForResponse(updated) : { success: true });
});

// Resume download (requires accountHash)
router.post("/downloads/:id/resume", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) {
    logWarn(LOG_SCOPE, reqId, "resume download missing accountHash", {
      downloadId: getIdParam(req),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    logWarn(LOG_SCOPE, reqId, "resume download not found", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) {
    logWarn(LOG_SCOPE, reqId, "resume download ownership check failed", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const success = resumeTask(id);
  if (!success) {
    logWarn(LOG_SCOPE, reqId, "resume download rejected", {
      downloadId: id,
      status: task.status,
      durationMs: durationMs(startedAt),
    });
    res.status(400).json({ error: "Cannot resume this download" });
    return;
  }
  const updated = getTask(id);
  logInfo(LOG_SCOPE, reqId, "resume download completed", {
    downloadId: id,
    status: updated?.status ?? "",
    durationMs: durationMs(startedAt),
  });
  res.json(updated ? sanitizeTaskForResponse(updated) : { success: true });
});

// Delete download (requires accountHash)
router.delete("/downloads/:id", (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const startedAt = Date.now();
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) {
    logWarn(LOG_SCOPE, reqId, "delete download missing accountHash", {
      downloadId: getIdParam(req),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    logWarn(LOG_SCOPE, reqId, "delete download not found", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) {
    logWarn(LOG_SCOPE, reqId, "delete download ownership check failed", {
      downloadId: id,
      accountHash: maskAccountHash(accountHash),
      durationMs: durationMs(startedAt),
    });
    return;
  }

  const success = deleteTask(id);
  if (!success) {
    logWarn(LOG_SCOPE, reqId, "delete download failed", {
      downloadId: id,
      durationMs: durationMs(startedAt),
    });
    res.status(404).json({ error: "Download not found" });
    return;
  }
  logInfo(LOG_SCOPE, reqId, "delete download completed", {
    downloadId: id,
    accountHash: maskAccountHash(accountHash),
    durationMs: durationMs(startedAt),
  });
  res.json({ success: true });
});

export default router;
