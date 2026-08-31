import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { OfflineBanner } from "./offline-banner";

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

afterEach(() => setOnline(true));

describe("OfflineBanner", () => {
  it("stays out of the way while the connection is up", () => {
    setOnline(true);
    render(
      <I18nProvider>
        <OfflineBanner />
      </I18nProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains the situation while offline", () => {
    setOnline(false);
    render(
      <I18nProvider>
        <OfflineBanner />
      </I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("أنت غير متصل");
  });

  it("appears and clears as the connection drops and returns", () => {
    setOnline(true);
    render(
      <I18nProvider>
        <OfflineBanner />
      </I18nProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
