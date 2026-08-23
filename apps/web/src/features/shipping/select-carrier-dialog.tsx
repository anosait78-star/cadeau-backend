import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { getCustomer } from "@/features/customers/customers-api";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { shipmentErrorText } from "./shipment-error-text";
import {
  createShipment,
  listBostaCities,
  listBostaDistricts,
  listCarriers,
  type BostaCity,
  type BostaDistrict,
  type Shipment,
} from "./shipping-api";

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

  // Bosta-specific fields (EPIC-12 follow-up): collected here, once, at
  // shipment-creation time — the customer/order forms no longer have a
  // carrier-mapping section. Nothing here is persisted anywhere; it's used
  // for this one shipment only.
  const [bostaCities, setBostaCities] = useState<BostaCity[]>([]);
  const [bostaDistricts, setBostaDistricts] = useState<BostaDistrict[]>([]);
  const [bostaCityId, setBostaCityId] = useState("");
  const [bostaZoneId, setBostaZoneId] = useState("");
  const [bostaDistrictId, setBostaDistrictId] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [landmark, setLandmark] = useState("");
  const [notes, setNotes] = useState("");
  const [goodsValue, setGoodsValue] = useState("");
  const [recipientFirstName, setRecipientFirstName] = useState("");
  const [recipientLastName, setRecipientLastName] = useState("");
  const [recipientPhone2, setRecipientPhone2] = useState("");
  const [allowToOpenPackage, setAllowToOpenPackage] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddressError(false);
    setOtherError(null);
    setCarriersLoaded(false);
    setBostaCityId("");
    setBostaZoneId("");
    setBostaDistrictId("");
    setAddressLine("");
    setLandmark("");
    setNotes("");
    setGoodsValue("");
    setRecipientFirstName("");
    setRecipientLastName("");
    setRecipientPhone2("");
    setAllowToOpenPackage(false);
    listCarriers()
      .then(({ data }) => {
        const connected = data.filter((c) => c.connected).map((c) => c.key);
        setCarriers(connected);
        setSelected(connected.length === 1 ? (connected[0] ?? "") : "");
      })
      .catch(() => setCarriers([]))
      .finally(() => setCarriersLoaded(true));
    // The recipient name defaults to a split of the customer's own name, and
    // the address to whatever the customer happens to have saved — both are
    // convenience prefills the user is free to overwrite, not values the
    // shipment is bound to. A customer with no saved address just starts blank.
    void getCustomer(customerId)
      .then((customer) => {
        const [first, ...rest] = customer.name.trim().split(/\s+/);
        setRecipientFirstName(first ?? "");
        setRecipientLastName(rest.join(" "));
        const saved =
          customer.addresses.find((a) => a.isDefault && a.active) ??
          customer.addresses.find((a) => a.active);
        if (saved !== undefined) {
          setAddressLine(saved.line);
          setLandmark(saved.landmark ?? "");
        }
      })
      .catch(() => undefined);
  }, [open, customerId]);

  useEffect(() => {
    if (selected !== "bosta") return;
    void listBostaCities().then(({ data }) => setBostaCities(data));
  }, [selected]);

  useEffect(() => {
    if (selected !== "bosta" || bostaCityId === "") {
      setBostaDistricts([]);
      return;
    }
    void listBostaDistricts(bostaCityId).then(({ data }) => setBostaDistricts(data));
  }, [selected, bostaCityId]);

  const selectedCity = bostaCities.find((c) => c.id === bostaCityId);

  // Zone is a pure narrowing step over the districts already fetched for the
  // city (each carries its own zoneId/zoneName) — no separate endpoint.
  const zones = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of bostaDistricts) seen.set(d.zoneId, d.zoneName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [bostaDistricts]);
  const districtsInZone = useMemo(
    () =>
      bostaZoneId === "" ? bostaDistricts : bostaDistricts.filter((d) => d.zoneId === bostaZoneId),
    [bostaDistricts, bostaZoneId],
  );

  const proceed = async (): Promise<void> => {
    if (selected === "") return;
    setPending(true);
    setAddressError(false);
    setOtherError(null);
    try {
      const shipment = await createShipment(
        orderId,
        selected,
        selected === "bosta"
          ? {
              ...(bostaCityId !== "" ? { bostaCityId } : {}),
              ...(selectedCity !== undefined ? { bostaCityName: selectedCity.name } : {}),
              ...(bostaDistrictId !== "" ? { bostaDistrictId } : {}),
              ...(addressLine.trim().length > 0 ? { addressLine: addressLine.trim() } : {}),
              ...(landmark.trim().length > 0 ? { landmark: landmark.trim() } : {}),
              ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
              ...(goodsValue.trim().length > 0
                ? { goodsValue: Math.max(0, Math.round(Number(goodsValue) * 100)) }
                : {}),
              ...(recipientFirstName.trim().length > 0
                ? { recipientFirstName: recipientFirstName.trim() }
                : {}),
              ...(recipientLastName.trim().length > 0
                ? { recipientLastName: recipientLastName.trim() }
                : {}),
              ...(recipientPhone2.trim().length > 0
                ? { recipientPhone2: recipientPhone2.trim() }
                : {}),
              allowToOpenPackage,
            }
          : undefined,
      );
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
    <Modal
      open={open}
      onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}
      title={t("shipping.selectCarrier.title")}
      closeLabel={t("shipping.selectCarrier.cancel")}
      size="sm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
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
          <FormField label={t("shipping.selectCarrier.field")} htmlFor="select-carrier" required>
            <Combobox
              id="select-carrier"
              ariaLabel={t("shipping.selectCarrier.field")}
              value={selected}
              onChange={setSelected}
              placeholder={DASH}
              options={carriers.map((key) => ({ value: key, label: key }))}
            />
          </FormField>
        )}

        {selected === "bosta" ? (
          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium">{t("customers.shippingInfo.title")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FormField
                label={t("customers.address.field.bostaCity")}
                htmlFor="select-carrier-bosta-city"
                required
              >
                <Combobox
                  id="select-carrier-bosta-city"
                  ariaLabel={t("customers.address.field.bostaCity")}
                  value={bostaCityId}
                  onChange={(value) => {
                    setBostaCityId(value);
                    setBostaZoneId("");
                    setBostaDistrictId("");
                  }}
                  placeholder={DASH}
                  options={bostaCities.map((c) => ({ value: c.id, label: c.name }))}
                />
              </FormField>
              <FormField
                label={t("shipping.selectCarrier.zone")}
                htmlFor="select-carrier-bosta-zone"
                optional
              >
                <Combobox
                  id="select-carrier-bosta-zone"
                  ariaLabel={t("shipping.selectCarrier.zone")}
                  value={bostaZoneId}
                  onChange={(value) => {
                    setBostaZoneId(value);
                    setBostaDistrictId("");
                  }}
                  placeholder={DASH}
                  disabled={bostaCityId === ""}
                  options={zones.map((z) => ({ value: z.id, label: z.name }))}
                />
              </FormField>
              <FormField
                label={t("customers.address.field.bostaDistrict")}
                htmlFor="select-carrier-bosta-district"
                required
              >
                <Combobox
                  id="select-carrier-bosta-district"
                  ariaLabel={t("customers.address.field.bostaDistrict")}
                  value={bostaDistrictId}
                  onChange={setBostaDistrictId}
                  placeholder={DASH}
                  disabled={bostaCityId === ""}
                  options={districtsInZone.map((d) => ({
                    value: d.districtId,
                    label: d.districtName,
                  }))}
                />
              </FormField>
            </div>

            <FormField
              label={t("shipping.selectCarrier.addressLine")}
              htmlFor="select-carrier-address-line"
              required
            >
              <Input
                id="select-carrier-address-line"
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                placeholder={t("shipping.selectCarrier.addressLine.placeholder")}
                aria-label={t("shipping.selectCarrier.addressLine")}
              />
            </FormField>
            <FormField
              label={t("shipping.selectCarrier.landmark")}
              htmlFor="select-carrier-landmark"
              optional
            >
              <Input
                id="select-carrier-landmark"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                placeholder={t("shipping.selectCarrier.landmark.placeholder")}
                aria-label={t("shipping.selectCarrier.landmark")}
              />
            </FormField>

            <p className="text-sm font-medium">{t("shipping.selectCarrier.recipient")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FormField
                label={t("shipping.selectCarrier.recipientFirstName")}
                htmlFor="select-carrier-recipient-first-name"
                required
              >
                <Input
                  id="select-carrier-recipient-first-name"
                  value={recipientFirstName}
                  onChange={(e) => setRecipientFirstName(e.target.value)}
                  aria-label={t("shipping.selectCarrier.recipientFirstName")}
                />
              </FormField>
              <FormField
                label={t("shipping.selectCarrier.recipientLastName")}
                htmlFor="select-carrier-recipient-last-name"
                optional
              >
                <Input
                  id="select-carrier-recipient-last-name"
                  value={recipientLastName}
                  onChange={(e) => setRecipientLastName(e.target.value)}
                  aria-label={t("shipping.selectCarrier.recipientLastName")}
                />
              </FormField>
            </div>
            <FormField
              label={t("shipping.selectCarrier.recipientPhone2")}
              htmlFor="select-carrier-recipient-phone2"
              optional
            >
              <Input
                id="select-carrier-recipient-phone2"
                value={recipientPhone2}
                inputMode="tel"
                onChange={(e) => setRecipientPhone2(e.target.value)}
                aria-label={t("shipping.selectCarrier.recipientPhone2")}
              />
            </FormField>

            <FormField
              label={t("shipping.selectCarrier.goodsValue")}
              htmlFor="select-carrier-goods-value"
              optional
            >
              <Input
                id="select-carrier-goods-value"
                value={goodsValue}
                inputMode="decimal"
                onChange={(e) => setGoodsValue(e.target.value)}
                aria-label={t("shipping.selectCarrier.goodsValue")}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowToOpenPackage}
                onChange={(e) => setAllowToOpenPackage(e.target.checked)}
              />
              {t("shipping.selectCarrier.allowOpenPackage")}
            </label>
            <FormField label={t("orders.form.notes")} htmlFor="select-carrier-notes" optional>
              <textarea
                id="select-carrier-notes"
                className="min-h-16 rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-label={t("orders.form.notes")}
              />
            </FormField>
          </div>
        ) : null}

        {/* The address is entered in this dialog now, so a missing-address
            error is fixed right here — no detour through the customer's
            edit screen. */}
        {addressError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {t("shipping.addressMissing.message")}
          </div>
        ) : null}

        {otherError !== null ? <p className="text-sm text-destructive">{otherError}</p> : null}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
          {t("shipping.selectCarrier.cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={
            pending ||
            selected === "" ||
            (selected === "bosta" &&
              (bostaCityId === "" ||
                bostaDistrictId === "" ||
                addressLine.trim().length === 0 ||
                recipientFirstName.trim().length === 0))
          }
          onClick={() => void proceed()}
        >
          {t("shipping.selectCarrier.continue")}
        </Button>
      </div>
    </Modal>
  );
}
