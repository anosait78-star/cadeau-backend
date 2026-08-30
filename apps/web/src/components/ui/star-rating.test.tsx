import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StarRatingDisplay } from "./star-rating";

describe("StarRatingDisplay", () => {
  it("renders the rating to one decimal", () => {
    render(<StarRatingDisplay value={4.25} />);
    expect(screen.getByText("4.3")).toBeInTheDocument();
  });

  it("degrades to a dash instead of throwing when the rating is not a number", () => {
    // A malformed or half-loaded API record must not take the panel down.
    render(<StarRatingDisplay value={undefined as unknown as number} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("clamps a rating that falls outside 0-5", () => {
    render(<StarRatingDisplay value={9} />);
    expect(screen.getByText("5.0")).toBeInTheDocument();
  });
});
