import { Router, Request, Response } from "express";
import { config } from "../config.js";
import { getRequestId } from "../utils/requestLog.js";

const router = Router();
const LEGACY_ITUNES_BASE_URL = "https://itunes.apple.com";
const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const DEFAULT_LIMIT = 25;
const SEARCH_LOG_PREFIX = "[SearchRoute]";

function logInfo(
  reqId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (meta) {
    console.log(`${SEARCH_LOG_PREFIX} [${reqId}] ${message}`, meta);
    return;
  }
  console.log(`${SEARCH_LOG_PREFIX} [${reqId}] ${message}`);
}

function logWarn(
  reqId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (meta) {
    console.warn(`${SEARCH_LOG_PREFIX} [${reqId}] ${message}`, meta);
    return;
  }
  console.warn(`${SEARCH_LOG_PREFIX} [${reqId}] ${message}`);
}

function logError(
  reqId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (meta) {
    console.error(`${SEARCH_LOG_PREFIX} [${reqId}] ${message}`, meta);
    return;
  }
  console.error(`${SEARCH_LOG_PREFIX} [${reqId}] ${message}`);
}

function logDebug(
  reqId: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (!config.searchDebug) {
    return;
  }
  if (meta) {
    console.log(`${SEARCH_LOG_PREFIX} [${reqId}] [debug] ${message}`, meta);
    return;
  }
  console.log(`${SEARCH_LOG_PREFIX} [${reqId}] [debug] ${message}`);
}

function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", "***");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function trimLogText(value: string, maxLength: number = 64): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function headerValueToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value ?? "";
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function durationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

// Map iTunes API fields to our Software type, matching Swift CodingKeys
function mapLegacySoftware(item: Record<string, any>) {
  return {
    id: item.trackId,
    bundleID: item.bundleId,
    name: item.trackName,
    version: item.version,
    price: item.price,
    artistName: item.artistName,
    sellerName: item.sellerName,
    description: item.description,
    averageUserRating: item.averageUserRating,
    userRatingCount: item.userRatingCount,
    artworkUrl: item.artworkUrl512,
    screenshotUrls: item.screenshotUrls ?? [],
    minimumOsVersion: item.minimumOsVersion,
    fileSizeBytes: item.fileSizeBytes,
    releaseDate: item.currentVersionReleaseDate ?? item.releaseDate,
    releaseNotes: item.releaseNotes,
    formattedPrice: item.formattedPrice,
    primaryGenreName: item.primaryGenreName,
  };
}

function toNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toString(value: unknown, fallback: string = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function normalizeScreenshots(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object") {
        return toString((item as Record<string, unknown>).link);
      }
      return "";
    })
    .filter(Boolean);
}

function mapEntityToDevice(entity: unknown): "mobile" | "tablet" | "desktop" {
  const normalized = toString(entity).toLowerCase();
  if (normalized.includes("ipad") || normalized === "tablet") {
    return "tablet";
  }
  if (normalized.includes("mac") || normalized === "desktop") {
    return "desktop";
  }
  return "mobile";
}

