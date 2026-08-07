import { create } from "zustand";
import type { DownloadTask, Software, Sinf } from "../types";
import * as downloadsApi from "../api/downloads";

interface DownloadsState {
  tasks: DownloadTask[];
  loading: boolean;
  accountHashes: string[];
  setAccountHashes: (hashes: string[]) => void;
  fetchTasks: () => Promise<void>;
  startDownload: (data: {
    software: Software;
    accountHash: string;
    downloadURL: string;
    sinfs: Sinf[];
  }) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  deleteDownload: (id: string) => Promise<void>;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

function hasActiveTasks(tasks: DownloadTask[]): boolean {
  return tasks.some(
    (t) =>
      t.status === "downloading" ||
      t.status === "pending" ||
      t.status === "injecting",
  );
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    useDownloadsStore.getState().fetchTasks();
  }, 2000);
}

// 页面切到后台时暂停轮询，回到前台时立即恢复一次，避免隐藏标签页空转请求
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const state = useDownloadsStore.getState();
    if (document.hidden) {
      stopPolling();
    } else if (hasActiveTasks(state.tasks)) {
      startPolling();
      state.fetchTasks();
    }
  });
}

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  tasks: [],
  loading: false,
  accountHashes: [],

  setAccountHashes: (hashes) => set({ accountHashes: hashes }),

  fetchTasks: async () => {
    const { accountHashes, tasks } = get();
    // 仅在列表为空时展示全屏 loading，避免轮询刷新时列表闪烁
    if (tasks.length === 0) {
      set({ loading: true });
    }
    try {
      const fetchedTasks = await downloadsApi.fetchDownloads(accountHashes);
      set({ tasks: fetchedTasks, loading: false });

      if (hasActiveTasks(fetchedTasks)) {
        startPolling();
      } else {
        stopPolling();
      }
    } catch {
      set({ loading: false });
    }
  },

  startDownload: async (data) => {
    await downloadsApi.startDownload(data);
    await get().fetchTasks();
  },

  pauseDownload: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    await downloadsApi.pauseDownload(id, task.accountHash);
    await get().fetchTasks();
  },

  resumeDownload: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    await downloadsApi.resumeDownload(id, task.accountHash);
    await get().fetchTasks();
  },

  deleteDownload: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    await downloadsApi.deleteDownload(id, task.accountHash);
    set({ tasks: get().tasks.filter((t) => t.id !== id) });
  },
}));
