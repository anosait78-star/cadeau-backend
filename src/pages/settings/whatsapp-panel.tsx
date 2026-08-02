import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { updateWhatsappCountryCode } from "@/auth/auth-api";
import { useAuth } from "@/auth/use-auth";
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

/**
 * WhatsApp settings tab: the dialing prefix prepended to phone numbers, plus
 * reusable message templates (master-data `whatsapp-templates`, new for this
 * settings epic). No WhatsApp provider is wired up yet — these are the
 * settings a future send-integration would read.
 */
export function WhatsappPanel(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <CountryCodeCard />
      <TemplatesCard />
    </div>
  );
}

function CountryCodeCard(): ReactNode {
  const { t } = useI18n();
  const { user, reload } = useAuth();
  const activeCompany =
    user === null ? null : (user.companies.find((c) => c.id === user.activeCompanyId) ?? null);
  const [value, setValue] = useState(activeCompany?.whatsappCountryCode ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(activeCompany?.whatsappCountryCode ?? "");
  }, [activeCompany?.whatsappCountryCode]);

  const save = async (): Promise<void> => {
    if (user?.activeCompanyId === null || user?.activeCompanyId === undefined) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateWhatsappCountryCode(user.activeCompanyId, value.trim() || null);
      await reload();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.whatsapp.countryCodeTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t("settings.whatsapp.countryCodeSubtitle")}
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="20"
            aria-label={t("settings.whatsapp.countryCodeTitle")}
            className="max-w-[8rem]"
          />
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {t("md.actions.save")}
          </Button>
          {saved ? (
            <span role="status" className="text-sm text-primary">
              {t("md.saved")}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: MasterDataItem[] };

function TemplatesCard(): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listItems("whatsapp-templates", { active: true });
      setState({ kind: "ready", items: page.data });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (): Promise<void> => {
    if (name.trim().length === 0 || body.trim().length === 0) return;
    setSubmitting(true);
    try {
      const created = await createItem("whatsapp-templates", {
        name: name.trim(),
        body: body.trim(),
      });
      setState((s) => (s.kind === "ready" ? { ...s, items: [...s.items, created] } : s));
      setName("");
      setBody("");
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    await deactivateItem("whatsapp-templates", id);
    setState((s) => (s.kind === "ready" ? { ...s, items: s.items.filter((i) => i.id !== id) } : s));
  };

  return (
    <FeatureGate feature="master-data">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.whatsapp.templatesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.whatsapp.templatesSubtitle")}
          </p>

          <PermissionGate permission="master-data.manage">
            {adding ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("md.field.name")}
                  aria-label={t("md.field.name")}
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("settings.whatsapp.templateBody")}
                  aria-label={t("settings.whatsapp.templateBody")}
                  rows={3}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={submitting || name.trim().length === 0 || body.trim().length === 0}
                    onClick={() => void add()}
                  >
                    {t("md.actions.save")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    {t("md.actions.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" className="self-start" onClick={() => setAdding(true)}>
                {t("settings.whatsapp.addTemplate")}
              </Button>
            )}
          </PermissionGate>

          {state.kind === "loading" ? <LoadingState /> : null}
          {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
          {state.kind === "ready" && state.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.whatsapp.templatesEmpty")}</p>
          ) : null}
          {state.kind === "ready" && state.items.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {state.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-1 rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{String(item["name"] ?? "")}</span>
                    <PermissionGate permission="master-data.manage">
                      <Button size="sm" variant="ghost" onClick={() => void remove(item.id)}>
                        {t("settings.reasons.remove")}
                      </Button>
                    </PermissionGate>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {String(item["body"] ?? "")}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </FeatureGate>
  );
}
