import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import PageContainer from "../Layout/PageContainer";
import AppIcon from "../common/AppIcon";
import Badge from "../common/Badge";
import ProgressBar from "../common/ProgressBar";
import Modal from "../common/Modal";
import ConfirmModal from "../common/ConfirmModal";
import LoadingState from "../common/LoadingState";
import Spinner from "../common/Spinner";
import { useDownloads } from "../../hooks/useDownloads";
import { useAccounts } from "../../hooks/useAccounts";
import { useDownloadAction } from "../../hooks/useDownloadAction";
import { useToastStore } from "../../store/toast";
import { getInstallInfo } from "../../api/install";
import { authHeaders } from "../../api/client";
import { lookupApp } from "../../api/search";
import { storeIdToCountry } from "../../apple/config";
import { listVersions } from "../../apple/versionFinder";
import { getAccountContext, getTaskErrorMessage } from "../../utils/toast";
import { isNewerVersion } from "../../utils/version";
import { log } from "../../utils/log";
import type { Software } from "../../types";

const LOG_PREFIX = "[PackageDetail]";

export default function PackageDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tasks, deleteDownload, pauseDownload, resumeDownload, hashToEmail } =
    useDownloads();
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { accounts } = useAccounts();
  const { startDownload } = useDownloadAction();

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [latestApp, setLatestApp] = useState<Software | null>(null);
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");

  const task = tasks.find((t) => t.id === id);

  if (!task) {
    return (
      <PageContainer title={t("downloads.package.title")}>
        {tasks.length === 0 ? (
          <LoadingState label={t("loading")} />
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            {t("downloads.package.notFound")}
          </div>
        )}
      </PageContainer>
    );
  }

  // 闭包内类型固定为 DownloadTask，避免 TS 窄化在嵌套函数中丢失
  const currentTask = task;

  const isActive = task.status === "downloading" || task.status === "injecting";
  const isPaused = task.status === "paused";
  const isCompleted = task.status === "completed";
  const installInfo = isCompleted ? getInstallInfo(task.id) : null;

  const accountEmail = hashToEmail[task.accountHash];
  const account = accounts.find((a) => a.email === accountEmail);
  const ctx = getAccountContext(account, t);
  const appName = task.software.name;

  function toastAction(titleKey: string, type: "success" | "info" = "info") {
    addToast(
      t("toast.msg", {
        appName,
        version: ` v${currentTask.software.version}`,
        ...ctx,
      }),
      type,
      t(titleKey),
    );
  }

  function handleDelete() {
    setShowDeleteModal(true);
  }

  async function confirmDelete() {
    await deleteDownload(task!.id);
    setShowDeleteModal(false);
    addToast(
      t("toast.msgDeleted", {
        appName,
        version: ` v${currentTask.software.version}`,
      }),
      "success",
      t("toast.title.deleteSuccess"),
    );
    navigate("/downloads");
  }

  async function copyInstallLink() {
    if (!installInfo) return;

    const urlToShare = installInfo.installUrl;
    log.info(LOG_PREFIX, "share start", {
      taskId: currentTask.id,
      appId: currentTask.software.id,
      bundleID: currentTask.software.bundleID,
    });

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(urlToShare);
        log.info(LOG_PREFIX, "share copied via clipboard API", {
          taskId: currentTask.id,
        });
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = urlToShare;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        log.info(LOG_PREFIX, "share copied via execCommand", {
          taskId: currentTask.id,
        });
      }
    } catch (err) {
      log.warn(LOG_PREFIX, "share copy failed", {
        taskId: currentTask.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    addToast(
      t("toast.msgShare", {
        appName,
        version: ` v${currentTask.software.version}`,
        ...ctx,
      }),
      "success",
      t("toast.title.shareAcquired"),
    );
  }

  function handleNativeShare() {
    if (!installInfo || !navigator.share) return;
    void navigator.share({ text: installInfo.installUrl }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      log.warn(LOG_PREFIX, "native share failed", {
        taskId: currentTask.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async function handleCheckUpdate() {
    if (!task || !account) return;
    setCheckingUpdate(true);
    log.info(LOG_PREFIX, "check update start", {
      taskId: task.id,
      appId: task.software.id,
      bundleID: task.software.bundleID,
      store: account.store,
    });
    try {
      const country = storeIdToCountry(account.store) ?? "US";
      const app = await lookupApp(task.software.bundleID, country);

      if (app && isNewerVersion(app.version, task.software.version)) {
        setLatestApp(app);
        const result = await listVersions(account, app);
        setAvailableVersions(result.versions);
        setSelectedVersion(result.versions[0] || "");
        setShowUpdateModal(true);
        log.info(LOG_PREFIX, "update available", {
          taskId: task.id,
          fromVersion: task.software.version,
          latestVersion: app.version,
          versionCount: result.versions.length,
        });
      } else {
        addToast(t("downloads.package.noUpdate"), "info");
        log.info(LOG_PREFIX, "no update available", {
          taskId: task.id,
          currentVersion: task.software.version,
        });
      }
    } catch (error) {
      log.error(LOG_PREFIX, "check update failed", {
        taskId: task.id,
        message: error instanceof Error ? error.message : String(error),
      });
      addToast(t("downloads.package.checkUpdateFailed"), "error");
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleConfirmUpdate() {
    if (!task || !account || !latestApp) return;
    setShowUpdateModal(false);
    log.info(LOG_PREFIX, "confirm update start", {
      taskId: task.id,
      appId: latestApp.id,
      bundleID: latestApp.bundleID,
      selectedVersion,
    });
    try {
      const isLatest =
        availableVersions.length > 0 &&
        selectedVersion === availableVersions[0];
      await startDownload(
        account,
        latestApp,
        isLatest ? undefined : selectedVersion,
      );
      await deleteDownload(task.id);
      log.info(LOG_PREFIX, "confirm update completed", {
        taskId: task.id,
        appId: latestApp.id,
      });
      navigate("/downloads");
    } catch (error) {
      log.error(LOG_PREFIX, "confirm update failed", {
        taskId: task.id,
        message: error instanceof Error ? error.message : String(error),
      });
      addToast(t("downloads.package.updateFailed"), "error");
    }
  }

  async function handleDownloadIpa() {
    toastAction("toast.title.downloadIpaStarted");
    log.info(LOG_PREFIX, "ipa download start", {
      taskId: currentTask.id,
      appId: currentTask.software.id,
      bundleID: currentTask.software.bundleID,
    });
    try {
      const res = await fetch(
        `/api/packages/${currentTask.id}/file?accountHash=${encodeURIComponent(currentTask.accountHash)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentTask.software.name}_${currentTask.software.version}.ipa`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log.info(LOG_PREFIX, "ipa download completed", {
        taskId: currentTask.id,
        status: res.status,
        sizeBytes: blob.size,
      });
    } catch (error) {
      log.error(LOG_PREFIX, "ipa download failed", {
        taskId: currentTask.id,
        message: error instanceof Error ? error.message : String(error),
      });
      addToast(t("downloads.package.downloadFailed"), "error");
    }
  }

  return (
    <PageContainer title={t("downloads.package.title")}>
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <AppIcon
            url={task.software.artworkUrl}
            name={task.software.name}
            size="lg"
          />
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {task.software.name}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              {task.software.artistName}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Badge status={task.status} />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                v{task.software.version}
              </span>
            </div>
          </div>
        </div>

        {(isActive || isPaused) && (
          <div>
            <ProgressBar progress={task.progress} />
            <div className="flex justify-between mt-1 text-sm text-gray-500 dark:text-gray-400">
              <span>{Math.round(task.progress)}%</span>
              {task.speed && isActive && <span>{task.speed}</span>}
            </div>
          </div>
        )}

        {task.error && (
          <p className="text-sm text-red-500 dark:text-red-400">
            {getTaskErrorMessage(task, t)}
          </p>
        )}

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.bundleId")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200 min-w-0 truncate ml-4">
                {task.software.bundleID}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.version")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200">
                {task.software.version}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.account")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200 min-w-0 truncate ml-4">
                {accountEmail || task.accountHash}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                {t("downloads.package.created")}
              </dt>
              <dd className="text-gray-900 dark:text-gray-200">
                {new Date(task.createdAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {isCompleted && (
              <>
                <button
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                  className="inline-flex items-center gap-2 px-4 py-2 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {checkingUpdate && <Spinner />}
                  {checkingUpdate
                    ? t("downloads.package.checkingUpdate")
                    : t("downloads.package.checkUpdate")}
                </button>
                {installInfo && (
                  <>
                    <a
                      href={installInfo.installUrl}
                      onClick={() => {
                        log.info(LOG_PREFIX, "install url opened", {
                          taskId: task.id,
                          appId: task.software.id,
                          bundleID: task.software.bundleID,
                        });
                        toastAction("toast.title.installStarted");
                      }}
                      className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                    >
                      {t("downloads.package.install")}
                    </a>

                    <div className="flex items-center">
                      <button
                        onClick={() => setShowShareModal(true)}
                        className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
                      >
                        {t("downloads.package.share")}
                      </button>
                    </div>
                  </>
                )}
                <button
                  onClick={handleDownloadIpa}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {t("downloads.package.downloadIpa")}
                </button>
              </>
            )}
            {isActive && (
              <button
                onClick={() => pauseDownload(task.id)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t("downloads.package.pause")}
              </button>
            )}
            {isPaused && (
              <button
                onClick={() => resumeDownload(task.id)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t("downloads.package.resume")}
              </button>
            )}
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              {t("downloads.package.delete")}
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        title={t("downloads.package.updateAvailable")}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t("downloads.package.updatePrompt", {
              version: latestApp?.version,
            })}
          </p>
          {availableVersions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("downloads.package.selectVersion")}
              </label>
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-white"
              >
                {availableVersions.map((v, i) => (
                  <option key={v} value={v}>
                    {i === 0
                      ? t("downloads.package.latestVersion", { id: v })
                      : v}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setShowUpdateModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t("settings.data.cancel")}
            </button>
            <button
              onClick={handleConfirmUpdate}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t("downloads.package.update")}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={showDeleteModal}
        title={t("downloads.package.delete")}
        message={t("downloads.package.deleteConfirm")}
        confirmText={t("accounts.detail.confirmDelete")}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />

      {installInfo && (
        <Modal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          title={t("downloads.package.share")}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="bg-white p-3 rounded-xl border border-gray-200 dark:border-gray-700">
              <QRCodeSVG value={installInfo.installUrl} size={192} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              {t("downloads.package.scan")}
            </p>
            <p className="w-full text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-2 break-all">
              {installInfo.installUrl}
            </p>
            <div className="flex gap-3 w-full">
              <button
                onClick={copyInstallLink}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
              >
                {t("downloads.package.copyLink")}
              </button>
              {typeof navigator.share === "function" && (
                <button
                  onClick={handleNativeShare}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t("downloads.package.share")}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
}
