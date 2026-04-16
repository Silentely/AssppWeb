import { Router, Request, Response } from "express";
import { config } from "../config.js";

const router = Router();
const LEGACY_ITUNES_BASE_URL = "https://itunes.apple.com";
const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const DEFAULT_LIMIT = 25;
const LOOKUP_LIMIT = 20;

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

async function fetchJson(url: string): Promise<Record<string, any>> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.serpApiTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed (${response.status})`);
  }

  const rawText = await response.text();
  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText) as Record<string, any>;
  } catch {
    throw new Error("Upstream returned invalid JSON");
  }
}

async function searchViaSerpApi(
  term: string,
  country: string,
  limit: number,
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
  const data = await fetchJson(`${SERPAPI_SEARCH_URL}?${params.toString()}`);
  if (typeof data.error === "string" && data.error.trim()) {
    throw new Error(`SerpApi error: ${data.error}`);
  }
  const organicResults = Array.isArray(data.organic_results)
    ? data.organic_results
    : [];
  return organicResults.map(mapSerpSoftware);
}

async function searchViaLegacyApi(
  params: URLSearchParams,
): Promise<ReturnType<typeof mapLegacySoftware>[]> {
  const data = await fetchJson(
    `${LEGACY_ITUNES_BASE_URL}/search?${params.toString()}`,
  );
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map(mapLegacySoftware);
}

async function lookupViaSerpApi(
  identifier: string,
  country: string,
): Promise<ReturnType<typeof mapLegacySoftware> | null> {
  const results = await searchViaSerpApi(
    identifier,
    country,
    LOOKUP_LIMIT,
    "mobile",
  );
  if (!results.length) {
    return null;
  }

  const normalizedIdentifier = identifier.toLowerCase();
  const appId = parseAppId(identifier);

  const exact = results.find(
    (item) =>
      item.bundleID.toLowerCase() === normalizedIdentifier ||
      (appId !== null && item.id === appId),
  );

  return exact ?? results[0] ?? null;
}

async function lookupViaLegacyApi(
  identifier: string,
  country: string,
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
  );
  if (!data.resultCount || !Array.isArray(data.results) || !data.results.length) {
    return null;
  }
  return mapLegacySoftware(data.results[0]);
}

router.get("/search", async (req: Request, res: Response) => {
  try {
    const term = toString(req.query.term).trim();
    if (!term) {
      res.status(400).json({ error: "Missing term parameter" });
      return;
    }

    const country = normalizeCountry(req.query.country);
    const limit = parseLimit(req.query.limit);
    const device = mapEntityToDevice(req.query.entity);

    if (config.serpApiKey) {
      try {
        const results = await searchViaSerpApi(term, country, limit, device);
        res.json(results);
        return;
      } catch (err) {
        console.error(
          "SerpApi search fallback:",
          err instanceof Error ? err.message : err,
        );
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

    const results = await searchViaLegacyApi(params);
    res.json(results);
  } catch (err) {
    console.error("Search error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Search request failed" });
  }
});

router.get("/lookup", async (req: Request, res: Response) => {
  try {
    const identifier = toString(req.query.bundleId ?? req.query.id).trim();
    if (!identifier) {
      res.status(400).json({ error: "Missing bundleId parameter" });
      return;
    }

    const country = normalizeCountry(req.query.country);

    if (config.serpApiKey) {
      try {
        const result = await lookupViaSerpApi(identifier, country);
        res.json(result);
        return;
      } catch (err) {
        console.error(
          "SerpApi lookup fallback:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const result = await lookupViaLegacyApi(identifier, country);
    res.json(result);
  } catch (err) {
    console.error("Lookup error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Lookup request failed" });
  }
});

export default router;
