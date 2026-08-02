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
import {
  connectCarrier,
  disconnectCarrier,
  listCarriers,
  type Carrier,
} from "@/features/shipping/shipping-api";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";

type ZonesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: MasterDataItem[] };

type CarriersState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly carriers: Carrier[] };

/**
 * Shipping settings (settings tab): tenant shipping zones (master-data
 * `shipping-zones`, EPIC-7) and the carriers available through the
 * carrier-abstraction (EPIC-12 — today: `manual` only, read-only here).
 */
export function ShippingPanel(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <ShippingZonesCard />
      <CarriersCard />
    </div>
  );
}

function ShippingZonesCard(): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<ZonesState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listItems("shipping-zones", { active: true });
      setState({ kind: "ready", items: page.data });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> =
        countryCode.trim().length > 0
          ? { name: trimmedName, countryCode: countryCode.trim() }
          : { name: trimmedName };
      const created = await createItem("shipping-zones", body);
      setState((s) => (s.kind === "ready" ? { ...s, items: [...s.items, created] } : s));
      setName("");
      setCountryCode("");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    await deactivateItem("shipping-zones", id);
    setState((s) => (s.kind === "ready" ? { ...s, items: s.items.filter((i) => i.id !== id) } : s));
  };

  return (
    <FeatureGate feature="master-data">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.shipping.zonesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PermissionGate permission="master-data.manage">
            <div className="flex flex-wrap gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("md.field.name")}
                aria-label={t("md.field.name")}
                className="max-w-xs"
              />
              <Input
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                placeholder={t("md.field.countryCode")}
                aria-label={t("md.field.countryCode")}
                className="max-w-[8rem]"
              />
              <Button
                size="sm"
                disabled={submitting || name.trim().length === 0}
                onClick={() => void add()}
              >
                {t("settings.shipping.addZone")}
              </Button>
            </div>
          </PermissionGate>

          {state.kind === "loading" ? <LoadingState /> : null}
          {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
          {state.kind === "ready" && state.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.shipping.zonesEmpty")}</p>
          ) : null}
          {state.kind === "ready" && state.items.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {state.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span>
                    {String(item["name"] ?? "")}
                    {item["countryCode"] ? ` (${String(item["countryCode"])})` : ""}
                  </span>
                  <PermissionGate permission="master-data.manage">
                    <Button size="sm" variant="ghost" onClick={() => void remove(item.id)}>
                      {t("md.actions.deactivate")}
                    </Button>
                  </PermissionGate>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </FeatureGate>
  );
}

function CarriersCard(): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<CarriersState>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const { data } = await listCarriers();
      setState({ kind: "ready", carriers: data });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = (updated: Carrier): void => {
    setState((s) =>
      s.kind === "ready"
        ? { ...s, carriers: s.carriers.map((c) => (c.key === updated.key ? updated : c)) }
        : s,
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.shipping.carriersTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("settings.shipping.carriersSubtitle")}</p>
        {state.kind === "loading" ? <LoadingState /> : null}
        {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
        {state.kind === "ready" ? (
          <ul className="flex flex-col gap-3">
            {state.carriers.map((carrier) => (
              <CarrierRow key={carrier.key} carrier={carrier} onChange={onChange} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One carrier row: `manual` is always connected (no action); a real carrier gets a connect/disconnect flow. */
function CarrierRow({
  carrier,
  onChange,
}: {
  carrier: Carrier;
  onChange: (updated: Carrier) => void;
}): ReactNode {
  const { t } = useI18n();
  const [connecting, setConnecting] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBuiltIn = carrier.key === "manual";

  const submit = async (): Promise<void> => {
    if (apiKey.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await connectCarrier(carrier.key, apiKey.trim());
      onChange(updated);
      setConnecting(false);
      setApiKey("");
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNPROCESSABLE_ENTITY") {
        setError(t("settings.shipping.connectInvalidKey"));
      } else if (err instanceof ApiError && err.code === "SERVICE_UNAVAILABLE") {
        setError(t("settings.shipping.connectUnavailable"));
      } else {
        setError(t("settings.shipping.connectFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await disconnectCarrier(carrier.key);
      onChange({
        key: carrier.key,
        connected: false,
        pickupLocationWarning: false,
        connectedAt: null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{carrier.key}</span>
        {isBuiltIn || carrier.connected ? (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t("settings.shipping.connected")}
          </span>
        ) : (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t("settings.shipping.notConnected")}
          </span>
        )}
      </div>

      {carrier.pickupLocationWarning ? (
        <p className="text-xs text-amber-600">{t("settings.shipping.pickupLocationWarning")}</p>
      ) : null}

      {!isBuiltIn && !carrier.connected && !connecting ? (
        <Button size="sm" className="self-start" onClick={() => setConnecting(true)}>
          {t("settings.shipping.connectAction")}
        </Button>
      ) : null}

      {!isBuiltIn && connecting ? (
        <div className="flex flex-col gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("settings.shipping.apiKeyPlaceholder")}
            aria-label={t("settings.shipping.apiKeyPlaceholder")}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={submitting || apiKey.trim().length === 0}
              onClick={() => void submit()}
            >
              {t("settings.shipping.connectAction")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConnecting(false);
                setApiKey("");
                setError(null);
              }}
            >
              {t("md.actions.cancel")}
            </Button>
          </div>
          {error !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {!isBuiltIn && carrier.connected ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          disabled={submitting}
          onClick={() => void disconnect()}
        >
          {t("settings.shipping.disconnectAction")}
        </Button>
      ) : null}
    </li>
  );
}
