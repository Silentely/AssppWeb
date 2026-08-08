import { useTranslation } from "react-i18next";
import { useAccounts } from "./useAccounts";
import { useToastStore } from "../store/toast";
import { useDownloadsStore } from "../store/downloads";
import { getDownloadInfo, isDownloadAuthExpired } from "../apple/download";
import { isPurchaseAuthExpired, purchaseApp } from "../apple/purchase";
import { authenticate } from "../apple/authenticate";
import { storeIdToCountry } from "../apple/config";
import { apiPost, apiGet } from "../api/client";
import { lookupApp } from "../api/search";
import { accountHash } from "../utils/account";
import { getErrorMessage } from "../utils/error";
import { getAccountContext } from "../utils/toast";
import { log } from "../utils/log";
import type { Account, Software } from "../types";

const LOG_PREFIX = "[DownloadAction]";

/**
 * 下载与购买动作的共享 Hook，
 * 消除 ProductDetail、VersionHistory、AddDownload 之间的重复流程。
 */
export function useDownloadAction() {
  const { updateAccount } = useAccounts();
  const addToast = useToastStore((s) => s.addToast);
  const fetchTasks = useDownloadsStore((s) => s.fetchTasks);
  const { t } = useTranslation();

  async function reauthenticate(account: Account): Promise<Account> {
    const renewed = await authenticate(
      account.email,
      account.password,
      undefined,
      account.cookies,
      account.deviceIdentifier,
    );
    await updateAccount(renewed);
    return renewed;
  }

  async function resolveCanonicalApp(
    account: Account,
    app: Software,
  ): Promise<Software> {
    const country = storeIdToCountry(account.store) ?? "US";
    log.info(LOG_PREFIX, "app normalization start", {
      appId: app.id,
      bundleID: app.bundleID,
      country,
    });
    try {
      const resolved = await lookupApp(app.bundleID, country);
      if (resolved?.id) {
        if (resolved.id !== app.id) {
          log.warn(LOG_PREFIX, "app id normalized from lookup", {
            originalId: app.id,
            resolvedId: resolved.id,
            bundleID: app.bundleID,
            country,
          });
        }
        log.info(LOG_PREFIX, "app normalization completed", {
          sourceId: app.id,
          effectiveId: resolved.id,
          bundleID: resolved.bundleID,
          country,
        });
        return resolved;
      }
    } catch (error) {
      log.warn(LOG_PREFIX, "app normalization lookup failed", {
        bundleID: app.bundleID,
        country,
        message: getErrorMessage(error, "lookup failed"),
      });
    }

    log.warn(LOG_PREFIX, "app normalization fallback to original", {
      appId: app.id,
      bundleID: app.bundleID,
      country,
    });
    return app;
  }

  async function startDownload(
    account: Account,
    app: Software,
    versionId?: string,
  ) {
    log.info(LOG_PREFIX, "start download flow", {
      appId: app.id,
      bundleID: app.bundleID,
      versionId: versionId ?? "",
      store: account.store,
      pod: account.pod ?? "",
    });
    const effectiveApp = await resolveCanonicalApp(account, app);
    const ctx = getAccountContext(account, t);
    const appName = effectiveApp.name;

    try {
      const settings = await apiGet<{ maxDownloadMB: number }>("/api/settings");
      if (settings.maxDownloadMB > 0 && effectiveApp.fileSizeBytes) {
        const sizeMB = parseInt(effectiveApp.fileSizeBytes, 10) / (1024 * 1024);
        if (sizeMB > settings.maxDownloadMB) {
          addToast(
            t("toast.downloadLimit.message", {
              appName,
              size: sizeMB.toFixed(2),
              limit: settings.maxDownloadMB,
            }),
            "error",
            t("toast.title.downloadLimit"),
          );
          return;
        }
      }
    } catch {
      // 设置获取失败时由后端兜底执行同一大小限制
      log.warn(LOG_PREFIX, "settings pre-check failed, continue", {
        appId: effectiveApp.id,
        bundleID: effectiveApp.bundleID,
      });
    }

    let currentAccount = account;
    let downloadResult: Awaited<ReturnType<typeof getDownloadInfo>>;
    try {
      downloadResult = await getDownloadInfo(currentAccount, effectiveApp, versionId);
    } catch (error) {
      if (!isDownloadAuthExpired(error)) {
        throw error;
      }
      currentAccount = await reauthenticate(currentAccount);
      downloadResult = await getDownloadInfo(currentAccount, effectiveApp, versionId);
    }

    const { output, updatedCookies } = downloadResult;
    log.info(LOG_PREFIX, "apple download info acquired", {
      appId: effectiveApp.id,
      bundleID: effectiveApp.bundleID,
      version: output.bundleShortVersionString,
      sinfCount: output.sinfs.length,
      hasMetadata: Boolean(output.iTunesMetadata),
    });
    await updateAccount({ ...currentAccount, cookies: updatedCookies });
    const hash = await accountHash(currentAccount);

    await apiPost("/api/downloads", {
      software: {
        ...effectiveApp,
        version: output.bundleShortVersionString,
      },
      accountHash: hash,
      downloadURL: output.downloadURL,
      sinfs: output.sinfs,
      iTunesMetadata: output.iTunesMetadata,
    });
    log.info(LOG_PREFIX, "backend download task created", {
      appId: effectiveApp.id,
      bundleID: effectiveApp.bundleID,
      accountHash: hash,
    });

    fetchTasks();

    addToast(
      t("toast.msg", {
        appName,
        version: ` v${output.bundleShortVersionString}`,
        ...ctx,
      }),
      "info",
      t("toast.title.downloadStarted"),
    );
  }

  async function acquireLicense(account: Account, app: Software) {
    log.info(LOG_PREFIX, "acquire license flow", {
      appId: app.id,
      bundleID: app.bundleID,
      store: account.store,
      pod: account.pod ?? "",
    });
    const effectiveApp = await resolveCanonicalApp(account, app);
    const ctx = getAccountContext(account, t);
    const appName = effectiveApp.name;

    let currentAccount = account;
    let result: Awaited<ReturnType<typeof purchaseApp>>;
    try {
      result = await purchaseApp(currentAccount, effectiveApp);
    } catch (error) {
      if (!isPurchaseAuthExpired(error)) {
        throw error;
      }
      currentAccount = await reauthenticate(currentAccount);
      result = await purchaseApp(currentAccount, effectiveApp);
    }

    await updateAccount({ ...currentAccount, cookies: result.updatedCookies });
    log.info(LOG_PREFIX, "license acquired", {
      appId: effectiveApp.id,
      bundleID: effectiveApp.bundleID,
      store: currentAccount.store,
      pod: currentAccount.pod ?? "",
    });

    addToast(
      t("toast.msg", {
        appName,
        version: ` v${effectiveApp.version}`,
        ...ctx,
      }),
      "success",
      t("toast.title.licenseSuccess"),
    );
  }

  function toastDownloadError(account: Account, app: Software, error: unknown) {
    const ctx = getAccountContext(account, t);
    log.error(LOG_PREFIX, "download flow failed", {
      appId: app.id,
      bundleID: app.bundleID,
      store: account.store,
      pod: account.pod ?? "",
      message: getErrorMessage(error, t("toast.title.downloadFailed")),
    });
    addToast(
      t("toast.msgFailed", {
        appName: app.name,
        version: ` v${app.version}`,
        ...ctx,
        error: getErrorMessage(error, t("toast.title.downloadFailed")),
      }),
      "error",
      t("toast.title.downloadFailed"),
    );
  }

  function toastLicenseError(account: Account, app: Software, error: unknown) {
    const ctx = getAccountContext(account, t);
    log.error(LOG_PREFIX, "license flow failed", {
      appId: app.id,
      bundleID: app.bundleID,
      store: account.store,
      pod: account.pod ?? "",
      message: getErrorMessage(error, t("toast.title.licenseFailed")),
    });
    addToast(
      t("toast.msgFailed", {
        appName: app.name,
        version: ` v${app.version}`,
        ...ctx,
        error: getErrorMessage(error, t("toast.title.licenseFailed")),
      }),
      "error",
      t("toast.title.licenseFailed"),
    );
  }

  return {
    startDownload,
    acquireLicense,
    toastDownloadError,
    toastLicenseError,
  };
}
