import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { shipmentErrorText } from "./shipment-error-text";
import { createShipment, listCarriers, type Shipment } from "./shipping-api";

const DASH = "—";

/**
 * The "select a carrier" step between clicking "Create shipment" and the
 * shipment actually being created (docs request: no more silent
 * auto-dispatch to whichever carrier happens to be connected). Carrier list
 * comes from `GET /shipping/carriers` (connected, non-`manual` only) — no
 * carrier name is hardcoded here, so a future SMSA/Aramex/etc. connection
 * appears automatically without touching this component.
 *
 * On a missing/unmapped customer address (the one validation failure a user
 * can actually fix themselves), shows a friendly message plus a shortcut to
 * the customer's edit screen instead of the raw server error.
 */
export function SelectCarrierDialog({
  open,
  onOpenChange,
  orderId,
  customerId,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly orderId: string;
  readonly customerId: string;
  readonly onCreated: (shipment: Shipment) => void;
}): ReactNode {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [carriers, setCarriers] = useState<string[]>([]);
  const [carriersLoaded, setCarriersLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [addressError, setAddressError] = useState(false);
  const [otherError, setOtherError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAddressError(false);
    setOtherError(null);
    setCarriersLoaded(false);
    listCarriers()
      .then(({ data }) => {
        const connected = data.filter((c) => c.connected).map((c) => c.key);
        setCarriers(connected);
        setSelected(connected.length === 1 ? (connected[0] ?? "") : "");
      })
      .catch(() => setCarriers([]))
      .finally(() => setCarriersLoaded(true));
  }, [open]);

  const proceed = async (): Promise<void> => {
    if (selected === "") return;
    setPending(true);
    setAddressError(false);
    setOtherError(null);
    try {
      const shipment = await createShipment(orderId, selected);
      onCreated(shipment);
      onOpenChange(false);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "UNPROCESSABLE_ENTITY" &&
        error.message.toLowerCase().includes("address")
      ) {
        setAddressError(true);
      } else {
        setOtherError(shipmentErrorText(error, t));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg">
          <Dialog.Title className="text-sm font-semibold">
            {t("shipping.selectCarrier.title")}
          </Dialog.Title>

          <div className="mt-3 flex flex-col gap-3">
            {carriersLoaded && carriers.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">{t("shipping.selectCarrier.none")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    navigate("/settings/shipping");
                  }}
                >
                  {t("shipping.selectCarrier.goToSettings")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Label htmlFor="select-carrier">{t("shipping.selectCarrier.field")}</Label>
                <select
                  id="select-carrier"
                  aria-label={t("shipping.selectCarrier.field")}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{DASH}</option>
                  {carriers.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {addressError ? (
              <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p>{t("shipping.addressMissing.message")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/customers?edit=${customerId}`);
                  }}
                >
                  {t("shipping.addressMissing.editCustomer")}
                </Button>
              </div>
            ) : null}

            {otherError !== null ? <p className="text-sm text-destructive">{otherError}</p> : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                {t("shipping.selectCarrier.cancel")}
              </Button>
            </Dialog.Close>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || selected === ""}
              onClick={() => void proceed()}
            >
              {t("shipping.selectCarrier.continue")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
