import { useTranslation } from "react-i18next";
import { SunIcon, MoonIcon, SystemIcon } from "./icons";
import { useSettingsStore } from "../../store/settings";

interface ThemeToggleProps {
  /** 紧凑模式：仅图标按钮，用于移动端顶栏 */
  compact?: boolean;
}

/**
 * 主题切换按钮：点击在 系统 / 浅色 / 深色 间循环。
 * 侧栏使用带标签的完整样式，移动端顶栏使用紧凑图标样式。
 */
export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { theme, setTheme } = useSettingsStore();
  const { t } = useTranslation();

  const cycleTheme = () => {
    if (theme === "system") setTheme("light");
    else if (theme === "light") setTheme("dark");
    else setTheme("system");
  };

  const icon =
    theme === "light" ? (
      <SunIcon className="w-5 h-5" />
    ) : theme === "dark" ? (
      <MoonIcon className="w-5 h-5" />
    ) : (
      <SystemIcon className="w-5 h-5" />
    );

  if (compact) {
    return (
      <button
        onClick={cycleTheme}
        className="p-2 -mr-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        title={t(`theme.${theme}`)}
        aria-label={t(`theme.${theme}`)}
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
      title={t(`theme.${theme}`)}
    >
      {icon}
      <span>{t(`theme.${theme}`)}</span>
    </button>
  );
}
