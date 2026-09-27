import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AppProviders } from "@/providers/app-providers";
import { RegisterPage } from "./register-page";

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
  user: { id: "u1", email: "new@acme.test", fullName: null },
};

const ME = {
  id: "u1",
  email: "new@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: null,
  companies: [],
};

function renderRegister(): void {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("RegisterPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an account and lands on the dashboard (RequireAuth sends 0-company users onward to onboarding)", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(json(201, TOKENS_AND_USER)) // register
      .mockResolvedValueOnce(json(200, ME)); // /me
    renderRegister();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "new@acme.test");
    await user.type(screen.getByLabelText("كلمة المرور"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("shows a conflict error when the email is already taken", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(409, { error: { code: "CONFLICT", statusCode: 409 } }));
    renderRegister();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "taken@acme.test");
    await user.type(screen.getByLabelText("كلمة المرور"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "يوجد حساب بهذا البريد الإلكتروني بالفعل.",
      ),
    );
  });

  it("puts a rejected field's message under that field, in place of the generic line", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(400, {
        error: {
          code: "VALIDATION_FAILED",
          statusCode: 400,
          details: [
            { field: "phone", messages: ["phone must be a valid phone number"] },
            { field: "password", messages: ["password must be longer than 8 characters"] },
          ],
        },
      }),
    );
    renderRegister();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "new@acme.test");
    await user.type(screen.getByLabelText(/كلمة المرور/), "short");
    await user.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    const phone = await screen.findByText("استخدم أرقامًا إنجليزية فقط، مثال: 01001234567.");
    expect(screen.getByText("كلمة المرور لا تقل عن 8 حروف.")).toBeInTheDocument();
    // The offending inputs are marked, and each message is tied to its own input.
    expect(screen.getByLabelText(/الهاتف/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/الهاتف/)).toHaveAccessibleDescription(phone.textContent!);
    // The API's English constraint text never reaches the reader.
    expect(screen.queryByText(/must be/)).not.toBeInTheDocument();
    // …and the vague summary steps aside for the specific messages.
    expect(screen.queryByText("يُرجى مراجعة الحقول المميّزة.")).not.toBeInTheDocument();
  });

  it("falls back to the generic message when the rejection names no field", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(400, { error: { code: "VALIDATION_FAILED", statusCode: 400 } }),
    );
    renderRegister();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "new@acme.test");
    await user.type(screen.getByLabelText(/كلمة المرور/), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("يُرجى مراجعة الحقول المميّزة."),
    );
  });
});
