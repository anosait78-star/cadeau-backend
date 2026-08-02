import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import {
  createShipment,
  getShipmentForOrder,
  issueWaybill,
  transitionShipment,
  type Shipment,
  type ShipmentStatus,
} from "./shipping-api";

type Translate = (key: TranslationKey) => string;

/** Legal next states per current state (mirrors the server's shipment-status.ts). */
const SHIPMENT_TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  created: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "returned", "cancelled"],
  in_transit: ["delivered", "returned"],
  delivered: [],
  returned: [],
  cancelled: [],
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly shipment: Shipment };

/**
 * The shipment-tracking section of an order's detail panel (EPIC-12 M12.5).
 * Behind the `shipping` feature; create/advance/cancel/waybill need
 * `shipping.manage`. There is no live carrier webhook driving this UI (D1) —
 * the "advance to" select is the manual, authenticated stand-in a real
 * carrier's webhook otherwise drives.
 */
export function ShipmentSection({
  orderId,
  onNotify,
}: {
  orderId: string;
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const shipment = await getShipmentForOrder(orderId);
      setState(shipment === null ? { kind: "none" } : { kind: "ready", shipment });
    } catch {
      setState({ kind: "error" });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (): Promise<void> => {
    try {
      const shipment = await createShipment(orderId);
      setState({ kind: "ready", shipment });
      onNotify(t("shipping.saved"));
    } catch (error) {
      onNotify(shipmentErrorText(error, t));
    }
  };

  const onAdvance = async (toStatus: ShipmentStatus): Promise<void> => {
    if (state.kind !== "ready") return;
    try {
      const shipment = await transitionShipment(state.shipment.id, toStatus);
      setState({ kind: "ready", shipment });
      onNotify(t("shipping.saved"));
    } catch (error) {
      onNotify(shipmentErrorText(error, t));
    }
  };

  const onWaybill = async (): Promise<void> => {
    if (state.kind !== "ready") return;
    try {
      const shipment = await issueWaybill(state.shipment.id).then(() =>
        getShipmentForOrder(orderId),
      );
      if (shipment !== null) setState({ kind: "ready", shipment });
      onNotify(t("shipping.waybillIssued"));
    } catch (error) {
      onNotify(shipmentErrorText(error, t));
    }
  };

  return (
    <FeatureGate feature="shipping">
      <div className="flex flex-col gap-2 border-t pt-3">
        <h3 className="text-sm font-medium">{t("shipping.section.title")}</h3>

        {state.kind === "loading" ? <LoadingState className="p-4" /> : null}
        {state.kind === "error" ? <ErrorState onRetry={() => void load()} className="p-4" /> : null}

        {state.kind === "none" ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">{t("shipping.none")}</p>
            <PermissionGate permission="shipping.manage">
              <Button size="sm" variant="outline" onClick={() => void onCreate()}>
                {t("shipping.actions.create")}
              </Button>
            </PermissionGate>
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <ShipmentDetail shipment={state.shipment} onAdvance={onAdvance} onWaybill={onWaybill} />
        ) : null}
      </div>
    </FeatureGate>
  );
}

function ShipmentDetail({
  shipment,
  onAdvance,
  onWaybill,
}: {
  shipment: Shipment;
  onAdvance: (toStatus: ShipmentStatus) => void | Promise<void>;
  onWaybill: () => void | Promise<void>;
}): ReactNode {
  const { t, locale } = useI18n();
  const nextStates = SHIPMENT_TRANSITIONS[shipment.status];

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Field label={t("shipping.field.carrier")}>{shipment.carrier}</Field>
        <Field label={t("shipping.field.tracking")}>
          <span dir="ltr">{shipment.trackingNumber}</span>
        </Field>
        <Field label={t("shipping.field.status")}>
          {t(`shipping.status.${shipment.status}` as TranslationKey)}
        </Field>
        <Field label={t("shipping.field.fee")}>{formatMoney(shipment.fee, locale)}</Field>
      </dl>

      <PermissionGate permission="shipping.manage">
        <div className="flex flex-wrap items-center gap-2">
          {nextStates.length > 0 ? (
            <label className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">{t("shipping.actions.advance")}</span>
              <select
                className="rounded border border-input bg-background px-2 py-1 text-sm"
                value=""
                onChange={(e) => {
                  const to = e.target.value;
                  if (to === "") return;
                  void onAdvance(to as ShipmentStatus);
                }}
              >
                <option value="" disabled>
                  —
                </option>
                {nextStates.map((s) => (
                  <option key={s} value={s}>
                    {t(`shipping.status.${s}` as TranslationKey)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {shipment.waybillIssued ? (
            <span className="text-xs text-muted-foreground">{t("shipping.waybillIssued")}</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void onWaybill()}>
              {t("shipping.actions.waybill")}
            </Button>
          )}
        </div>
      </PermissionGate>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shipmentErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.code === "UNPROCESSABLE_ENTITY") return t("shipping.invalid");
    // Any other 4xx (e.g. CONFLICT on a duplicate active shipment, or a
    // FORBIDDEN/NOT_FOUND) carries a specific, user-actionable server
    // message — show it instead of the generic fallback below.
    if (error.statusCode >= 400 && error.statusCode < 500 && error.message.length > 0) {
      return error.message;
    }
  }
  return t("shipping.saveFailed");
}
