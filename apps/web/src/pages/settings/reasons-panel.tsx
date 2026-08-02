import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createItem,
  deactivateItem,
  listItems,
  type MasterDataItem,
} from "@/features/master-data/master-data-api";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";

type Kind = "cancellation" | "return";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: MasterDataItem[] };

/**
 * Order-reason management (settings tab): two independent sections —
 * cancellation reasons and return reasons — backed by the `order-reasons`
 * master-data resource (already tenant-editable, EPIC-7), filtered by `kind`.
 */
export function ReasonsPanel(): ReactNode {
  return (
    <FeatureGate feature="master-data">
      <div className="flex flex-col gap-6">
        <ReasonSection kind="cancellation" titleKey="settings.reasons.cancellationTitle" />
        <ReasonSection kind="return" titleKey="settings.reasons.returnTitle" />
      </div>
    </FeatureGate>
  );
}

function ReasonSection({ kind, titleKey }: { kind: Kind; titleKey: TranslationKey }): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listItems("order-reasons", { active: true, filters: { kind } });
      setState({ kind: "ready", items: page.data });
    } catch {
      setState({ kind: "error" });
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (): Promise<void> => {
    const name = draft.trim();
    if (name.length === 0) return;
    setSubmitting(true);
    try {
      const created = await createItem("order-reasons", { name, kind });
      setState((s) => (s.kind === "ready" ? { ...s, items: [...s.items, created] } : s));
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    await deactivateItem("order-reasons", id);
    setState((s) => (s.kind === "ready" ? { ...s, items: s.items.filter((i) => i.id !== id) } : s));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PermissionGate permission="master-data.manage">
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("settings.reasons.addPlaceholder")}
              aria-label={t(titleKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <Button
              size="sm"
              disabled={submitting || draft.trim().length === 0}
              onClick={() => void add()}
            >
              {t("settings.reasons.add")}
            </Button>
          </div>
        </PermissionGate>

        {state.kind === "loading" ? <LoadingState /> : null}
        {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
        {state.kind === "ready" && state.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.reasons.empty")}</p>
        ) : null}
        {state.kind === "ready" && state.items.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {state.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-sm"
              >
                <span>{String(item["name"] ?? "")}</span>
                <PermissionGate permission="master-data.manage">
                  <button
                    type="button"
                    aria-label={t("settings.reasons.remove")}
                    onClick={() => void remove(item.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </PermissionGate>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
