import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatDeltaPct, formatMoney, Sparkline } from "./analytics-shared";

describe("formatMoney", () => {
  it("formats integer minor units as a 2dp decimal", () => {
    expect(formatMoney(150000, "en")).toBe("1,500.00");
  });

  it("formats zero", () => {
    expect(formatMoney(0, "en")).toBe("0.00");
  });
});

describe("formatDeltaPct", () => {
  it("formats a positive delta with a plus sign", () => {
    expect(formatDeltaPct(12.5, "en")).toBe("+12.5%");
  });

  it("formats a negative delta with a minus sign", () => {
    expect(formatDeltaPct(-8, "en")).toBe("-8%");
  });

  it("renders a dash for a null delta", () => {
    expect(formatDeltaPct(null, "en")).toBe("—");
  });
});

describe("Sparkline", () => {
  it("renders a flat baseline for an empty series", () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.querySelector("line")).not.toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("renders a polyline for a real series", () => {
    const { container } = render(
      <Sparkline
        points={[
          { bucket: "2026-01-01T00:00:00.000Z", orderCount: 1, collectedMinor: 100 },
          { bucket: "2026-01-02T00:00:00.000Z", orderCount: 2, collectedMinor: 200 },
        ]}
      />,
    );
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")?.split(" ")).toHaveLength(2);
  });

  it("does not crash on a constant series (zero span)", () => {
    const { container } = render(
      <Sparkline
        points={[
          { bucket: "2026-01-01T00:00:00.000Z", orderCount: 1, collectedMinor: 500 },
          { bucket: "2026-01-02T00:00:00.000Z", orderCount: 1, collectedMinor: 500 },
        ]}
      />,
    );
    expect(container.querySelector("polyline")).not.toBeNull();
  });
});
