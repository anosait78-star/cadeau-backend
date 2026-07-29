import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./i18n-provider";

function I18nProbe() {
  const { t, dir, toggleLocale } = useI18n();
  return (
    <div>
      <span data-testid="name">{t("app.name")}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="interpolated">{t("app.name", { unused: 1 })}</span>
      <button type="button" onClick={toggleLocale}>
        switch
      </button>
    </div>
  );
}

describe("I18nProvider", () => {
  it("defaults to Arabic (RTL) and sets <html> lang/dir", () => {
    render(
      <I18nProvider>
        <I18nProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("name")).toHaveTextContent("كادو CRM");
    expect(screen.getByTestId("dir")).toHaveTextContent("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("toggles to English (LTR) and flips direction", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <I18nProbe />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByTestId("name")).toHaveTextContent("Cadeau CRM");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(localStorage.getItem("cadeau.locale")).toBe("en");
  });

  it("interpolation leaves a placeholder-free string unchanged", () => {
    render(
      <I18nProvider>
        <I18nProbe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("interpolated")).toHaveTextContent("كادو CRM");
  });

  it("throws when useI18n is used outside the provider", () => {
    expect(() => render(<I18nProbe />)).toThrow(/I18nProvider/);
  });
});
