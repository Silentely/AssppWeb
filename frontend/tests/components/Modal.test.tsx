import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Modal from "../../src/components/common/Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Title">
        <p>content</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog with title and content when open", () => {
    render(
      <Modal open={true} onClose={() => {}} title="Example Title">
        <p>Example Content</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Example Title" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Example Content")).toBeInTheDocument();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(
      <Modal open={true} onClose={onClose} title="Title">
        <p>content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open={true} onClose={onClose} title="Title">
        <p>content</p>
      </Modal>,
    );
    // 背景层是第一个子元素，点击背景（而非对话框内部）应触发关闭
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores on close", () => {
    const { rerender } = render(
      <Modal open={true} onClose={() => {}} title="Title">
        <p>content</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Modal open={false} onClose={() => {}} title="Title">
        <p>content</p>
      </Modal>,
    );
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
