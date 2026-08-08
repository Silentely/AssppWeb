import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import AppIcon from "../common/AppIcon";
import CountrySelect from "../common/CountrySelect";
import EmptyState from "../common/EmptyState";
import { SearchIcon } from "../common/icons";
import { useSearch } from "../../hooks/useSearch";
import { useAccounts } from "../../hooks/useAccounts";
import { useSettingsStore } from "../../store/settings";
import { useToastStore } from "../../store/toast";
import { countryCodeMap, storeIdToCountry } from "../../apple/config";

export default function SearchPage() {
  const { t } = useTranslation();
  const { defaultCountry, defaultEntity } = useSettingsStore();
  const { accounts } = useAccounts();
  const initialCountry = defaultCountry || "US";
  const addToast = useToastStore((s) => s.addToast);

  const {
    term,
    country,
    entity,
    results,
    loading,
    error,
    search,
    setSearchParam,
    setSearchDefaults,
  } = useSearch();

  useEffect(() => {
    if (error) {
      // 后端错误原文（英文）不适合直接展示，使用本地化标题 + 保留详情
      addToast(`${t("errors.search.failed")}\n${error}`, "error");
    }
  }, [error, addToast, t]);

  useEffect(() => {
    setSearchDefaults({ country: initialCountry, entity: defaultEntity });
  }, [initialCountry, defaultEntity, setSearchDefaults]);

  const activeCountry = country || initialCountry;
  const activeEntity = entity || defaultEntity;

  const availableCountryCodes = Array.from(
    new Set(
      accounts
        .map((a) => storeIdToCountry(a.store))
        .filter(Boolean) as string[],
    ),
  ).sort((a, b) =>
    t(`countries.${a}`, a).localeCompare(t(`countries.${b}`, b)),
  );

  const allCountryCodes = Object.keys(countryCodeMap).sort((a, b) =>
    t(`countries.${a}`, a).localeCompare(t(`countries.${b}`, b)),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    search(term.trim(), activeCountry, activeEntity);
  }

  return (
    <PageContainer title={t("search.title")}>
      <form onSubmit={handleSubmit} className="space-y-4 mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={term}
            onChange={(e) => setSearchParam({ term: e.target.value })}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="flex-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !term.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {loading ? t("search.searching") : t("search.button")}
          </button>
        </div>
        <div className="flex w-full gap-3 overflow-hidden">
          <CountrySelect
            value={activeCountry}
            onChange={(c) => setSearchParam({ country: c })}
            availableCountryCodes={availableCountryCodes}
            allCountryCodes={allCountryCodes}
            className="w-1/2 truncate bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-700"
          />
          <select
            value={activeEntity}
            onChange={(e) => setSearchParam({ entity: e.target.value })}
            className="w-1/2 truncate rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          >
            <option value="iPhone">iPhone</option>
            <option value="iPad">iPad</option>
            <option value="macSoftware">Mac</option>
          </select>
        </div>
      </form>

      {results.length === 0 && !loading && !error && (
        <EmptyState
          icon={<SearchIcon className="w-12 h-12 text-blue-500 dark:text-blue-400" />}
          title={t("search.empty")}
          description={t("search.emptyDesc")}
        />
      )}

      <div className="space-y-2">
        {results.map((app) => (
          <Link
            key={app.id}
            to={`/search/${app.id}`}
            state={{ app, country: activeCountry }}
            className="block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center gap-4">
              <AppIcon url={app.artworkUrl} name={app.name} size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {app.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {app.artistName}
                </p>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                  <span>{app.formattedPrice ?? t("search.free")}</span>
                  <span>{app.primaryGenreName}</span>
                  <span>
                    {(app.averageUserRating ?? 0).toFixed(1)} (
                    {app.userRatingCount ?? 0})
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
