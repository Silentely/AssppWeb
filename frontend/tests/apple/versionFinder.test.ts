import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listVersions, VersionError, isVersionAuthExpired } from "../../src/apple/versionFinder";
import { buildPlist } from "../../src/apple/plist";
import type { Account, Software } from "../../src/types";

vi.mock("../../src/apple/request", () => ({
  appleRequest: vi.fn(),
}));

vi.mock("../../src/i18n", () => ({
  default: {
    t: (key: string) => {
      const map: Record<string, string> = {
        "errors.download.redirectLocation": "Failed to retrieve redirect location",
        "errors.download.passwordExpired": "Password token is expired",
        "errors.download.licenseRequired": "License required",
        "errors.download.noItems": "No items in response",
        "errors.download.missingVersionIdentifiers": "Missing version identifiers",
        "errors.download.noVersionsFound": "No versions found",
        "errors.download.tooManyRedirects": "Too many redirects",
      };
      return map[key] ?? key;
    },
  },
}));

import { appleRequest } from "../../src/apple/request";

const mockAccount: Account = {
  email: "user@example.com",
  password: "password",
  firstName: "User",
  lastName: "Example",
  appleId: "user@example.com",
  store: "143441",
  directoryServicesIdentifier: "12345",
  deviceIdentifier: "abcdef123456",
  cookies: [],
  passwordToken: "token",
};

const mockApp: Software = {
  id: "123456789",
  bundleID: "com.example.app",
  name: "Example App",
  artworkUrl: "",
  version: "1.0",
  price: 0,
  kind: "software",
  trackViewUrl: "",
};

function plistResponse(body: Record<string, unknown>) {
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    rawHeaders: [],
    body: buildPlist(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("versionFinder", () => {
  it("returns reversed version identifiers", async () => {
    (appleRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      plistResponse({
        songList: [
          {
            metadata: {
              softwareVersionExternalIdentifiers: [100, 99, 98],
            },
          },
        ],
      }),
    );
    const result = await listVersions(mockAccount, mockApp);
    expect(result.versions).toEqual(["98", "99", "100"]);
    expect(result.updatedCookies).toEqual([]);
  });

  it("throws localized passwordExpired error for failureType 2034", async () => {
    (appleRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      plistResponse({ failureType: "2034", customerMessage: "x" }),
    );
    await expect(listVersions(mockAccount, mockApp)).rejects.toMatchObject({
      message: "Password token is expired",
      code: "2034",
    });
  });

  it("throws localized licenseRequired error for failureType 9610", async () => {
    (appleRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      plistResponse({ failureType: "9610", customerMessage: "x" }),
    );
    await expect(listVersions(mockAccount, mockApp)).rejects.toMatchObject({
      message: "License required",
      code: "9610",
    });
  });

  it("throws missing version identifiers when metadata lacks identifiers", async () => {
    (appleRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      plistResponse({ songList: [{ metadata: {} }] }),
    );
    await expect(listVersions(mockAccount, mockApp)).rejects.toMatchObject({
      message: "Missing version identifiers",
    });
  });

  it("throws noVersionsFound when identifiers array is empty", async () => {
    (appleRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      plistResponse({
        songList: [{ metadata: { softwareVersionExternalIdentifiers: [] } }],
      }),
    );
    await expect(listVersions(mockAccount, mockApp)).rejects.toMatchObject({
      message: "No versions found",
    });
  });

  it("handles a 302 redirect and retries", async () => {
    (appleRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        status: 302,
        statusText: "Found",
        headers: { location: "https://p27-buy.itunes.apple.com/next" },
        rawHeaders: [],
        body: "",
      })
      .mockResolvedValueOnce(
        plistResponse({
          songList: [{ metadata: { softwareVersionExternalIdentifiers: [7] } }],
        }),
      );
    const result = await listVersions(mockAccount, mockApp);
    expect(result.versions).toEqual(["7"]);
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });

  it("isVersionAuthExpired returns true only for auth expiry codes", () => {
    expect(
      isVersionAuthExpired(new VersionError("x", "2034")),
    ).toBe(true);
    expect(
      isVersionAuthExpired(new VersionError("x", "9610")),
    ).toBe(false);
    expect(isVersionAuthExpired(new Error("plain"))).toBe(false);
  });
});
