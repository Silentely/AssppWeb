import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  title?: string;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type: ToastType, title?: string) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

// 同时展示的 toast 上限，防止错误风暴导致通知区无限堆叠
const MAX_TOASTS = 5;

// 错误提示信息较长（含换行与账号上下文），给予更长的阅读时间
const TOAST_DURATION: Record<ToastType, number> = {
  error: 8000,
  success: 5000,
  info: 5000,
};

// 每条 toast 的过期定时器，去重或手动关闭时需取消
const expireTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set) => {
  function scheduleExpire(id: string, type: ToastType) {
    const existing = expireTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      expireTimers.delete(id);
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, TOAST_DURATION[type]);
    expireTimers.set(id, timer);
  }

  function cancelExpire(id: string) {
    const timer = expireTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      expireTimers.delete(id);
    }
  }

  return {
    toasts: [],
    addToast: (message, type, title) => {
      const id = String(nextId++);
      set((state) => {
        // 相同内容去重：已存在时重置计时延长展示，避免刷屏的同时不漏掉反馈
        const existing = state.toasts.find(
          (t) => t.type === type && t.title === title && t.message === message,
        );
        if (existing) {
          scheduleExpire(existing.id, type);
          return state;
        }
        const toast = { id, message, type, title };
        const next = [...state.toasts, toast].slice(-MAX_TOASTS);
        // 被挤出上限的 toast 需要取消其过期定时器
        for (const dropped of state.toasts) {
          if (!next.includes(dropped)) {
            cancelExpire(dropped.id);
          }
        }
        scheduleExpire(id, type);
        return { toasts: next };
      });
    },
    removeToast: (id) => {
      cancelExpire(id);
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    },
  };
});
