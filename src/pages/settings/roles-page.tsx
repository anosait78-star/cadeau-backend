import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPermissionTemplates, type PermissionTemplateView } from "@/features/access/access-api";
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("roles.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("roles.subtitle")}</p>
      </header>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => setState({ kind: "loading" })} /> : null}
      {state.kind === "ready" && state.templates.length === 0 ? (
        <EmptyState title={t("roles.empty")} />
      ) : null}

      {state.kind === "ready" && state.templates.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {state.templates.map((template) => (
            <Card key={template.key}>
              <CardHeader>
                <CardTitle>{template.name}</CardTitle>
                {template.description !== null ? (
                  <CardDescription>{template.description}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  {t("roles.permissions")}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {template.permissions.map((permission) => (
                    <li
                      key={permission}
                      className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
                    >
                      {permission}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
