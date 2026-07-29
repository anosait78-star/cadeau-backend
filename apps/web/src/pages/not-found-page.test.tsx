import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { NotFoundPage } from "./not-found-page";

describe("NotFoundPage", () => {
  it("renders the localized not-found state and navigates home", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/nope"]}>
          <Routes>
            <Route path="/" element={<p>home</p>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByText("الصفحة غير موجودة")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "العودة إلى الرئيسية" }));
    expect(screen.getByText("home")).toBeInTheDocument();
  });
});
