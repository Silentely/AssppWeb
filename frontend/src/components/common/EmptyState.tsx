import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  /** 可选的底部操作区（如引导链接） */
  action?: ReactNode;
}

/**
 * 统一的空状态容器：虚线边框 + 居中圆形图标 + 标题/描述 + 可选操作。
 * 遵循设计规范：不添加 transition-colors，避免暗色模式加载闪烁。
 * 列表页（搜索、下载、新建下载）空态必须复用此组件。
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 my-4 bg-gray-50 dark:bg-gray-900/30 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl">
      <div className="bg-white dark:bg-gray-800 p-4 rounded-full shadow-sm mb-4 border border-gray-100 dark:border-gray-700">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 text-center">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center max-w-sm">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
