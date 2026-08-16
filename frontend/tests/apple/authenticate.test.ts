import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlist } from "../../src/apple/plist";
import { authenticate } from "../../src/apple/authenticate";
import { appleRequest } from "../../src/apple/request";
import { fetchBag } from "../../src/apple/bag";

vi.mock("../../src/apple/request", () => ({
  appleRequest: vi.fn(),
}));

vi.mock("../../src/apple/bag", () => ({
  fetchBag: vi.fn(),
  defaultAuthURL:
    "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate",
}));

const authURL =
  "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate";

function successResponse() {
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    rawHeaders: [] as [string, string][],
    body: buildPlist({
      accountInfo: {
        appleId: "test@example.com",
        address: {
          firstName: "Test",
          lastName: "User",
        },
      },
      passwordToken: "token",
      dsPersonId: "123",
    }),
  };
}

function forbiddenResponse() {
  return {
    status: 403,
    statusText: "Forbidden",
    headers: { "content-type": "text/html" },
    rawHeaders: [] as [string, string][],
    body: "<html> <head><title>403 Forbidden</title></head> <body> <center><h1>403 Forbidden</h1></center> <hr><center>Apple</center> </body> </html>",
  };
}

describe("apple/authenticate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets guid query exactly once from bag endpoint", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL:
        "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate?foo=1&guid=old-value",
    });
    vi.mocked(appleRequest).mockResolvedValue(successResponse());

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const requestCall = vi.mocked(appleRequest).mock.calls[0][0];
    const endpoint = new URL(`https://${requestCall.host}${requestCall.path}`);

    expect(endpoint.searchParams.get("guid")).toBe("aabbccddeeff");
    expect(endpoint.searchParams.getAll("guid")).toHaveLength(1);
    expect(endpoint.searchParams.get("foo")).toBe("1");
  });

  it("retries after a transient 403 HTML rejection and succeeds", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchBag).mockResolvedValue({ authURL });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(forbiddenResponse())
      .mockResolvedValueOnce(successResponse());

    const promise = authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6_000);

    const account = await promise;
    expect(account.email).toBe("test@example.com");
    expect(appleRequest).toHaveBeenCalledTimes(2);
    // 初次拉取 + 重试时重新拉取 bag
    expect(fetchBag).toHaveBeenCalledTimes(2);
  });

  it("retries after an empty 204 response and succeeds", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchBag).mockResolvedValue({ authURL });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 204,
        statusText: "No Content",
        headers: {},
        rawHeaders: [],
        body: "",
      })
      .mockResolvedValueOnce(successResponse());

    const promise = authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6_000);

    const account = await promise;
    expect(account.email).toBe("test@example.com");
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });

  it("gives up with a clear error after repeated edge rejections", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchBag).mockResolvedValue({ authURL });
    vi.mocked(appleRequest).mockResolvedValue(forbiddenResponse());

    const promise = authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );
    // 提前挂上断言处理器，避免 fake timer 推进期间产生 unhandled rejection
    const assertion = expect(promise).rejects.toMatchObject({
      name: "AuthenticationError",
      message: expect.stringContaining("Apple"),
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(15_000);

    await assertion;
    expect(appleRequest).toHaveBeenCalledTimes(4);
    expect(fetchBag).toHaveBeenCalledTimes(4);
  });

  it("does not retry invalid credentials", async () => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        failureType: "-5000",
        customerMessage: "MZFinance.BadLogin.Configurator_message",
      }),
    });

    await expect(
      authenticate(
        "test@example.com",
        "wrong",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
    expect(appleRequest).toHaveBeenCalledTimes(1);
    expect(fetchBag).toHaveBeenCalledTimes(1);
  });

  it("does not retry when a verification code is required", async () => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: "",
    });

    const err = await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      name: "AuthenticationError",
      codeRequired: true,
    });
    expect(appleRequest).toHaveBeenCalledTimes(1);
    expect(fetchBag).toHaveBeenCalledTimes(1);
  });

  it("follows a 302 redirect to the pod host without refetching the bag", async () => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 302,
        statusText: "Found",
        headers: {
          location:
            "https://p31-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate?guid=aabbccddeeff",
        },
        rawHeaders: [],
        body: "",
      })
      .mockResolvedValueOnce(successResponse());

    const account = await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );
    expect(account.email).toBe("test@example.com");
    expect(appleRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appleRequest).mock.calls[1][0].host).toBe(
      "p31-buy.itunes.apple.com",
    );
    // 302 重定向不重新拉取 bag
    expect(fetchBag).toHaveBeenCalledTimes(1);
  });
});
