import { useTranslation } from "react-i18next";
import { useAccounts } from "./useAccounts";
import { useToastStore } from "../store/toast";
import { useDownloadsStore } from "../store/downloads";
import { getDownloadInfo } from "../apple/download";
import { purchaseApp } from "../apple/purchase";
import { authenticate } from "../apple/authenticate";
import { storeIdToCountry } from "../apple/config";
import { apiPost, apiGet } from "../api/client";
import { lookupApp } from "../api/search";
import { accountHash } from "../utils/account";
import { getErrorMessage } from "../utils/error";
import { getAccountContext } from "../utils/toast";
import type { Account, Software } from "../types";

const LOG_PREFIX = "[DownloadAction]";

/**
 * Shared hook for download & purchase actions.
 * Eliminates the duplicated flow across ProductDetail, VersionHistory, and AddDownload.
 */
export function useDownloadAction() {
  const { updateAccount } = useAccounts();
  const addToast = useToastStore((s) => s.addToast);
  const fetchTasks = useDownloadsStore((s) => s.fetchTasks);
  const { t } = useTranslation();

  async function resolveCanonicalApp(
    account: Account,
    app: Software,
  ): Promise<Software> {
    const country = storeIdToCountry(account.store) ?? "US";
    console.info(`${LOG_PREFIX} app normalization start`, {
      appId: app.id,
      bundleID: app.bundleID,
      country,
    });
    try {
      const resolved = await lookupApp(app.bundleID, country);
      if (resolved?.id) {
        if (resolved.id !== app.id) {
          console.warn(`${LOG_PREFIX} app id normalized from lookup`, {
            originalId: app.id,
            resolvedId: resolved.id,
            bundleID: app.bundleID,
            country,
          });
        }
        console.info(`${LOG_PREFIX} app normalization completed`, {
          sourceId: app.id,
          effectiveId: resolved.id,
          bundleID: resolved.bundleID,
          country,
        });
        return resolved;
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} app normalization lookup failed`, {
        bundleID: app.bundleID,
        country,
        message: getErrorMessage(error, "lookup failed"),
      });
    }

    console.warn(`${LOG_PREFIX} app normalization fallback to original`, {
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
    console.info(`${LOG_PREFIX} start download flow`, {
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
      // Settings fetch failed — backend will still enforce the limit
      console.warn(`${LOG_PREFIX} settings pre-check failed, continue`, {
        appId: effectiveApp.id,
        bundleID: effectiveApp.bundleID,
      });
    }

    const { output, updatedCookies } = await getDownloadInfo(
      account,
      effectiveApp,
      versionId,
    );
    console.info(`${LOG_PREFIX} apple download info acquired`, {
      appId: effectiveApp.id,
      bundleID: effectiveApp.bundleID,
      version: output.bundleShortVersionString,
      sinfCount: output.sinfs.length,
      hasMetadata: Boolean(output.iTunesMetadata),
    });
    await updateAccount({ ...account, cookies: updatedCookies });
    const hash = await accountHash(account);

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
    console.info(`${LOG_PREFIX} backend download task created`, {
      appId: effectiveApp.id,
      bundleID: effectiveApp.bundleID,
      accountHash: hash,
    });

    fetchTasks();

    addToast(
      t("toast.msg", { appName, ...ctx }),
      "info",
      t("toast.title.downloadStarted"),
    );
  }

  async function acquireLicense(account: Account, app: Software) {
    console.info(`${LOG_PREFIX} acquire license flow`, {
      appId: app.id,
      bundleID: app.bundleID,
      store: account.store,
      pod: account.pod ?? "",
    });
    const effectiveApp = await resolveCanonicalApp(account, app);
    const ctx = getAccountContext(account, t);
    const appName = effectiveApp.name;

    // Silently renew the password token before purchasing.
    // This prevents "token expired" (2034/2042) errors that would
    // otherwise require the user to manually re-authenticate.
    let currentAccount = account;
    try {
      const renewed = await authenticate(
        account.email,
        account.password,
        undefined,
        account.cookies,
        account.deviceIdentifier,
      );
      await updateAccount(renewed);
      currentAccount = renewed;
      console.info(`${LOG_PREFIX} token renewed before purchase`, {
        appId: effectiveApp.id,
        bundleID: effectiveApp.bundleID,
        store: renewed.store,
        pod: renewed.pod ?? "",
      });
    } catch {
      // Ignore — proceed with existing token
      console.warn(`${LOG_PREFIX} token renew failed, use existing token`, {
        appId: effectiveApp.id,
        bundleID: effectiveApp.bundleID,
      });
    }

    const result = await purchaseApp(currentAccount, effectiveApp);
    await updateAccount({ ...currentAccount, cookies: result.updatedCookies });
    console.info(`${LOG_PREFIX} license acquired`, {
      appId: effectiveApp.id,
      bundleID: effectiveApp.bundleID,
      store: currentAccount.store,
      pod: currentAccount.pod ?? "",
    });

    addToast(
      t("toast.msg", { appName, ...ctx }),
      "success",
      t("toast.title.licenseSuccess"),
    );
  }

  function toastDownloadError(account: Account, app: Software, error: unknown) {
    const ctx = getAccountContext(account, t);
    console.error(`${LOG_PREFIX} download flow failed`, {
      appId: app.id,
      bundleID: app.bundleID,
      store: account.store,
      pod: account.pod ?? "",
      message: getErrorMessage(error, t("toast.title.downloadFailed")),
    });
    addToast(
      t("toast.msgFailed", {
        appName: app.name,
        ...ctx,
        error: getErrorMessage(error, t("toast.title.downloadFailed")),
      }),
      "error",
      t("toast.title.downloadFailed"),
    );
  }

  function toastLicenseError(account: Account, app: Software, error: unknown) {
    const ctx = getAccountContext(account, t);
    console.error(`${LOG_PREFIX} license flow failed`, {
      appId: app.id,
      bundleID: app.bundleID,
      store: account.store,
      pod: account.pod ?? "",
      message: getErrorMessage(error, t("toast.title.licenseFailed")),
    });
    addToast(
      t("toast.msgFailed", {
        appName: app.name,
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
