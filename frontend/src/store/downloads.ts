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

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let consecutiveErrors = 0;

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_INTERVAL_MS = 30_000;

function hasActiveTasks(tasks: DownloadTask[]): boolean {
  return tasks.some(
    (t) =>
      t.status === "downloading" ||
      t.status === "pending" ||
      t.status === "injecting",
  );
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// 轮询采用可变延迟：连续失败时指数退避，避免故障期间高频请求
function schedulePoll() {
  if (pollTimer) return;
  const backoff = Math.min(2 ** Math.min(consecutiveErrors, 4), 16);
  const delay = Math.min(POLL_INTERVAL_MS * backoff, MAX_POLL_INTERVAL_MS);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void useDownloadsStore.getState().fetchTasks();
  }, delay);
}

function startPolling(immediate = false) {
  if (pollTimer) return;
  if (immediate) {
    void useDownloadsStore.getState().fetchTasks();
  }
  schedulePoll();
}

// 页面切到后台时暂停轮询，回到前台时立即恢复一次，避免隐藏标签页空转请求
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const state = useDownloadsStore.getState();
    if (document.hidden) {
      stopPolling();
    } else if (hasActiveTasks(state.tasks)) {
      startPolling(true);
    }
  });
}

// 仅测试使用：重置轮询内部状态（定时器、并发标志、退避计数）
export function __resetPollStateForTests() {
  stopPolling();
  inFlight = false;
  consecutiveErrors = 0;
}

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  tasks: [],
  loading: false,
  accountHashes: [],

  setAccountHashes: (hashes) => set({ accountHashes: hashes }),

  fetchTasks: async () => {
    // 并发守卫：请求进行中时跳过本轮，并重排下一次轮询
    if (inFlight) {
      schedulePoll();
      return;
    }
    inFlight = true;
    const { accountHashes, tasks } = get();
    // 仅在列表为空时展示全屏 loading，避免轮询刷新时列表闪烁
    if (tasks.length === 0) {
      set({ loading: true });
    }
    try {
      const fetchedTasks = await downloadsApi.fetchDownloads(accountHashes);
      consecutiveErrors = 0;
      set({ tasks: fetchedTasks, loading: false });

      if (hasActiveTasks(fetchedTasks)) {
        schedulePoll();
      } else {
        stopPolling();
      }
    } catch {
      consecutiveErrors += 1;
      set({ loading: false });
      // 失败时若仍有活跃任务则退避重试，否则停止轮询
      if (hasActiveTasks(get().tasks)) {
        schedulePoll();
      } else {
        stopPolling();
      }
    } finally {
      inFlight = false;
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
