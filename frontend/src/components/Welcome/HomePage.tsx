import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import { useAccounts } from "../../hooks/useAccounts";
import { useDownloads } from "../../hooks/useDownloads";
import { apiGet } from "../../api/client";
import { accountHash } from "../../utils/account";

export default function HomePage() {
  const { t } = useTranslation();
  const { accounts } = useAccounts();
  // 复用全局下载任务数据，与下载页计数保持一致，避免重复请求
  const { tasks } = useDownloads();
  const [packageCount, setPackageCount] = useState(0);

  useEffect(() => {
    if (accounts.length === 0) {
      setPackageCount(0);
      return;
    }

    let cancelled = false;

    (async () => {
      const hashes = await Promise.all(accounts.map((a) => accountHash(a)));
      if (cancelled) return;

      const params = new URLSearchParams({
        accountHashes: hashes.join(","),
      });

      const packages = await apiGet<unknown[]>(
        `/api/packages?${params}`,
      ).catch(() => []);

      if (cancelled) return;

      setPackageCount(Array.isArray(packages) ? packages.length : 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [accounts]);

  return (
    <PageContainer>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {t("home.welcome")}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t("home.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label={t("home.stats.accounts")} value={accounts.length} />
          <StatCard label={t("home.stats.downloads")} value={tasks.length} />
          <StatCard label={t("home.stats.packages")} value={packageCount} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ActionCard
            to="/accounts/add"
            title={t("home.actions.addAccount")}
            description={t("home.actions.addAccountDesc")}
          />
          <ActionCard
            to="/search"
            title={t("home.actions.searchApps")}
            description={t("home.actions.searchAppsDesc")}
          />
          <ActionCard
            to="/downloads"
            title={t("home.actions.viewDownloads")}
            description={t("home.actions.viewDownloadsDesc")}
          />
        </div>
      </div>
    </PageContainer>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function ActionCard({
  to,
  title,
  description,
}: {
  to: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all"
    >
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {description}
      </p>
    </Link>
  );
}
