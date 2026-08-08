import type { TFunction } from "i18next";
import { storeIdToCountry } from "../apple/config";
import type { Account, DownloadTask } from "../types";

export interface AccountContext {
  userName: string;
  appleId: string;
  country: string;
}

// 后端下载任务错误码 → i18n 键的映射。
// 后端返回稳定错误码（errorCode），前端据此展示本地化文案；
// 未知错误码或缺失时回退到后端英文原文，避免用户看到空白。
const TASK_ERROR_KEYS: Record<string, string> = {
  timeout: "errors.downloadTask.timeout",
  failed: "errors.downloadTask.failed",
  "too-large": "errors.downloadTask.tooLarge",
  "invalid-path": "errors.downloadTask.invalidPath",
};

/** 将下载任务的错误信息映射为用户友好的本地化文案。 */
export function getTaskErrorMessage(
  task: Pick<DownloadTask, "error" | "errorCode">,
  t: TFunction,
): string {
  if (task.errorCode) {
    const key = TASK_ERROR_KEYS[task.errorCode];
    if (key) return t(key);
  }
  return task.error || t("toast.unknownError");
}

/**
 * Extract display-friendly account context for toast notifications.
 * Centralises the repeated pattern of building userName / appleId / country.
 */
export function getAccountContext(
  account: Account | undefined,
  t: TFunction,
): AccountContext {
  if (!account) {
    return {
      userName: t("toast.unknownAccount"),
      appleId: t("toast.unknownAccount"),
      country: t("toast.unknownAccount"),
    };
  }
  const userName = `${account.firstName} ${account.lastName}`;
  const appleId = account.email;
  const rawCountryCode = storeIdToCountry(account.store) || "";
  const country = rawCountryCode
    ? t(`countries.${rawCountryCode}`, rawCountryCode)
    : account.store;
  return { userName, appleId, country };
}
