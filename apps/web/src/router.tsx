import { createBrowserRouter } from "react-router";
import { AppShell } from "@/components/shell/app-shell";
import { HomePage } from "@/pages/home-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PlaceholderPage } from "@/pages/placeholder-page";

/** Application routes. Everything renders inside the responsive {@link AppShell}. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "orders", element: <PlaceholderPage titleKey="nav.orders" /> },
      { path: "customers", element: <PlaceholderPage titleKey="nav.customers" /> },
      { path: "products", element: <PlaceholderPage titleKey="nav.products" /> },
      { path: "inventory", element: <PlaceholderPage titleKey="nav.inventory" /> },
      { path: "settings", element: <PlaceholderPage titleKey="nav.settings" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
