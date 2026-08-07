import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDownloads } from "../../hooks/useDownloads";
import { useAccounts } from "../../hooks/useAccounts";
import { useToastStore } from "../../store/toast";
import { getAccountContext } from "../../utils/toast";
import type { DownloadTask } from "../../types";

/**
 * Invisible component mounted at App root.
 * Monitors background download tasks and pushes toast notifications
 * when a task transitions to completed or failed.
 */
export default function GlobalDownloadNotifier() {
  const { tasks, hashToEmail } = useDownloads();
  const { accounts } = useAccounts();
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useTranslation();

  const prevTasksRef = useRef<Record<string, DownloadTask>>({});
  const depsRef = useRef({ hashToEmail, accounts, t, addToast });

  useEffect(() => {
    depsRef.current = { hashToEmail, accounts, t, addToast };
  }, [hashToEmail, accounts, t, addToast]);

  useEffect(() => {
    const prevTasks = prevTasksRef.current;
    const currentTasks: Record<string, DownloadTask> = {};
    const { hashToEmail, accounts, t, addToast } = depsRef.current;

    tasks.forEach((task) => {
      currentTasks[task.id] = task;
      const prevTask = prevTasks[task.id];

      // 仅在状态发生迁移时通知（跳过首次加载）
      if (prevTask) {
        if (prevTask.status !== "completed" && task.status === "completed") {
          notify(task, "success");
        }
        if (prevTask.status !== "failed" && task.status === "failed") {
          notify(task, "failed");
        }
      }
    });

    prevTasksRef.current = currentTasks;

    function notify(task: DownloadTask, type: "success" | "failed") {
      const accountEmail = hashToEmail[task.accountHash] || task.accountHash;
      const account = accounts.find((a) => a.email === accountEmail);
      const ctx = getAccountContext(account, t);
      const appName = task.software.name;

      if (type === "success") {
        addToast(
          t("toast.msg", {
            appName,
            version: ` v${task.software.version}`,
            ...ctx,
          }),
          "success",
          t("toast.title.downloadSuccess"),
        );
      } else {
        addToast(
          t("toast.msgFailed", {
            appName,
            version: ` v${task.software.version}`,
            ...ctx,
            error: task.error || t("toast.unknownError"),
          }),
          "error",
          t("toast.title.downloadFailed"),
        );
      }
    }
  }, [tasks]);

  return null;
}
