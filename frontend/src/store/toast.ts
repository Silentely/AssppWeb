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

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type, title) => {
    const id = String(nextId++);
    set((state) => {
      // 相同内容去重：内容一致的 toast 已存在时忽略，避免重复刷屏
      const exists = state.toasts.some(
        (t) => t.type === type && t.title === title && t.message === message,
      );
      if (exists) {
        return state;
      }
      const toast = { id, message, type, title };
      return { toasts: [...state.toasts, toast].slice(-MAX_TOASTS) };
    });
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
