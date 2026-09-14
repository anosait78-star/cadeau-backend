import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function renderTabs() {
  return render(
    <Tabs defaultValue="a">
      <TabsList aria-label="sections">
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Content A</TabsContent>
      <TabsContent value="b">Content B</TabsContent>
    </Tabs>,
  );
}

/** jsdom has no layout; pretend the strip is wider than its box. */
function makeOverflowing(el: HTMLElement): void {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: 600 });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
}

describe("TabsList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps swipes on an overflowing strip away from document-level scroll locks", () => {
    renderTabs();
    const list = screen.getByRole("tablist");
    makeOverflowing(list);
    // Stand-in for react-remove-scroll's document listener inside a Dialog.
    const lock = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener("touchmove", lock);
    try {
      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      screen.getByRole("tab", { name: "B" }).dispatchEvent(move);
      expect(lock).not.toHaveBeenCalled();
      expect(move.defaultPrevented).toBe(false);
    } finally {
      document.removeEventListener("touchmove", lock);
    }
  });

  it("lets touchmoves bubble when the strip does not overflow", () => {
    renderTabs();
    const lock = vi.fn();
    document.addEventListener("touchmove", lock);
    try {
      screen
        .getByRole("tab", { name: "B" })
        .dispatchEvent(new Event("touchmove", { bubbles: true, cancelable: true }));
      expect(lock).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("touchmove", lock);
    }
  });

  it("scrolls the newly selected tab into view", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      const user = userEvent.setup();
      renderTabs();
      const tabB = screen.getByRole("tab", { name: "B" });
      await user.click(tabB);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(scrollIntoView.mock.contexts).toContain(tabB);
      expect(screen.getByText("Content B")).toBeInTheDocument();
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
