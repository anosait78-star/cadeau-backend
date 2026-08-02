import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DetailPanel } from "./detail-panel";

const SECTIONS = [
  { key: "a", label: "Section A", content: <div>Content A</div> },
  { key: "b", label: "Section B", content: <div>Content B</div> },
];

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("DetailPanel", () => {
  it("renders nothing when closed", () => {
    renderWithI18n(
      <DetailPanel open={false} onOpenChange={() => {}} title="Order #1" sections={SECTIONS} />,
    );
    expect(screen.queryByText("Content A")).not.toBeInTheDocument();
  });

  it("renders the title and first section by default when open", () => {
    renderWithI18n(
      <DetailPanel open onOpenChange={() => {}} title="Order #1" sections={SECTIONS} />,
    );
    expect(screen.getByText("Order #1")).toBeInTheDocument();
    expect(screen.getByText("Content A")).toBeInTheDocument();
  });

  it("switches tabs on click", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <DetailPanel open onOpenChange={() => {}} title="Order #1" sections={SECTIONS} />,
    );
    await user.click(screen.getByRole("tab", { name: "Section B" }));
    expect(screen.getByText("Content B")).toBeInTheDocument();
  });

  it("shows loading state instead of tabs", () => {
    renderWithI18n(
      <DetailPanel open onOpenChange={() => {}} title="Order #1" sections={SECTIONS} loading />,
    );
    expect(screen.queryByText("Content A")).not.toBeInTheDocument();
  });

  it("shows error state with retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithI18n(
      <DetailPanel
        open
        onOpenChange={() => {}}
        title="Order #1"
        sections={SECTIONS}
        error
        onRetry={onRetry}
      />,
    );
    await user.click(screen.getByText("إعادة المحاولة"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("calls onOpenChange(false) when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithI18n(
      <DetailPanel open onOpenChange={onOpenChange} title="Order #1" sections={SECTIONS} />,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
