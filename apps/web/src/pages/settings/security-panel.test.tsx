import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { SecurityPanel } from "./security-panel";

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel() {
  return render(
    <I18nProvider>
      <SecurityPanel />
    </I18nProvider>,
  );
}

describe("SecurityPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates the password on success", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(204, null));
    renderPanel();

    await user.type(screen.getByLabelText("كلمة المرور الحالية"), "oldpass123");
    await user.type(screen.getByLabelText("كلمة المرور الجديدة"), "newpass456");
    await user.type(screen.getByLabelText("تأكيد كلمة المرور"), "newpass456");
    await user.click(screen.getByRole("button", { name: "تحديث كلمة المرور" }));

    expect(await screen.findByText("تم تحديث كلمة المرور.")).toBeInTheDocument();
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toContain("/auth/change-password");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      currentPassword: "oldpass123",
      newPassword: "newpass456",
    });
  });

  it("shows a mismatch error without calling the API", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText("كلمة المرور الحالية"), "oldpass123");
    await user.type(screen.getByLabelText("كلمة المرور الجديدة"), "newpass456");
    await user.type(screen.getByLabelText("تأكيد كلمة المرور"), "different789");
    await user.click(screen.getByRole("button", { name: "تحديث كلمة المرور" }));

    expect(
      await screen.findByText("كلمة المرور الجديدة وتأكيدها غير متطابقين."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a wrong-current-password message on a 400", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(400, { error: { code: "BAD_REQUEST", statusCode: 400, message: "nope" } }),
    );
    renderPanel();

    await user.type(screen.getByLabelText("كلمة المرور الحالية"), "wrong");
    await user.type(screen.getByLabelText("كلمة المرور الجديدة"), "newpass456");
    await user.type(screen.getByLabelText("تأكيد كلمة المرور"), "newpass456");
    await user.click(screen.getByRole("button", { name: "تحديث كلمة المرور" }));

    expect(await screen.findByText("كلمة المرور الحالية غير صحيحة.")).toBeInTheDocument();
  });

  it("requests account deletion after confirming", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(204, null));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "طلب حذف الحساب" }));
    await user.click(screen.getByRole("button", { name: "نعم، اطلب الحذف" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/auth/account-deletion-request"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("تم إرسال طلب الحذف للمراجعة.")).toBeInTheDocument();
  });
});
