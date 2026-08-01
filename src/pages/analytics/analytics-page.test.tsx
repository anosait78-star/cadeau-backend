import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AnalyticsPage } from "./analytics-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function caps(features: string[], permissions: string[], children: ReactNode): ReactNode {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features,
    permissions,
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || features.includes(req.feature)) &&
      (req.permission === undefined || permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  return <CapabilitiesContext value={value}>{children}</CapabilitiesContext>;
}

function renderPage(
  features = ["analytics"],
  permissions = ["analytics.read", "analytics.manage"],
) {
  return render(<I18nProvider>{caps(features, permissions, <AnalyticsPage />)}</I18nProvider>);
}

const BUSINESS = {
  orderCount: 10,
  collectedMinor: 100000,
  averageOrderValueMinor: 10000,
  orderCountDeltaPct: 12.5,
  collectedDeltaPct: null,
  series: [{ bucket: "2026-01-01T00:00:00.000Z", orderCount: 10, collectedMinor: 100000 }],
  granularity: "day",
};

const STAFF = {
  rows: [{ assigneeId: "u1", assigneeName: "Amina", orderCount: 3, collectedMinor: 30000 }],
};

describe("AnalyticsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn().mockResolvedValue(json(200, BUSINESS));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the forbidden fallback without the analytics feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to analytics.")).toBeTruthy();
  });

  it("loads and renders the business axis by default", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    expect(fetchMock.mock.calls[0]![0] as string).toContain("/analytics/business");
  });

  it("switches tabs and fetches the staff axis", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("/analytics/staff") ? json(200, STAFF) : json(200, BUSINESS)),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Staff" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/analytics/staff"))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.getByText("Amina")).toBeTruthy());
  });

  it("triggers an export request when Export CSV is clicked", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    fetchMock.mockResolvedValueOnce(new Response(new Blob(["a,b\r\n"]), { status: 200 }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/analytics/export"))).toBe(
        true,
      ),
    );
  });
});
