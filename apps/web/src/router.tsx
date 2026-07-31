import { createBrowserRouter } from "react-router";
import { RequireAuth } from "@/auth/require-auth";
import { AppShell } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/features/access/require-super-admin";
import { AdminPage } from "@/pages/admin/admin-page";
import { CustomersPage } from "@/pages/customers/customers-page";
import { HomePage } from "@/pages/home-page";
import { InventoryPage } from "@/pages/inventory/inventory-page";
import { MasterDataPage } from "@/pages/master-data/master-data-page";
import { ProductsPage } from "@/pages/products/products-page";
import { LoginPage } from "@/pages/auth/login-page";
import { RegisterPage } from "@/pages/auth/register-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PlaceholderPage } from "@/pages/placeholder-page";
import { RolesPage } from "@/pages/settings/roles-page";

/**
 * Application routes. Public auth screens (`/login`, `/register`) render on their
 * own centered layout; everything else lives behind {@link RequireAuth} inside
 * the responsive {@link AppShell} — unauthenticated access redirects to /login.
 */
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "orders", element: <PlaceholderPage titleKey="nav.orders" /> },
          { path: "customers", element: <CustomersPage /> },
          { path: "products", element: <ProductsPage /> },
          { path: "inventory", element: <InventoryPage /> },
          { path: "master-data", element: <MasterDataPage /> },
          { path: "settings/roles", element: <RolesPage /> },
          { path: "settings", element: <PlaceholderPage titleKey="nav.settings" /> },
          {
            path: "admin",
            element: (
              <RequireSuperAdmin>
                <AdminPage />
              </RequireSuperAdmin>
            ),
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
