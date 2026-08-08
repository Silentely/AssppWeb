import { Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "./store/settings";

import Sidebar from "./components/Layout/Sidebar";
import MobileNav from "./components/Layout/MobileNav";
import MobileHeader from "./components/Layout/MobileHeader";
import ToastContainer from "./components/common/ToastContainer";
import GlobalDownloadNotifier from "./components/common/GlobalDownloadNotifier";
import LoadingState from "./components/common/LoadingState";
import PasswordGate from "./components/Auth/PasswordGate";

const HomePage = lazy(() => import("./components/Welcome/HomePage"));
const AccountList = lazy(() => import("./components/Account/AccountList"));
const AddAccountForm = lazy(
  () => import("./components/Account/AddAccountForm"),
);
const AccountDetail = lazy(() => import("./components/Account/AccountDetail"));
const SearchPage = lazy(() => import("./components/Search/SearchPage"));
const ProductDetail = lazy(() => import("./components/Search/ProductDetail"));
const VersionHistory = lazy(() => import("./components/Search/VersionHistory"));
const DownloadList = lazy(() => import("./components/Download/DownloadList"));
const AddDownload = lazy(() => import("./components/Download/AddDownload"));
const PackageDetail = lazy(() => import("./components/Download/PackageDetail"));
const SettingsPage = lazy(() => import("./components/Settings/SettingsPage"));

function Loading() {
  const { t } = useTranslation();
  return <LoadingState label={t("loading")} />;
}

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const { i18n } = useTranslation();

  // 同步文档语言，确保屏幕阅读器与浏览器翻译插件使用正确语言
  useEffect(() => {
    window.document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function updateThemeColor(color: string) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute("content", color);
      }
    }

    function applyTheme() {
      const isDark =
        theme === "dark" || (theme === "system" && mediaQuery.matches);
      if (isDark) {
        root.classList.add("dark");
        root.style.colorScheme = "dark";
        // 暗色下使用页面背景色，避免 PWA 顶栏与页面产生割裂感
        updateThemeColor("#030712");
      } else {
        root.classList.remove("dark");
        root.style.colorScheme = "light";
        updateThemeColor("#2563eb");
      }
    }

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  return (
    <PasswordGate>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex text-gray-900 dark:text-gray-100 transition-colors duration-200">
        <ToastContainer />
        <GlobalDownloadNotifier />

        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 safe-top">
          <MobileHeader />
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/accounts" element={<AccountList />} />
              <Route path="/accounts/add" element={<AddAccountForm />} />
              <Route path="/accounts/:email" element={<AccountDetail />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/search/:appId" element={<ProductDetail />} />
              <Route
                path="/search/:appId/versions"
                element={<VersionHistory />}
              />
              <Route path="/downloads" element={<DownloadList />} />
              <Route path="/downloads/add" element={<AddDownload />} />
              <Route path="/downloads/:id" element={<PackageDetail />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </main>
        <MobileNav />
      </div>
    </PasswordGate>
  );
}
