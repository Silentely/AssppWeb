import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useToastStore, type Toast, type ToastType } from "../../store/toast";

const iconBg: Record<ToastType, string> = {
  success: "bg-green-50 dark:bg-green-900/20",
  error: "bg-red-50 dark:bg-red-900/20",
  info: "bg-blue-50 dark:bg-blue-900/20",
};

const titleColor: Record<ToastType, string> = {
  success: "text-green-600 dark:text-green-400",
  error: "text-red-600 dark:text-red-400",
  info: "text-blue-600 dark:text-blue-400",
};

const icons: Record<ToastType, ReactNode> = {
  success: (
    <svg
      className="w-6 h-6 text-green-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  ),
  error: (
    <svg
      className="w-6 h-6 text-red-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  info: (
    <svg
      className="w-6 h-6 text-blue-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};

// 退出动画时长（与 CSS animate-toast-out 保持一致）
const EXIT_ANIMATION_MS = 300;

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  const { t } = useTranslation();

  // 正在播放退出动画的 toast：store 已移除它们，但暂留渲染直至动画结束
  const [leaving, setLeaving] = useState<Record<string, Toast>>({});
  const prevToastsRef = useRef<Toast[]>([]);

  useEffect(() => {
    const currentIds = new Set(toasts.map((toast) => toast.id));
    const newlyGone: Toast[] = [];
    for (const prevToast of prevToastsRef.current) {
      if (!currentIds.has(prevToast.id) && !leaving[prevToast.id]) {
        newlyGone.push(prevToast);
      }
    }

    if (newlyGone.length > 0) {
      setLeaving((prev) => {
        const next = { ...prev };
        for (const toast of newlyGone) next[toast.id] = toast;
        return next;
      });
      for (const toast of newlyGone) {
        setTimeout(() => {
          setLeaving((prev) => {
            if (!prev[toast.id]) return prev;
            const next = { ...prev };
            delete next[toast.id];
            return next;
          });
        }, EXIT_ANIMATION_MS);
      }
    }

    prevToastsRef.current = toasts;
  }, [toasts, leaving]);

  const allToasts = [
    ...toasts.map((toast) => ({ toast, leaving: false })),
    ...Object.values(leaving).map((toast) => ({ toast, leaving: true })),
  ];

  return (
    <div
      className="fixed top-[calc(env(safe-area-inset-top)+4rem)] md:top-4 right-4 z-[100] flex flex-col gap-3 pointer-events-none"
      role="region"
      aria-label={t("toast.regionLabel")}
    >
      {allToasts.map(({ toast, leaving: isLeaving }) => (
        <div
          key={toast.id}
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          className={`pointer-events-auto flex w-[calc(100vw-2rem)] sm:w-auto sm:min-w-[320px] max-w-[calc(100vw-2rem)] sm:max-w-md overflow-hidden rounded-xl backdrop-blur-xl bg-white/85 dark:bg-gray-900/85 border border-gray-200/50 dark:border-gray-700/50 shadow-2xl ${
            isLeaving ? "animate-toast-out" : "animate-toast-in"
          }`}
        >
          <div
            className={`flex items-center justify-center w-14 flex-shrink-0 ${iconBg[toast.type]}`}
          >
            {icons[toast.type]}
          </div>

          <div className="flex-1 min-w-0 py-3 px-4 flex flex-col justify-center">
            {toast.title && (
              <h4
                className={`text-sm font-bold mb-1 ${titleColor[toast.type]}`}
              >
                {toast.title}
              </h4>
            )}
            <p
              className={`text-sm font-medium text-gray-800 dark:text-gray-200 whitespace-pre-line break-words ${toast.title ? "leading-relaxed" : ""}`}
            >
              {toast.message}
            </p>
          </div>

          <div className="flex items-start pt-3 pr-3">
            <button
              onClick={() => {
                // leaving 中的 toast 已不在 store，直接从本地移除即可
                if (isLeaving) {
                  setLeaving((prev) => {
                    const next = { ...prev };
                    delete next[toast.id];
                    return next;
                  });
                } else {
                  removeToast(toast.id);
                }
              }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
              aria-label={t("toast.close")}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
