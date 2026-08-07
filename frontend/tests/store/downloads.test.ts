import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  useDownloadsStore,
  __resetPollStateForTests,
} from "../../src/store/downloads";
import * as downloadsApi from "../../src/api/downloads";
import type { DownloadTask } from "../../src/types";

vi.mock("../../src/api/downloads", () => ({
  fetchDownloads: vi.fn(),
  startDownload: vi.fn(),
  pauseDownload: vi.fn(),
  resumeDownload: vi.fn(),
  deleteDownload: vi.fn(),
}));

const mockedFetch = vi.mocked(downloadsApi.fetchDownloads);

function makeTask(partial: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: "task-1",
    software: {
      id: 1,
      bundleID: "com.example.app",
      name: "Example App",
      version: "1.0",
      artistName: "Example",
      sellerName: "Example",
      description: "",
      averageUserRating: 0,
      userRatingCount: 0,
      artworkUrl: "",
      screenshotUrls: [],
      minimumOsVersion: "12.0",
      releaseDate: "2026-01-01",
      primaryGenreName: "Utilities",
    },
    accountHash: "account-hash",
    status: "downloading",
    progress: 0,
    speed: "0 B/s",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("downloads store polling", () => {
  beforeEach(() => {
    __resetPollStateForTests();
    useDownloadsStore.setState({
      tasks: [],
      loading: false,
      accountHashes: [],
    });
    vi.useFakeTimers();
    mockedFetch.mockReset();
  });

  afterEach(() => {
    __resetPollStateForTests();
    vi.useRealTimers();
  });

  it("skips overlapping fetches while a request is in flight", async () => {
    let resolveFetch!: (value: DownloadTask[]) => void;
    mockedFetch.mockImplementationOnce(
      () =>
        new Promise<DownloadTask[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = useDownloadsStore.getState().fetchTasks();
    const second = useDownloadsStore.getState().fetchTasks();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    resolveFetch([makeTask()]);
    await first;
    await second;
    expect(useDownloadsStore.getState().tasks).toHaveLength(1);
  });

  it("backs off after failures and restores the normal interval on success", async () => {
    useDownloadsStore.setState({ tasks: [makeTask()] });
    mockedFetch.mockResolvedValue([makeTask()]);
    mockedFetch.mockRejectedValueOnce(new Error("network down"));

    await useDownloadsStore.getState().fetchTasks();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // 首次失败后退避到 4s：3s 时不应重试
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(mockedFetch).toHaveBeenCalledTimes(2);

    // 成功后恢复 2s 正常轮询间隔
    await vi.advanceTimersByTimeAsync(2001);
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });

  it("stops polling when there are no active tasks left", async () => {
    useDownloadsStore.setState({ tasks: [makeTask()] });
    mockedFetch.mockResolvedValue([makeTask({ status: "completed" })]);

    await useDownloadsStore.getState().fetchTasks();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // 无活跃任务后不应继续轮询
    vi.advanceTimersByTime(10_000);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
