import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const ORIGINAL_SERPAPI_KEY = process.env.SERPAPI_KEY;
const ORIGINAL_SERPAPI_TIMEOUT_MS = process.env.SERPAPI_TIMEOUT_MS;

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function createApp() {
  vi.resetModules();
  const { default: searchRoutes } = await import("../src/routes/search.js");
  const app = express();
  app.use("/api", searchRoutes);
  return app;
}

describe("Search Route", () => {
  beforeEach(() => {
    delete process.env.SERPAPI_KEY;
    delete process.env.SERPAPI_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_SERPAPI_KEY === undefined) {
      delete process.env.SERPAPI_KEY;
    } else {
      process.env.SERPAPI_KEY = ORIGINAL_SERPAPI_KEY;
    }

    if (ORIGINAL_SERPAPI_TIMEOUT_MS === undefined) {
      delete process.env.SERPAPI_TIMEOUT_MS;
    } else {
      process.env.SERPAPI_TIMEOUT_MS = ORIGINAL_SERPAPI_TIMEOUT_MS;
    }

    vi.restoreAllMocks();
  });

  it("GET /api/search should use SerpApi and hydrate from legacy lookup", async () => {
    process.env.SERPAPI_KEY = "test-serp-key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          organic_results: [
            {
              app_id: 414478124,
              bundle_id: "com.tencent.xin",
              title: "WeChat",
              version: "8.0.58",
              price: 0,
              developer: "Tencent Mobile International Limited",
              rating: 4.5,
              rating_count: 1200,
              // Keep this intentionally empty to verify iTunes lookup hydration.
              thumbnail: "",
              screenshots: [],
              primary_genre: "Social Networking",
              released: "2026-03-01T00:00:00.000Z",
              minimum_os_version: "14.0",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          resultCount: 1,
          results: [
            {
              trackId: 414478124,
              bundleId: "com.tencent.xin",
              trackName: "WeChat",
              version: "8.0.71",
              price: 0,
              artistName: "WeChat",
              sellerName: "Tencent Technology (Shenzhen) Company Limited",
              description: "Mock",
              averageUserRating: 3.9,
              userRatingCount: 79431,
              artworkUrl512: "https://example.com/wechat-512.jpg",
              screenshotUrls: ["https://example.com/screenshot-1.png"],
              minimumOsVersion: "15.0",
              currentVersionReleaseDate: "2026-04-15T11:05:40Z",
              releaseNotes: "What's New",
              formattedPrice: "Free",
              primaryGenreName: "Social Networking",
            },
          ],
        }),
      );

    const app = await createApp();
    const res = await request(app).get(
      "/api/search?term=wechat&country=cn&limit=1",
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 414478124,
      bundleID: "com.tencent.xin",
      name: "WeChat",
      version: "8.0.71",
      artworkUrl: "https://example.com/wechat-512.jpg",
      primaryGenreName: "Social Networking",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstRequestUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    const secondRequestUrl = String(fetchSpy.mock.calls[1]?.[0] ?? "");
    expect(firstRequestUrl).toContain("https://serpapi.com/search.json?");
    expect(firstRequestUrl).toContain("engine=apple_app_store");
    expect(firstRequestUrl).toContain("api_key=test-serp-key");
    expect(secondRequestUrl).toContain("https://itunes.apple.com/lookup?");
    expect(secondRequestUrl).toContain("id=414478124");
  });

  it("GET /api/lookup should always use legacy iTunes lookup", async () => {
    process.env.SERPAPI_KEY = "test-serp-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        resultCount: 1,
        results: [
          {
            trackId: 414478124,
            bundleId: "com.tencent.xin",
            trackName: "WeChat",
            version: "8.0.71",
            price: 0,
            artistName: "WeChat",
            sellerName: "Tencent",
            description: "Mock",
            averageUserRating: 3.9,
            userRatingCount: 79431,
            artworkUrl512: "https://example.com/wechat-512.jpg",
            screenshotUrls: [],
            minimumOsVersion: "15.0",
            currentVersionReleaseDate: "2026-04-15T11:05:40Z",
            primaryGenreName: "Social Networking",
          },
        ],
      }),
    );

    const app = await createApp();
    const res = await request(app).get(
      "/api/lookup?bundleId=com.tencent.xin&country=cn",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 414478124,
      bundleID: "com.tencent.xin",
      name: "WeChat",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(requestUrl).toContain("https://itunes.apple.com/lookup?");
    expect(requestUrl).toContain("bundleId=com.tencent.xin");
  });

  it("GET /api/search should fallback to legacy iTunes API without SERPAPI_KEY", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        resultCount: 1,
        results: [
          {
            trackId: 414478124,
            bundleId: "com.tencent.xin",
            trackName: "WeChat",
            version: "8.0.58",
            price: 0,
            artistName: "Tencent",
            sellerName: "Tencent",
            description: "Mock",
            averageUserRating: 4.5,
            userRatingCount: 1200,
            artworkUrl512: "https://example.com/wechat.png",
            screenshotUrls: [],
            minimumOsVersion: "14.0",
            currentVersionReleaseDate: "2026-03-01T00:00:00.000Z",
            primaryGenreName: "Social Networking",
          },
        ],
      }),
    );

    const app = await createApp();
    const res = await request(app).get(
      "/api/search?term=wechat&country=cn&limit=1",
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].bundleID).toBe("com.tencent.xin");

    const requestUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(requestUrl).toContain("https://itunes.apple.com/search?");
  });

  it("GET /api/search should return 500 when both SerpApi and fallback upstream fail", async () => {
    process.env.SERPAPI_KEY = "test-serp-key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }))
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }));

    const app = await createApp();
    const res = await request(app).get(
      "/api/search?term=wechat&country=cn&limit=1",
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Search request failed" });
  });
});
