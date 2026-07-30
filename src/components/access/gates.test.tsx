import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { FeatureGate } from "./feature-gate";
import { PermissionGate } from "./permission-gate";

function withCaps(features: string[], permissions: string[], children: ReactNode): ReactNode {
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

describe("FeatureGate", () => {
  it("renders children when the feature is enabled", () => {
    render(withCaps(["orders"], [], <FeatureGate feature="orders">shown</FeatureGate>));
    expect(screen.getByText("shown")).toBeInTheDocument();
  });

  it("renders the fallback when the feature is missing", () => {
    render(
      withCaps(
        [],
        [],
        <FeatureGate feature="orders" fallback={<span>hidden</span>}>
          shown
        </FeatureGate>,
      ),
    );
    expect(screen.queryByText("shown")).not.toBeInTheDocument();
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });
});

describe("PermissionGate", () => {
  it("renders children when the permission is held", () => {
    render(
      withCaps(
        [],
        ["orders.manage"],
        <PermissionGate permission="orders.manage">ok</PermissionGate>,
      ),
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("hides children when the permission is missing", () => {
    render(withCaps([], [], <PermissionGate permission="orders.manage">ok</PermissionGate>));
    expect(screen.queryByText("ok")).not.toBeInTheDocument();
  });

  it("also requires the feature when both are given", () => {
    render(
      withCaps(
        [],
        ["orders.manage"],
        <PermissionGate permission="orders.manage" feature="orders">
          ok
        </PermissionGate>,
      ),
    );
    expect(screen.queryByText("ok")).not.toBeInTheDocument();
  });
});
