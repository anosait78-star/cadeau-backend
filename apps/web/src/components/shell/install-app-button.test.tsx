import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInstallPromptState } from "@/hooks/use-install-prompt";
import { I18nProvider } from "@/i18n/i18n-provider";
import { InstallAppButton } from "./install-app-button";

interface PromptStub {
  readonly event: Event;
  readonly prompt: ReturnType<typeof vi.fn>;
}

/** Fires the Chromium `beforeinstallprompt` event the button waits for. */
function fireInstallPrompt(outcome: "accepted" | "dismissed" = "accepted"): PromptStub {
  const prompt = vi.fn(() => Promise.resolve());
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

function setUserAgent(value: string): void {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
}

const REAL_USER_AGENT = window.navigator.userAgent;

function renderButton(compact = false): void {
  render(
    <I18nProvider>
      <InstallAppButton compact={compact} />
    </I18nProvider>,
  );
}

describe("InstallAppButton", () => {
  beforeEach(() => {
    resetInstallPromptState();
  });

  afterEach(() => {
    setUserAgent(REAL_USER_AGENT);
    resetInstallPromptState();
  });

  it("renders nothing while the browser has not offered an install prompt", () => {
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("appears once the browser offers the install prompt", () => {
    renderButton();
    fireInstallPrompt();
    expect(screen.getByRole("button", { name: "تثبيت التطبيق" })).toBeInTheDocument();
  });

  it("suppresses the browser's own mini-infobar so the in-app button is the only affordance", () => {
    renderButton();
    const { event } = fireInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the browser install dialog on click and then hides itself", async () => {
    const user = userEvent.setup();
    renderButton();
    const { prompt } = fireInstallPrompt("accepted");

    await user.click(screen.getByRole("button", { name: "تثبيت التطبيق" }));

    expect(prompt).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("disappears when the app reports it has been installed", async () => {
    renderButton();
    fireInstallPrompt();
    expect(screen.getByRole("button", { name: "تثبيت التطبيق" })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("stays hidden while running as an installed app", () => {
    const standalone = vi.fn(
      (query: string) => ({ matches: query.includes("standalone") }) as MediaQueryList,
    );
    window.matchMedia = standalone as unknown as typeof window.matchMedia;
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers Add to Home Screen instructions on iOS, where no prompt event exists", async () => {
    const user = userEvent.setup();
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    renderButton();

    await user.click(screen.getByRole("button", { name: "تثبيت التطبيق" }));

    expect(await screen.findByText("تثبيت التطبيق على جهازك")).toBeInTheDocument();
    expect(screen.getByText("اختر «إضافة إلى الشاشة الرئيسية».")).toBeInTheDocument();
  });

  it("renders an icon-only button with an accessible name when compact", () => {
    renderButton(true);
    fireInstallPrompt();
    const button = screen.getByRole("button", { name: "تثبيت التطبيق" });
    expect(button).toHaveTextContent("");
  });
});
