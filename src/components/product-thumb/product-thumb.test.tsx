import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductThumb } from "./product-thumb";

describe("ProductThumb (Vendor Accounts, Phase 7)", () => {
  it("shows the image when imageUrl is present", () => {
    render(<ProductThumb imageUrl="https://cdn.example.com/shirt.jpg" />);
    const img = screen.getByTestId("product-thumb-image");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/shirt.jpg");
    expect(screen.queryByTestId("product-thumb-placeholder")).not.toBeInTheDocument();
  });

  it("shows a placeholder when imageUrl is null", () => {
    render(<ProductThumb imageUrl={null} />);
    expect(screen.getByTestId("product-thumb-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("product-thumb-image")).not.toBeInTheDocument();
  });

  it("falls back to the placeholder (not a broken layout) when the image fails to load", () => {
    render(<ProductThumb imageUrl="https://cdn.example.com/missing.jpg" />);
    fireEvent.error(screen.getByTestId("product-thumb-image"));
    expect(screen.getByTestId("product-thumb-placeholder")).toBeInTheDocument();
  });
});
