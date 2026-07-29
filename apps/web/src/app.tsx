import type { ReactNode } from "react";
import { RouterProvider } from "react-router";
import { AppProviders } from "@/providers/app-providers";
import { router } from "@/router";

/** Root component: providers + router. */
export function App(): ReactNode {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
