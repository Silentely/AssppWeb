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

  it("GET /api/search should use SerpApi when SERPAPI_KEY is configured", async () => {
    process.env.SERPAPI_KEY = "test-serp-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
            thumbnail: "https://example.com/wechat.png",
            screenshots: ["https://example.com/screenshot-1.png"],
            primary_genre: "Social Networking",
            released: "2026-03-01T00:00:00.000Z",
            minimum_os_version: "14.0",
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
      version: "8.0.58",
      primaryGenreName: "Social Networking",
    });

    const requestUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(requestUrl).toContain("https://serpapi.com/search.json?");
    expect(requestUrl).toContain("engine=apple_app_store");
    expect(requestUrl).toContain("api_key=test-serp-key");
  });

  it("GET /api/lookup should prefer exact bundle match from SerpApi results", async () => {
    process.env.SERPAPI_KEY = "test-serp-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        organic_results: [
          {
            app_id: 1,
            bundle_id: "com.example.other",
            title: "Other",
          },
          {
            app_id: 414478124,
            bundle_id: "com.tencent.xin",
            title: "WeChat",
            version: "8.0.58",
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
