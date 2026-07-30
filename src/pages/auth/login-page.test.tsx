import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AppProviders } from "@/providers/app-providers";
import { LoginPage } from "./login-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TOKENS_AND_USER = {
  accessToken: "a",
  refreshToken: "r",
  tokenType: "Bearer",
  expiresIn: 300,
  user: { id: "u1", email: "founder@acme.test", fullName: null },
};

const ME = {
  id: "u1",
  email: "founder@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: null,
  companies: [],
};

function renderLogin(): void {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("LoginPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs in and redirects to the intended destination", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(json(200, TOKENS_AND_USER)) // login
      .mockResolvedValueOnce(json(200, ME)); // /me
    renderLogin();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "founder@acme.test");
    await user.type(screen.getByLabelText("كلمة المرور"), "correct horse");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("prompts for a TOTP code when the account has 2FA enabled", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        json(401, {
          error: { code: "UNAUTHORIZED", statusCode: 401, details: { twoFactorRequired: true } },
        }),
      )
      .mockResolvedValueOnce(json(200, TOKENS_AND_USER)) // login retry with code
      .mockResolvedValueOnce(json(200, ME));
    renderLogin();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "founder@acme.test");
    await user.type(screen.getByLabelText("كلمة المرور"), "correct horse");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    const codeField = await screen.findByLabelText("رمز المصادقة");
    await user.type(codeField, "123456");
    await user.click(screen.getByRole("button", { name: "تحقّق" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("shows an error on invalid credentials", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(401, { error: { code: "UNAUTHORIZED", statusCode: 401 } }),
    );
    renderLogin();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "founder@acme.test");
    await user.type(screen.getByLabelText("كلمة المرور"), "wrong");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      ),
    );
  });
});
