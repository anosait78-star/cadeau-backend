import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { App } from "./app";

/** A signed-in profile with no companies yet (the switcher stays a placeholder). */
const ME = {
  id: "u1",
  email: "founder@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: null,
  companies: [],
};

/**
 * Acceptance-level smoke: with a valid session the SPA boots into the home page
 * and the theme + direction (language) toggles work. Auth (M4.5) now guards the
 * shell, so we seed tokens and stub `GET /v1/me` before mounting.
 */
describe("App", () => {
  beforeEach(() => {
    writeTokens({ accessToken: "access", refreshToken: "refresh", expiresIn: 300 });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/me")) {
          return Promise.resolve(
            new Response(JSON.stringify(ME), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("boots and renders the home page in Arabic/RTL by default", async () => {
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "أساس الواجهة الأمامية" }),
    ).toBeInTheDocument();
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("toggles language (direction) and theme via the Mobile More sheet", async () => {
    const user = userEvent.setup();
    render(<App />); // jsdom viewport → Mobile shell (actions live in the More sheet)

    await user.click(await screen.findByRole("button", { name: "المزيد" }));

    // Language toggle flips to English + LTR.
    await user.click(await screen.findByRole("button", { name: "English" }));
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");

    // Theme toggle flips to dark (aria-label is now the English "Toggle theme").
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("renders the standard states on the home page", async () => {
    render(<App />);
    expect(await screen.findByText("لا توجد طلبات بعد")).toBeInTheDocument(); // empty
    expect(screen.getByRole("alert")).toBeInTheDocument(); // error
    expect(screen.getByRole("status")).toBeInTheDocument(); // loading
  });
});
