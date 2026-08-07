import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { config, DOWNLOAD_TIMEOUT_MS } from "../config.js";
import { inject } from "./sinfInjector.js";
import { ChunkedDownloader } from "./chunkedDownloader.js";
import type { DownloadTask, Software, Sinf } from "../types/index.js";
import { logError, logInfo, logWarn, safeErrorMessage } from "../utils/requestLog.js";

const tasks = new Map<string, DownloadTask>();
const abortControllers = new Map<string, AbortController>();
const chunkDownloaders = new Map<string, ChunkedDownloader>();
const progressListeners = new Map<string, Set<(task: DownloadTask) => void>>();
// 每个任务的全局下载超时定时器，暂停/删除/完成时必须同步清理，避免泄漏
const taskTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const LOG_SCOPE = "DownloadManager";

const PACKAGES_DIR = path.join(config.dataDir, "packages");
const TASKS_FILE = path.join(config.dataDir, "tasks.json");
// 旧版代码遗留文件，启动时清理
const LEGACY_DOWNLOADS_FILE = path.join(config.dataDir, "downloads.json");

function clearTaskTimeout(id: string): void {
  const timer = taskTimeouts.get(id);
  if (timer) {
    clearTimeout(timer);
    taskTimeouts.delete(id);
  }
}

// --- 安全：路径段校验 ---
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

/** 校验并净化路径段：拒绝路径穿越，替换不安全字符。 */
function safePathSegment(value: string, label: string): string {
  if (!value || value === "." || value === "..") {
    throw new Error(`Invalid ${label}`);
  }
  if (SAFE_SEGMENT_RE.test(value)) return value;
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`Invalid ${label}`);
  }
  return cleaned;
}

// --- 安全：下载 URL 白名单 ---
const ALLOWED_DOWNLOAD_HOSTS_RE = /\.apple\.com$/i;

export function validateDownloadURL(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid download URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Download URL must use HTTPS");
  }

  if (!ALLOWED_DOWNLOAD_HOSTS_RE.test(parsed.hostname)) {
    throw new Error("Download URL must be from an Apple domain (*.apple.com)");
  }

  if (
    /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) ||
    parsed.hostname.startsWith("[")
  ) {
    throw new Error("Download URL must not use IP addresses");
  }
}

// --- 安全：对外响应前清洗任务字段 ---
export function sanitizeTaskForResponse(
  task: DownloadTask,
): Omit<
  DownloadTask,
  "downloadURL" | "sinfs" | "iTunesMetadata" | "filePath"
> & { hasFile?: boolean } {
  const { downloadURL, sinfs, iTunesMetadata, filePath, ...safe } = task;
  return {
    ...safe,
    hasFile: !!filePath && fs.existsSync(filePath),
  };
}

// --- 持久化：仅保存已完成任务的元数据（不含机密） ---
function persistTasks() {
  const completed = Array.from(tasks.values())
    .filter((t) => t.status === "completed" && t.filePath)
    .map((t) => ({
      id: t.id,
      software: t.software,
      accountHash: t.accountHash,
      downloadURL: "",
      sinfs: [],
      status: t.status,
      progress: t.progress,
      speed: t.speed,
      filePath: t.filePath,
      createdAt: t.createdAt,
    }));
  fs.writeFileSync(TASKS_FILE, JSON.stringify(completed, null, 2));
}

// 自动清理：删除超过配置天数的已完成文件
export function runTimeCleanup() {
  const { autoCleanupDays } = config;
  if (autoCleanupDays <= 0) return;
  const cutoff = Date.now() - autoCleanupDays * 24 * 60 * 60 * 1000;

  // 先收集待删 ID，避免遍历时修改 map
  const expiredIds: string[] = [];
  for (const task of tasks.values()) {
    if (
      task.status === "completed" &&
      task.filePath &&
      fs.existsSync(task.filePath)
    ) {
      try {
        const stat = fs.statSync(task.filePath);
        if (stat.mtimeMs < cutoff) {
          expiredIds.push(task.id);
        }
      } catch {
        // 文件不可访问——跳过
      }
    }
  }

  for (const id of expiredIds) {
    logInfo(LOG_SCOPE, `cleanup:${id}`, "deleting expired task", {
      reason: "time-based",
    });
    deleteTask(id);
  }
}

