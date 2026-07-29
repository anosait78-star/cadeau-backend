import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { UserMenu } from "./user-menu";

function renderMenu() {
  return render(
    <I18nProvider>
      <UserMenu />
    </I18nProvider>,
  );
}

describe("UserMenu", () => {
  it("renders the account trigger", () => {
    renderMenu();
    expect(screen.getByRole("button", { name: /الحساب/ })).toBeInTheDocument();
  });

  it("opens the dropdown and shows the account items", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /الحساب/ }));
    expect(await screen.findByRole("menuitem", { name: "الملف الشخصي" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "الإعدادات" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "تسجيل الخروج" })).toBeInTheDocument();
  });
});