function parseAppId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const match = trimmed.match(/id(\d+)/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function parseLimit(value: unknown): number {
  const parsed = toNumber(value, DEFAULT_LIMIT);
  return Math.max(1, Math.min(200, parsed));
}

function normalizeCountry(value: unknown): string {
  const country = toString(value, "US").trim();
  return country ? country.toLowerCase() : "us";
}

function mapSerpSoftware(item: Record<string, any>) {
  const appId =
    parseAppId(item.product_id) ??
    parseAppId(item.app_id) ??
    parseAppId(item.id) ??
    parseAppId(item.trackId) ??
    parseAppId(item.link) ??
    0;
  const priceValue =
    typeof item.price === "object"
      ? toNumber(item.price?.amount ?? item.price?.value, 0)
      : toNumber(item.price, 0);
  const currency =
    typeof item.price === "object" ? toString(item.price?.currency) : "";
  const formattedPrice = toString(
    item.formatted_price ?? item.price?.formatted ?? item.formattedPrice,
  );
  const icons = Array.isArray(item.icons) ? item.icons : [];
  const artworkUrl =
    toString(item.thumbnail ?? item.icon) ||
    toString(icons[0]?.link) ||
    toString(item.artworkUrl512);

  return {
    id: appId,
    bundleID: toString(item.bundle_id ?? item.bundleId),
    name: toString(item.title ?? item.track_name ?? item.name),
    version: toString(item.version ?? item.current_version),
    price: priceValue,
    artistName: toString(
      item.developer ?? item.artist_name ?? item.artistName ?? item.seller_name,
    ),
    sellerName: toString(
      item.seller_name ??
        item.sellerName ??
        item.developer ??
        item.artist_name ??
        item.artistName,
    ),
    description: toString(item.description),
    averageUserRating: toNumber(item.rating ?? item.averageUserRating, 0),
    userRatingCount: toNumber(item.rating_count ?? item.userRatingCount, 0),
    artworkUrl,
    screenshotUrls: normalizeScreenshots(item.screenshots),
    minimumOsVersion: toString(item.minimum_os_version ?? item.minimumOsVersion),
    fileSizeBytes: toString(item.size_bytes ?? item.fileSizeBytes),
    releaseDate: toString(
      item.released ??
        item.release_date ??
        item.currentVersionReleaseDate ??
        item.releaseDate,
    ),
    releaseNotes: toString(
      item.release_note ?? item.release_notes ?? item.releaseNotes,
    ),
    formattedPrice:
      formattedPrice ||
      (priceValue === 0
        ? "Free"
        : currency
          ? `${currency} ${priceValue}`
          : String(priceValue)),
    primaryGenreName: toString(
      item.primary_genre ?? item.genre ?? item.primaryGenreName,
    ),
  };
}

async function fetchJson(
  url: string,
  context: string,
  reqId: string,
): Promise<Record<string, any>> {
  const upstreamStartedAt = Date.now();
  logDebug(reqId, `${context}: request`, { url: sanitizeUrlForLog(url) });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.serpApiTimeoutMs),
  });

  if (!response.ok) {
    logWarn(reqId, `${context}: upstream non-2xx`, {
      status: response.status,
      durationMs: durationMs(upstreamStartedAt),
      url: sanitizeUrlForLog(url),
    });
    throw new Error(`Upstream request failed (${response.status})`);
  }

  logDebug(reqId, `${context}: upstream response`, {
    status: response.status,
    durationMs: durationMs(upstreamStartedAt),
    contentType: response.headers.get("content-type") ?? "",
    contentLength: response.headers.get("content-length") ?? "",
  });

  const rawText = await response.text();
  if (!rawText) {
    logDebug(reqId, `${context}: empty response body`);
    return {};
  }

  try {
    const parsed = JSON.parse(rawText) as Record<string, any>;
    logDebug(reqId, `${context}: response parsed`, {
      hasResultCount: typeof parsed.resultCount === "number",
      hasOrganicResults: Array.isArray(parsed.organic_results),
      bodyLength: rawText.length,
    });
    return parsed;
  } catch {
    logWarn(reqId, `${context}: invalid json`, {
      bodyPreview: trimLogText(rawText, 120),
      bodyLength: rawText.length,
    });
    throw new Error("Upstream returned invalid JSON");
  }
}

async function searchViaSerpApi(
  term: string,
  country: string,
  limit: number,
  reqId: string,
  device: "mobile" | "tablet" | "desktop" = "mobile",
): Promise<ReturnType<typeof mapLegacySoftware>[]> {
  const params = new URLSearchParams({
    engine: "apple_app_store",
    term,
    country,
    device,
    num: String(limit),
    api_key: config.serpApiKey,
  });
  const data = await fetchJson(
    `${SERPAPI_SEARCH_URL}?${params.toString()}`,
    "serpapi-search",
    reqId,
  );
  if (typeof data.error === "string" && data.error.trim()) {
    throw new Error(`SerpApi error: ${data.error}`);
  }
  const organicResults = Array.isArray(data.organic_results)
    ? data.organic_results
    : [];
  return organicResults.map(mapSerpSoftware);
}