// 自动清理：总大小超限时淘汰最旧的已完成文件
export function runSpaceCleanup() {
  const { autoCleanupMaxMB } = config;
  if (autoCleanupMaxMB <= 0) return;
  const maxBytes = autoCleanupMaxMB * 1024 * 1024;

  let totalBytes = 0;
  const fileTasks: { id: string; size: number; mtimeMs: number }[] = [];

  for (const task of tasks.values()) {
    if (
      task.status === "completed" &&
      task.filePath &&
      fs.existsSync(task.filePath)
    ) {
      try {
        const stat = fs.statSync(task.filePath);
        totalBytes += stat.size;
        fileTasks.push({ id: task.id, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // 文件不可访问——跳过
      }
    }
  }

  if (totalBytes <= maxBytes) return;

  fileTasks.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const ft of fileTasks) {
    logInfo(LOG_SCOPE, `cleanup:${ft.id}`, "deleting task to free space", {
      reason: "space-based",
      fileSizeBytes: ft.size,
    });
    deleteTask(ft.id);
    totalBytes -= ft.size;
    if (totalBytes <= maxBytes) break;
  }
}

// 每日零点定时清理（自校正避免漂移）
function scheduleDailyCleanup() {
  function msUntilMidnight(): number {
    const now = new Date();
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
    );
    return next.getTime() - now.getTime();
  }

  function tick() {
    runTimeCleanup();
    setTimeout(tick, msUntilMidnight());
  }

  setTimeout(tick, msUntilMidnight());
}

function initOnStartup() {
  // 移除旧版代码遗留的 downloads.json
  if (fs.existsSync(LEGACY_DOWNLOADS_FILE)) {
    fs.unlinkSync(LEGACY_DOWNLOADS_FILE);
  }

  // 确保 packages 目录存在
  fs.mkdirSync(PACKAGES_DIR, { recursive: true });

  // 从上次运行恢复已完成任务
  if (fs.existsSync(TASKS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
      if (Array.isArray(data)) {
        for (const item of data) {
          // 仅恢复 IPA 文件仍然存在的已完成任务
          if (
            item.id &&
            item.status === "completed" &&
            item.filePath &&
            fs.existsSync(item.filePath)
          ) {
            const task: DownloadTask = {
              id: item.id,
              software: item.software,
              accountHash: item.accountHash,
              downloadURL: "",
              sinfs: [],
              status: "completed",
              progress: 100,
              speed: "0 B/s",
              filePath: item.filePath,
              createdAt: item.createdAt,
            };
            tasks.set(task.id, task);
          }
        }
      }
    } catch {
      // 文件损坏——从空状态开始
    }
  }

  // 清理孤儿分块临时文件（.ipa.partN）
  cleanOrphanedTempChunks();

  // 启动时先执行一次时间清理，再安排每日任务
  runTimeCleanup();
  scheduleDailyCleanup();
}

function cleanOrphanedTempChunks() {
  const knownPaths = new Set<string>();
  for (const task of tasks.values()) {
    if (task.filePath) {
      knownPaths.add(path.resolve(task.filePath));
    }
  }

  const packagesBase = path.resolve(PACKAGES_DIR);

  function walkAndClean(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndClean(fullPath);
        // 清理空目录
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else if (
        entry.isFile() &&
        !knownPaths.has(path.resolve(fullPath)) &&
        /\.ipa\.part\d+$/.test(entry.name)
      ) {
        // 删除遗留的分块临时文件，但保留孤立的 .ipa 成品
        fs.unlinkSync(fullPath);
      }
    }
  }

  walkAndClean(packagesBase);
}

// 启动时初始化
initOnStartup();

