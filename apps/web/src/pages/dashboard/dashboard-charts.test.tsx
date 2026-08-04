import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@/i18n/dictionaries";
import { SalesChart, StatusChart } from "./dashboard-charts";

const t = (key: TranslationKey): string => key;

describe("SalesChart", () => {
  it("renders a flat baseline when there is no data", () => {
    render(<SalesChart points={[]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("renders one bar per point", () => {
    render(
      <SalesChart
        points={[
          { bucket: "2026-01-01", orderCount: 1, collectedMinor: 100 },
          { bucket: "2026-01-02", orderCount: 2, collectedMinor: 400 },
        ]}
      />,
    );
    const svg = screen.getByRole("img", { name: "sales" });
    expect(svg.querySelectorAll("rect")).toHaveLength(2);
  });
});

describe("StatusChart", () => {
  it("renders one row per order status, scaled to the largest count", () => {
    render(<StatusChart counts={{ new: 4, delivered: 2 }} t={t} />);
    expect(screen.getByText("orders.status.new")).toBeInTheDocument();
    expect(screen.getByText("orders.status.delivered")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
