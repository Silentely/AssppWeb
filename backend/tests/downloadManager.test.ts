import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// 使用临时数据目录，避免测试污染工作区（须在导入模块前设置）
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asspp-dl-test-"));
process.env.DATA_DIR = tmpDataDir;

vi.mock("../src/services/chunkedDownloader.js", () => {
  class MockChunkedDownloader {
    url: string;
    destPath: string;
    options?: unknown;

    constructor(url: string, destPath: string, options?: unknown) {
      this.url = url;
      this.destPath = destPath;
      this.options = options;
    }

    download(_signal: AbortSignal): Promise<void> {
      throw new Error("download must be mocked");
    }

    abort(): void {}
  }
  return { ChunkedDownloader: MockChunkedDownloader };
});

vi.mock("../src/services/sinfInjector.js", () => ({
  inject: vi.fn().mockResolvedValue(undefined),
}));

import { ChunkedDownloader } from "../src/services/chunkedDownloader.js";
import {
  createTask,
  pauseTask,
  resumeTask,
  deleteTask,
  getTask,
} from "../src/services/downloadManager.js";
import type { Software, Sinf } from "../src/types/index.js";

const software: Software = {
  id: 1,
  bundleID: "com.example.test",
  name: "Test App",
  version: "1.0",
  artistName: "Example",
  sellerName: "Example",
  description: "",
  averageUserRating: 0,
  userRatingCount: 0,
  artworkUrl: "",
  screenshotUrls: [],
  minimumOsVersion: "12.0",
  releaseDate: "2026-01-01",
  primaryGenreName: "Utilities",
};

const sinfs: Sinf[] = [{ id: 1, sinf: "c2luZg==" }];

// 下载 URL 需通过 *.apple.com 白名单校验
const VALID_URL = "https://p25-buy.itunes.apple.com/download/abc.ipa";
const ACCOUNT_HASH = "a".repeat(64);

/** 让下载挂起，直到外部释放；abort 时以 AbortError 拒绝 */
function hangDownload() {
  return new Promise<void>((resolve, reject) => {
    vi.spyOn(ChunkedDownloader.prototype, "download").mockImplementation(
      (signal) =>
        new Promise<void>((res, rej) => {
          signal.addEventListener(
            "abort",
            () => rej(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
          resolve = res;
          reject = rej;
        }),
    );
  });
}

describe("downloadManager task lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it("creates a task and supports pause/resume to completion", async () => {
    let release!: () => void;
    vi.spyOn(ChunkedDownloader.prototype, "download").mockImplementation(
      () =>
        new Promise<void>((res) => {
          release = res;
        }),
    );

    const task = createTask(software, ACCOUNT_HASH, VALID_URL, sinfs);
    expect(getTask(task.id)?.status).toBe("downloading");

    expect(pauseTask(task.id)).toBe(true);
    expect(getTask(task.id)?.status).toBe("paused");
    // 已暂停的任务不能再次暂停
    expect(pauseTask(task.id)).toBe(false);

    expect(resumeTask(task.id)).toBe(true);
    expect(getTask(task.id)?.status).toBe("downloading");

    release();
    await vi.waitFor(() => {
      expect(getTask(task.id)?.status).toBe("completed");
    });
    // 完成后敏感字段已被清除
    const done = getTask(task.id);
    expect(done?.downloadURL).toBe("");
    expect(done?.sinfs).toHaveLength(0);
  });

  it("removes an in-progress task on delete without resurrecting it", async () => {
    hangDownload();
    const abortSpy = vi.spyOn(ChunkedDownloader.prototype, "abort");

    const task = createTask(software, ACCOUNT_HASH, VALID_URL, sinfs);
    expect(getTask(task.id)?.status).toBe("downloading");

    expect(deleteTask(task.id)).toBe(true);
    expect(getTask(task.id)).toBeUndefined();
    // 下载器被中止，避免底层连接继续占用
    expect(abortSpy).toHaveBeenCalled();

    // 让异步下载流程完成收尾（触发 catch），已删除任务不应被回写
    await vi.waitFor(() => {
      expect(getTask(task.id)).toBeUndefined();
    });
  });

  it("marks a task as failed when the download rejects", async () => {
    vi.spyOn(ChunkedDownloader.prototype, "download").mockRejectedValue(
      new Error("connection reset"),
    );

    const task = createTask(software, ACCOUNT_HASH, VALID_URL, sinfs);
    await vi.waitFor(() => {
      expect(getTask(task.id)?.status).toBe("failed");
    });
    expect(getTask(task.id)?.error).toBe("Download failed");
  });
});