function notifyProgress(task: DownloadTask) {
  const listeners = progressListeners.get(task.id);
  if (listeners) {
    for (const listener of listeners) {
      listener(task);
    }
  }
}

export function addProgressListener(
  taskId: string,
  listener: (task: DownloadTask) => void,
) {
  let listeners = progressListeners.get(taskId);
  if (!listeners) {
    listeners = new Set();
    progressListeners.set(taskId, listeners);
  }
  listeners.add(listener);
}

export function removeProgressListener(
  taskId: string,
  listener: (task: DownloadTask) => void,
) {
  const listeners = progressListeners.get(taskId);
  if (listeners) {
    listeners.delete(listener);
    if (listeners.size === 0) {
      progressListeners.delete(taskId);
    }
  }
}

export function getAllTasks(): DownloadTask[] {
  return Array.from(tasks.values());
}

export function getTask(id: string): DownloadTask | undefined {
  return tasks.get(id);
}

export function deleteTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task) return false;

  logInfo(LOG_SCOPE, `task:${id}`, "delete task start", {
    status: task.status,
    hasFilePath: Boolean(task.filePath),
  });

  // 下载中则中止并清理关联资源与超时定时器
  clearTaskTimeout(id);
  const controller = abortControllers.get(id);
  if (controller) {
    controller.abort();
    abortControllers.delete(id);
  }
  const downloader = chunkDownloaders.get(id);
  if (downloader) {
    downloader.abort();
    chunkDownloaders.delete(id);
  }

  // 文件存在则删除（带路径安全检查）
  if (task.filePath) {
    const resolved = path.resolve(task.filePath);
    const packagesBase = path.resolve(PACKAGES_DIR);
    if (
      resolved.startsWith(packagesBase + path.sep) &&
      fs.existsSync(resolved)
    ) {
      fs.unlinkSync(resolved);

      // 清理空的父目录
      let dir = path.dirname(resolved);
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
  }

  tasks.delete(id);
  progressListeners.delete(id);
  persistTasks();
  logInfo(LOG_SCOPE, `task:${id}`, "delete task completed");
  return true;
}

export function pauseTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task || task.status !== "downloading") return false;

  logInfo(LOG_SCOPE, `task:${id}`, "pause task requested");

  // 暂停时同步清理超时定时器，避免残留定时器在后台空转
  clearTaskTimeout(id);
  const controller = abortControllers.get(id);
  if (controller) {
    controller.abort();
    abortControllers.delete(id);
  }
  const downloader = chunkDownloaders.get(id);
  if (downloader) {
    downloader.abort();
    chunkDownloaders.delete(id);
  }

  task.status = "paused";
  notifyProgress(task);
  logInfo(LOG_SCOPE, `task:${id}`, "pause task completed");
  return true;
}

export function resumeTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task || task.status !== "paused") return false;

  logInfo(LOG_SCOPE, `task:${id}`, "resume task requested");
  startDownload(task);
  return true;
}

export function createTask(
  software: Software,
  accountHash: string,
  downloadURL: string,
  sinfs: Sinf[],
  iTunesMetadata?: string,
): DownloadTask {
  // 校验下载 URL
  validateDownloadURL(downloadURL);

  // 校验路径段
  safePathSegment(accountHash, "accountHash");
  safePathSegment(software.bundleID, "bundleID");
  safePathSegment(software.version, "version");

  const task: DownloadTask = {
    id: uuidv4(),
    software,
    accountHash,
    downloadURL,
    sinfs,
    iTunesMetadata,
    status: "pending",
    progress: 0,
    speed: "0 B/s",
    createdAt: new Date().toISOString(),
  };

  tasks.set(task.id, task);
  logInfo(LOG_SCOPE, `task:${task.id}`, "task created", {
    bundleID: task.software.bundleID,
    version: task.software.version,
    status: task.status,
  });
  startDownload(task);
  return task;
}

