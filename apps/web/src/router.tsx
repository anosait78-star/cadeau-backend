import { createBrowserRouter } from "react-router";
import { RequireAuth } from "@/auth/require-auth";
import { AppShell } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/features/access/require-super-admin";
import { AdminPage } from "@/pages/admin/admin-page";
import { AnalyticsPage } from "@/pages/analytics/analytics-page";
import { CustomersPage } from "@/pages/customers/customers-page";
import { DashboardPage } from "@/pages/dashboard/dashboard-page";
import { FinancePage } from "@/pages/finance/finance-page";
import { InventoryPage } from "@/pages/inventory/inventory-page";
import { MasterDataPage } from "@/pages/master-data/master-data-page";
import { OrdersPage } from "@/pages/orders/orders-page";
import { ProductsPage } from "@/pages/products/products-page";
import { LoginPage } from "@/pages/auth/login-page";
import { RegisterPage } from "@/pages/auth/register-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { CreateCompanyPage } from "@/pages/onboarding/create-company-page";
import { JoinCompanyPage } from "@/pages/onboarding/join-company-page";
import { OnboardingStartPage } from "@/pages/onboarding/onboarding-start-page";
import { VendorDashboardPage } from "@/pages/vendor/vendor-dashboard-page";
import { VendorOrderDetailPage } from "@/pages/vendor/vendor-order-detail-page";
import { VendorOrdersPage } from "@/pages/vendor/vendor-orders-page";
import { NotificationsPage } from "@/pages/settings/notifications-page";
import { RolesPage } from "@/pages/settings/roles-page";
import { SettingsPage } from "@/pages/settings/settings-page";
import { TeamPage } from "@/pages/settings/team-page";

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
      { path: "onboarding", element: <OnboardingStartPage /> },
      { path: "onboarding/create", element: <CreateCompanyPage /> },
      { path: "onboarding/join", element: <JoinCompanyPage /> },
      { path: "vendor", element: <VendorDashboardPage /> },
      { path: "vendor/orders", element: <VendorOrdersPage /> },
      { path: "vendor/orders/:groupId", element: <VendorOrderDetailPage /> },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "orders", element: <OrdersPage /> },
          { path: "customers", element: <CustomersPage /> },
          { path: "products", element: <ProductsPage /> },
          { path: "inventory", element: <InventoryPage /> },
          { path: "finance", element: <FinancePage /> },
          { path: "analytics", element: <AnalyticsPage /> },
          { path: "master-data", element: <MasterDataPage /> },
          { path: "settings/roles", element: <RolesPage /> },
          { path: "settings/team", element: <TeamPage /> },
          { path: "settings/notifications", element: <NotificationsPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "settings/:tab", element: <SettingsPage /> },
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
