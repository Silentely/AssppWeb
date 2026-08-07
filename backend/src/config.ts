import { createHash } from "crypto";
import { timingSafeEqual } from "crypto";

export const config = {
  port: parseInt(process.env.PORT || "8080"),
  dataDir: process.env.DATA_DIR || "./data",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  disableHttpsRedirect:
    process.env.UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT === "true",
  serpApiKey: process.env.SERPAPI_KEY || "",
  serpApiTimeoutMs:
    Math.max(
      1000,
      parseInt(process.env.SERPAPI_TIMEOUT_MS || "15000", 10) || 15000,
    ),
  searchDebug: process.env.SEARCH_DEBUG === "true",
  // 自动清理：0 表示禁用
  autoCleanupDays: parseInt(process.env.AUTO_CLEANUP_DAYS || "0", 10) || 0,
  autoCleanupMaxMB: parseInt(process.env.AUTO_CLEANUP_MAX_MB || "0", 10) || 0,
  // 最大下载文件大小（MB），0 表示禁用
  maxDownloadMB: parseInt(process.env.MAX_DOWNLOAD_MB || "0", 10) || 0,
  // 构建信息（由 Docker 构建参数注入）
  buildCommit: process.env.BUILD_COMMIT || "unknown",
  buildDate: process.env.BUILD_DATE || "unknown",
  // 访问口令保护（为空表示禁用）
  accessPassword: process.env.ACCESS_PASSWORD || "",
};

export const accessPasswordHash = config.accessPassword
  ? createHash("sha256").update(config.accessPassword).digest("hex")
  : "";

/** 常量时间比较客户端令牌与预计算哈希，避免时序侧信道。 */
export function verifyAccessToken(token: string): boolean {
  const expected = Buffer.from(accessPasswordHash, "utf8");
  const actual = Buffer.from(token, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const MAX_DOWNLOAD_SIZE = 8 * 1024 * 1024 * 1024; // 8 GB
export const DOWNLOAD_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 小时
export const BAG_TIMEOUT_MS = 15_000; // 15 秒
export const BAG_MAX_BYTES = 1024 * 1024; // 1 MB
export const MIN_ACCOUNT_HASH_LENGTH = 8;

// 分块下载配置
export const DOWNLOAD_THREADS = Math.max(
  1,
  Math.min(32, parseInt(process.env.DOWNLOAD_THREADS || "8", 10) || 8),
);
export const CHUNK_RETRY_COUNT = 3;
export const CHUNK_RETRY_DELAY_MS = 2000;
