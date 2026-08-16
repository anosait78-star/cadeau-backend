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

  it("creates an account and lands on the dashboard", async () => {
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

  it("registers then joins a company as a vendor by warehouse code (Vendor Accounts, Phase 1)", async () => {
    const user = userEvent.setup();
    const companyId = "c1";
    fetchMock
      .mockResolvedValueOnce(json(201, TOKENS_AND_USER)) // register
      .mockResolvedValueOnce(json(200, ME)) // /me (from register)
      .mockResolvedValueOnce(
        json(200, { companyId, role: "vendor", warehouseId: "w1", alreadyMember: false }),
      ) // warehouse-join-codes/accept
      .mockResolvedValueOnce(json(200, TOKENS_AND_USER)) // companies/{id}/switch
      .mockResolvedValueOnce(json(200, { ...ME, activeCompanyId: companyId })); // /me (post-switch)
    renderRegister();

    await user.type(screen.getByLabelText("البريد الإلكتروني"), "vendor@acme.test");
    await user.type(screen.getByLabelText("كلمة المرور"), "correct horse battery");
    await user.click(screen.getByRole("radio", { name: "الانضمام إلى شركة (كود تاجر)" }));
    await user.type(screen.getByLabelText("كود دعوة المستودع"), "a-warehouse-join-code");
    await user.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/warehouse-join-codes/accept"),
      expect.objectContaining({ method: "POST" }),
    );
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
});
