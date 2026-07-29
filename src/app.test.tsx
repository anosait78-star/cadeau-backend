import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./app";

/**
 * Acceptance-level smoke: the SPA boots, renders the home page, and the theme
 * and direction (language) toggles work — the M1.6 acceptance criteria.
 */
describe("App", () => {
  it("boots and renders the home page in Arabic/RTL by default", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "أساس الواجهة الأمامية" })).toBeInTheDocument();
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("toggles language (direction) and theme via the Mobile More sheet", async () => {
    const user = userEvent.setup();
    render(<App />); // jsdom viewport → Mobile shell (actions live in the More sheet)

    await user.click(screen.getByRole("button", { name: "المزيد" }));

    // Language toggle flips to English + LTR.
    await user.click(await screen.findByRole("button", { name: "English" }));
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");

    // Theme toggle flips to dark (aria-label is now the English "Toggle theme").
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("renders the standard states on the home page", () => {
    render(<App />);
    expect(screen.getByText("لا توجد طلبات بعد")).toBeInTheDocument(); // empty
    expect(screen.getByRole("alert")).toBeInTheDocument(); // error
    expect(screen.getByRole("status")).toBeInTheDocument(); // loading
  });
});
