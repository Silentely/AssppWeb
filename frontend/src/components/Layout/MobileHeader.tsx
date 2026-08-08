import ThemeToggle from "../common/ThemeToggle";

export default function MobileHeader() {
  return (
    <>
      {/* 使用 fixed 替代 sticky，防止 PWA 下拉出现空白缝隙，保留 safe-top */}
      <header className="md:hidden fixed top-0 left-0 right-0 w-full bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 z-40 transition-colors duration-200 safe-top">
        <div className="flex items-center justify-between px-4 h-14">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">
            Asspp Web
          </h1>
          <ThemeToggle compact />
        </div>
      </header>
      {/* 为 fixed 定位的顶栏提供占位，防止下方内容被遮挡 */}
      <div className="md:hidden safe-top">
        <div className="h-14"></div>
      </div>
    </>
  );
}
