import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useToastStore } from "../../src/store/toast";

describe("toast store", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a toast", () => {
    useToastStore.getState().addToast("hello", "info");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe("hello");
  });

  it("removes toasts older than the max count", () => {
    const { addToast } = useToastStore.getState();
    for (let i = 0; i < 7; i++) {
      addToast(`message-${i}`, "info");
    }
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(5);
    // 最旧的 2 条被丢弃，保留最新的 5 条
    expect(toasts[0].message).toBe("message-2");
    expect(toasts[4].message).toBe("message-6");
  });

  it("deduplicates toasts with identical content", () => {
    const { addToast } = useToastStore.getState();
    addToast("same error", "error", "Download Failed");
    addToast("same error", "error", "Download Failed");
    addToast("different", "info");
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it("expires toasts after the timeout", () => {
    useToastStore.getState().addToast("temp", "info");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(5001);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("removes a toast manually by id", () => {
    const { addToast, removeToast } = useToastStore.getState();
    addToast("bye", "info");
    const id = useToastStore.getState().toasts[0].id;
    removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