async function lookupManyViaLegacyApi(
  appIds: number[],
  country: string,
  reqId: string,
): Promise<ReturnType<typeof mapLegacySoftware>[]> {
  if (!appIds.length) {
    return [];
  }

  const uniqueIds = Array.from(
    new Set(appIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (!uniqueIds.length) {
    return [];
  }

  const params = new URLSearchParams({ country });
  params.set("id", uniqueIds.join(","));
  params.set("entity", "software");

  const data = await fetchJson(
    `${LEGACY_ITUNES_BASE_URL}/lookup?${params.toString()}`,
    "itunes-lookup-many",
    reqId,
  );
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map(mapLegacySoftware);
}

async function hydrateSerpResultsWithLegacyLookup(
  serpResults: ReturnType<typeof mapLegacySoftware>[],
  country: string,
  reqId: string,
): Promise<ReturnType<typeof mapLegacySoftware>[]> {
  if (!serpResults.length) {
    return [];
  }

  const validSerpResults = serpResults.filter(
    (item) => Number.isInteger(item.id) && item.id > 0,
  );
  const droppedInvalidCount = serpResults.length - validSerpResults.length;
  if (droppedInvalidCount > 0) {
    logWarn(reqId, "drop serp results with invalid app id", {
      droppedInvalidCount,
      totalSerpResults: serpResults.length,
      sampleNames: serpResults
        .slice(0, 3)
        .map((item) => trimLogText(item.name || "", 24)),
    });
  }
  if (!validSerpResults.length) {
    return [];
  }

  const appIds = validSerpResults.map((item) => item.id);
  logDebug(reqId, "start hydrating serp results via itunes lookup", {
    validSerpCount: validSerpResults.length,
    lookupIdCount: appIds.length,
    sampleIds: appIds.slice(0, 10),
  });
  const legacyResults = await lookupManyViaLegacyApi(appIds, country, reqId);
  const legacyById = new Map(legacyResults.map((item) => [item.id, item]));

  const hydrated = validSerpResults
    .map((item) => legacyById.get(item.id))
    .filter((item): item is ReturnType<typeof mapLegacySoftware> => Boolean(item));

  const unresolvedCount = validSerpResults.length - hydrated.length;
  if (unresolvedCount > 0) {
    logWarn(reqId, "drop serp results missing iTunes lookup match", {
      unresolvedCount,
      validSerpCount: validSerpResults.length,
      sampleMissingIds: validSerpResults
        .map((item) => item.id)
        .filter((id) => !legacyById.has(id))
        .slice(0, 10),
    });
  }

  logDebug(reqId, "serp hydration summary", {
    hydratedCount: hydrated.length,
    validSerpCount: validSerpResults.length,
  });

  return hydrated;
}

async function searchViaLegacyApi(
  params: URLSearchParams,
  reqId: string,
): Promise<ReturnType<typeof mapLegacySoftware>[]> {
  const data = await fetchJson(
    `${LEGACY_ITUNES_BASE_URL}/search?${params.toString()}`,
    "itunes-search",
    reqId,
  );
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map(mapLegacySoftware);
}

async function lookupViaLegacyApi(
  identifier: string,
  country: string,
  reqId: string,
): Promise<ReturnType<typeof mapLegacySoftware> | null> {
  const appId = parseAppId(identifier);
  const params = new URLSearchParams({ country });
  if (appId !== null) {
    params.set("id", String(appId));
  } else {
    params.set("bundleId", identifier);
  }

  const data = await fetchJson(
    `${LEGACY_ITUNES_BASE_URL}/lookup?${params.toString()}`,
    "itunes-lookup-single",
    reqId,
  );
  if (!data.resultCount || !Array.isArray(data.results) || !data.results.length) {
    return null;
  }
  return mapLegacySoftware(data.results[0]);
}

router.get("/search", async (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const routeStartedAt = Date.now();
  try {
    const term = toString(req.query.term).trim();
    if (!term) {
      logWarn(reqId, "missing required term parameter", {
        queryKeys: Object.keys(req.query ?? {}),
      });
      res.status(400).json({ error: "Missing term parameter" });
      return;
    }

    const country = normalizeCountry(req.query.country);
    const limit = parseLimit(req.query.limit);
    const device = mapEntityToDevice(req.query.entity);
    const termForLog = trimLogText(term);

    logInfo(reqId, "/search request start", {
      method: req.method,
      path: req.path,
      term: termForLog,
      country,
      limit,
      device,
      hasSerpApiKey: Boolean(config.serpApiKey),
      provider: config.serpApiKey ? "serpapi+itunes-hydrate" : "itunes",
      userAgent: trimLogText(headerValueToString(req.headers["user-agent"]), 80),
      ip: req.ip,
    });

    if (config.serpApiKey) {
      try {
        const serpResults = await searchViaSerpApi(
          term,
          country,
          limit,
          reqId,
          device,
        );
        logDebug(reqId, "serp search completed", {
          term: termForLog,
          serpCount: serpResults.length,
        });
        if (!serpResults.length) {
          logInfo(reqId, "/search completed", {
            provider: "serpapi",
            resultCount: 0,
            durationMs: durationMs(routeStartedAt),
          });
          res.json([]);
          return;
        }

        const results = await hydrateSerpResultsWithLegacyLookup(
          serpResults,
          country,
          reqId,
        );
        logDebug(reqId, "serp hydration completed", {
          term: termForLog,
          hydratedCount: results.length,
          sourceCount: serpResults.length,
        });
        if (results.length > 0) {
          logInfo(reqId, "/search completed", {
            provider: "serpapi+itunes-hydrate",
            resultCount: results.length,
            durationMs: durationMs(routeStartedAt),
          });
          res.json(results);
          return;
        }

        logWarn(reqId, "serp results unusable, fallback to itunes search", {
          term: termForLog,
          country,
          limit,
          sourceCount: serpResults.length,
          durationMs: durationMs(routeStartedAt),
        });
      } catch (err) {
        logWarn(reqId, "serp search failed, fallback to itunes search", {
          term: termForLog,
          country,
          message: safeErrorMessage(err),
          durationMs: durationMs(routeStartedAt),
        });
      }
    }

    const params = new URLSearchParams(req.query as Record<string, string>);
    params.set("term", term);
    params.set("country", country);
    params.set("limit", String(limit));
    if (!params.get("media")) {
      params.set("media", "software");
    }
    if (!params.get("entity")) {
      params.set("entity", "software");
    }

    const results = await searchViaLegacyApi(params, reqId);
    logDebug(reqId, "itunes search completed", {
      term: termForLog,
      count: results.length,
    });
    logInfo(reqId, "/search completed", {
      provider: config.serpApiKey ? "itunes-fallback" : "itunes",
      resultCount: results.length,
      durationMs: durationMs(routeStartedAt),
    });
    res.json(results);
  } catch (err) {
    logError(reqId, "/search failed", {
      message: safeErrorMessage(err),
      durationMs: durationMs(routeStartedAt),
      ...(config.searchDebug && err instanceof Error
        ? { stack: err.stack ?? "" }
        : {}),
    });
    res.status(500).json({ error: "Search request failed" });
  }
});

router.get("/lookup", async (req: Request, res: Response) => {
  const reqId = getRequestId(res);
  const routeStartedAt = Date.now();
  try {
    const identifier = toString(req.query.bundleId ?? req.query.id).trim();
    if (!identifier) {
      logWarn(reqId, "missing required bundleId/id parameter", {
        queryKeys: Object.keys(req.query ?? {}),
      });
      res.status(400).json({ error: "Missing bundleId parameter" });
      return;
    }

    const country = normalizeCountry(req.query.country);
    const appId = parseAppId(identifier);
    logInfo(reqId, "/lookup request start", {
      method: req.method,
      path: req.path,
      identifier: trimLogText(identifier),
      identifierType: appId !== null ? "id" : "bundleId",
      parsedAppId: appId ?? "",
      country,
      provider: "itunes",
      userAgent: trimLogText(headerValueToString(req.headers["user-agent"]), 80),
      ip: req.ip,
    });
    const result = await lookupViaLegacyApi(identifier, country, reqId);
    logDebug(reqId, "itunes lookup completed", {
      identifier: trimLogText(identifier),
      found: Boolean(result),
    });
    logInfo(reqId, "/lookup completed", {
      identifier: trimLogText(identifier),
      found: Boolean(result),
      durationMs: durationMs(routeStartedAt),
    });
    res.json(result);
  } catch (err) {
    logError(reqId, "/lookup failed", {
      message: safeErrorMessage(err),
      durationMs: durationMs(routeStartedAt),
      ...(config.searchDebug && err instanceof Error
        ? { stack: err.stack ?? "" }
        : {}),
    });
    res.status(500).json({ error: "Lookup request failed" });
  }
});

export default router;
