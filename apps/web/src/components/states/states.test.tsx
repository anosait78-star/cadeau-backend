import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { LoadingState } from "./loading-state";

function wrap(node: ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

describe("standard states", () => {
  it("LoadingState shows a status with the localized label", () => {
    wrap(<LoadingState />);
    // Arabic default label.
    expect(screen.getAllByText("جارٍ التحميل…").length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("EmptyState renders title, description and action", () => {
    wrap(
      <EmptyState
        title="No orders"
        description="Nothing here"
        action={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByText("No orders")).toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("ErrorState uses default title and fires onRetry", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    wrap(<ErrorState description="boom" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("حدث خطأ ما")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("ErrorState hides the retry button when no handler is given", () => {
    wrap(<ErrorState description="boom" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
