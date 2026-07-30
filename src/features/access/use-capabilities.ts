import { useContext } from "react";
import { CapabilitiesContext, type CapabilitiesContextValue } from "./capabilities-context";

/** Access the resolved capability set and the `has(...)` check. Must be within a CapabilitiesProvider. */
export function useCapabilities(): CapabilitiesContextValue {
  const context = useContext(CapabilitiesContext);
  if (context === undefined) {
    throw new Error("useCapabilities must be used within a CapabilitiesProvider");
  }
  return context;
}
