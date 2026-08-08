import { useTranslation } from "react-i18next";
import Modal from "./Modal";
import Spinner from "./Spinner";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除/清空）使用红色确认按钮 */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 统一的确认对话框：替代浏览器原生 confirm()，
 * 保证暗色模式、移动端与键盘操作下的一致体验。
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        {message}
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {cancelText ?? t("settings.data.cancel")}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors flex items-center gap-2 ${
            danger ? "bg-red-600" : "bg-blue-600"
          }`}
        >
          {loading && <Spinner />}
          {confirmText ?? t("settings.data.confirmBtn")}
        </button>
      </div>
    </Modal>
  );
}
