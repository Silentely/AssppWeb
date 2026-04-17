import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlist } from "../../src/apple/plist";
import { purchaseApp } from "../../src/apple/purchase";
import { appleRequest } from "../../src/apple/request";
import type { Account, Software } from "../../src/types";

vi.mock("../../src/apple/request", () => ({
  appleRequest: vi.fn(),
}));

function createAccount(): Account {
  return {
    email: "tester@example.com",
    password: "pass",
    appleId: "tester@example.com",
    store: "143444",
    firstName: "Test",
    lastName: "User",
    passwordToken: "token",
    directoryServicesIdentifier: "100000001",
    cookies: [],
    deviceIdentifier: "aabbccddeeff",
    pod: "48",
  };
}

function createSoftware(): Software {
  return {
    id: 284910350,
    bundleID: "com.example.app",
    name: "Example App",
    version: "1.0.0",
    price: 0,
    artistName: "Example",
    sellerName: "Example",
    description: "desc",
    averageUserRating: 0,
    userRatingCount: 0,
    artworkUrl: "",
    screenshotUrls: [],
    minimumOsVersion: "15.0",
    releaseDate: "2026-01-01T00:00:00Z",
    primaryGenreName: "Utilities",
  };
}

describe("apple/purchase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats status=0 as success even when jingleDocType is not purchaseSuccess", async () => {
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        status: 0,
        jingleDocType: "purchasePending",
      }),
    });

    await expect(purchaseApp(createAccount(), createSoftware())).resolves.toEqual({
      updatedCookies: [],
    });
  });

  it("surfaces customerMessage and status code when failureType is absent", async () => {
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        status: 5002,
        jingleDocType: "purchaseFailure",
        customerMessage: "Not available in your storefront",
      }),
    });

    await expect(
      purchaseApp(createAccount(), createSoftware()),
    ).rejects.toMatchObject({
      name: "PurchaseError",
      message: "Not available in your storefront",
      code: "5002",
    });
  });

  it("retries with GAME pricing when first attempt returns failureType 2059", async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          failureType: "2059",
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          status: 0,
          jingleDocType: "purchaseSuccess",
        }),
      });

    await expect(purchaseApp(createAccount(), createSoftware())).resolves.toEqual({
      updatedCookies: [],
    });

    expect(vi.mocked(appleRequest)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appleRequest).mock.calls[0][0].body).toContain(
      "<key>pricingParameters</key><string>STDQ</string>",
    );
    expect(vi.mocked(appleRequest).mock.calls[1][0].body).toContain(
      "<key>pricingParameters</key><string>GAME</string>",
    );
  });

  it("retries with GAME pricing when first attempt returns buyProductFailure", async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          jingleDocType: "buyProductFailure",
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          status: 0,
          jingleDocType: "purchaseSuccess",
        }),
      });

    await expect(purchaseApp(createAccount(), createSoftware())).resolves.toEqual({
      updatedCookies: [],
    });

    expect(vi.mocked(appleRequest)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appleRequest).mock.calls[0][0].body).toContain(
      "<key>pricingParameters</key><string>STDQ</string>",
    );
    expect(vi.mocked(appleRequest).mock.calls[1][0].body).toContain(
      "<key>pricingParameters</key><string>GAME</string>",
    );
  });

  it("extracts message from dialog.explanation when customerMessage is missing", async () => {
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        jingleDocType: "buyProductFailure",
        dialog: {
          explanation: "This app is currently unavailable in your region.",
        },
      }),
    });

    await expect(
      purchaseApp(createAccount(), createSoftware()),
    ).rejects.toMatchObject({
      name: "PurchaseError",
      message: "This app is currently unavailable in your region.",
      code: "buyProductFailure",
    });
  });
});
