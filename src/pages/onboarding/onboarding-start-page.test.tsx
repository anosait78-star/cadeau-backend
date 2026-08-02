import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AppProviders } from "@/providers/app-providers";
import { OnboardingStartPage } from "./onboarding-start-page";

function renderStart(): void {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingStartPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("OnboardingStartPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("links to the create-company and join-company screens", () => {
    renderStart();
    expect(screen.getByRole("link", { name: /إنشاء شركة/ })).toHaveAttribute(
      "href",
      "/onboarding/create",
    );
    expect(screen.getByRole("link", { name: /الانضمام لشركة/ })).toHaveAttribute(
      "href",
      "/onboarding/join",
    );
  });
});
