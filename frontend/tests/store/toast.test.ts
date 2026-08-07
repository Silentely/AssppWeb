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

  it("keeps error toasts visible longer than info toasts", () => {
    const { addToast } = useToastStore.getState();
    addToast("an error", "error");
    addToast("an info", "info");
    // 5 秒后 info 过期，error 仍在
    vi.advanceTimersByTime(5001);
    const remaining = useToastStore.getState().toasts.map((t) => t.message);
    expect(remaining).toEqual(["an error"]);
    // 再等 3 秒，error 也过期
    vi.advanceTimersByTime(3001);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("re-adding the same toast extends its lifetime instead of stacking", () => {
    const { addToast } = useToastStore.getState();
    addToast("same", "info");
    vi.advanceTimersByTime(4000);
    addToast("same", "info");
    // 已过 4 秒，重新加入后计时重置，累计 8 秒时仍在
    vi.advanceTimersByTime(4000);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("same");
    vi.advanceTimersByTime(1001);
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
