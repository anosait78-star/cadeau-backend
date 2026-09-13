import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/layout/page-title";
import { getPermissionTemplates, type PermissionTemplateView } from "@/features/access/access-api";
import { permissionLabelFromKey } from "@/features/team/permission-labels";
import { templateLabel } from "@/features/team/template-labels";
import { useI18n } from "@/i18n/i18n-provider";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly templates: PermissionTemplateView[] };

/**
 * Roles & Access (settings): a read-only reference of the permission templates
 * and the permissions each grants (`GET /v1/access/permission-templates`). Gated
 * by `access.read` at the nav + server. Per-member assignment (the
 * `PUT /access/members/{id}/permissions` endpoint) is exercised by the API and
 * awaits a tenancy members-list endpoint for its management table.
 */
export function RolesPage(): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data } = await getPermissionTemplates();
        if (active) setState({ kind: "ready", templates: data });
      } catch {
        if (active) setState({ kind: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 lg:p-6">
      <PageTitle title={t("roles.title")} description={t("roles.subtitle")} />

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => setState({ kind: "loading" })} /> : null}
      {state.kind === "ready" && state.templates.length === 0 ? (
        <EmptyState title={t("roles.empty")} />
      ) : null}

      {state.kind === "ready" && state.templates.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {state.templates.map((template) => {
            // The API sends the seed's English name/description and bare
            // permission keys (`orders.manage`); both are translated here.
            const label = templateLabel(template, t);
            return (
              <Card key={template.key}>
                <CardHeader>
                  <CardTitle>{label.name}</CardTitle>
                  {label.description !== null ? (
                    <CardDescription>{label.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                    {t("roles.permissions")}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {template.permissions.map((permission) => {
                      const perm = permissionLabelFromKey(permission, t);
                      return (
                        <li
                          key={permission}
                          title={perm.description.length > 0 ? perm.description : undefined}
                          className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
                        >
                          {perm.name}
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