async function startDownload(task: DownloadTask) {
  const traceId = `task:${task.id}`;
  const startedAt = Date.now();
  logInfo(LOG_SCOPE, traceId, "download start", {
    bundleID: task.software.bundleID,
    version: task.software.version,
  });

  // 下载前清理：过期文件 + 空间上限
  runTimeCleanup();
  runSpaceCleanup();

  const controller = new AbortController();
  abortControllers.set(task.id, controller);

  // 为整个下载设置全局超时，并登记以便暂停/删除时清理
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  taskTimeouts.set(task.id, timeout);

  task.status = "downloading";
  task.progress = 0;
  task.speed = "0 B/s";
  task.error = undefined;
  notifyProgress(task);

  // 净化路径段
  const safeAccountHash = safePathSegment(task.accountHash, "accountHash");
  const safeBundleID = safePathSegment(task.software.bundleID, "bundleID");
  const safeVersion = safePathSegment(task.software.version, "version");

  const dir = path.join(
    PACKAGES_DIR,
    safeAccountHash,
    safeBundleID,
    safeVersion,
  );

  // 确认解析后的路径仍在 PACKAGES_DIR 内
  const resolvedDir = path.resolve(dir);
  const packagesBase = path.resolve(PACKAGES_DIR);
  if (!resolvedDir.startsWith(packagesBase + path.sep)) {
    clearTaskTimeout(task.id);
    task.status = "failed";
    task.error = "Invalid path";
    notifyProgress(task);
    logWarn(LOG_SCOPE, traceId, "download failed due to invalid path");
    return;
  }

  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${task.id}.ipa`);
  task.filePath = filePath;

  try {
    // 拉取前再次校验下载 URL
    validateDownloadURL(task.downloadURL);

    const downloader = new ChunkedDownloader(task.downloadURL, filePath, {
      onProgress: (info) => {
        task.speed = info.speed;
        if (info.total > 0) {
          task.progress = Math.round((info.downloaded / info.total) * 100);
        }
        notifyProgress(task);
      },
    });
    chunkDownloaders.set(task.id, downloader);

    await downloader.download(controller.signal);
    logInfo(LOG_SCOPE, traceId, "download transfer completed");

    chunkDownloaders.delete(task.id);
    abortControllers.delete(task.id);
    clearTaskTimeout(task.id);

    // 注入 sinf 签名
    if (task.sinfs.length > 0) {
      task.status = "injecting";
      task.progress = 100;
      notifyProgress(task);
      logInfo(LOG_SCOPE, traceId, "sinf injection start", {
        sinfCount: task.sinfs.length,
      });

      await inject(task.sinfs, filePath, task.iTunesMetadata);
      logInfo(LOG_SCOPE, traceId, "sinf injection completed");
    }

    task.status = "completed";
    task.progress = 100;

    // 编译成功后清除敏感数据
    task.downloadURL = "";
    task.sinfs = [];
    task.iTunesMetadata = undefined;

    // 持久化已完成任务元数据（不含机密）
    persistTasks();
    notifyProgress(task);
    logInfo(LOG_SCOPE, traceId, "download task completed", {
      durationMs: Date.now() - startedAt,
      filePath,
    });
  } catch (err) {
    chunkDownloaders.delete(task.id);
    abortControllers.delete(task.id);
    clearTaskTimeout(task.id);

    // 任务已被 deleteTask() 移除时，仅清理资源，不再回写状态
    if (tasks.get(task.id) !== task) {
      return;
    }

    if (err instanceof Error && err.name === "AbortError") {
      // 状态可能已被 pauseTask() 在外部改为 paused
      if ((task.status as string) === "paused") {
        logInfo(LOG_SCOPE, traceId, "download aborted due to pause request");
        return;
      }
      task.status = "failed";
      task.error = "Download timed out";
      notifyProgress(task);
      logWarn(LOG_SCOPE, traceId, "download aborted by timeout", {
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    task.status = "failed";
    logError(LOG_SCOPE, traceId, "download failed", {
      message: safeErrorMessage(err),
      durationMs: Date.now() - startedAt,
    });
    task.error = "Download failed";
    notifyProgress(task);
  }
}
