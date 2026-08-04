import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";
import {
  listBostaCities,
  listBostaDistricts,
  listCarriers,
  type BostaCity,
  type BostaDistrict,
} from "./shipping-api";

const DASH = "—";

/** The customer-level shipping fields this form edits (a subset of `AddressInput`). */
export interface CarrierShippingValue {
  readonly carrier: string;
  readonly bostaCityId: string;
  readonly bostaDistrictId: string;
}

/**
 * "Shipping Information" — a carrier picker plus that carrier's own fields.
 * Shared by the standalone customer address form and the inline "new
 * customer" flow on the order-creation page, so both stay in sync as new
 * carriers are added.
 *
 * Carrier-agnostic by construction (EPIC-12's `CarrierPort`/`CarrierRouter`
 * abstraction): the company's *connected, non-manual* carriers drive the
 * select, and each carrier renders its own field block below it — today only
 * Bosta has one (city → district, cascading). Adding e.g. SMSA later means
 * adding its field block here, not redesigning this component or its
 * callers.
 */
export function CarrierShippingFields({
  value,
  onChange,
}: {
  value: CarrierShippingValue;
  onChange: (next: CarrierShippingValue & { bostaCityName: string | null }) => void;
}): ReactNode {
  const { t } = useI18n();
  const [availableCarriers, setAvailableCarriers] = useState<string[]>([]);
  const [cities, setCities] = useState<BostaCity[]>([]);
  const [districts, setDistricts] = useState<BostaDistrict[]>([]);

  useEffect(() => {
    listCarriers()
      .then(({ data }) =>
        setAvailableCarriers(
          data.filter((c) => c.connected && c.key !== "manual").map((c) => c.key),
        ),
      )
      .catch(() => setAvailableCarriers([]));
  }, []);

  useEffect(() => {
    if (value.carrier !== "bosta") return;
    void listBostaCities().then(({ data }) => setCities(data));
  }, [value.carrier]);

  useEffect(() => {
    if (value.carrier !== "bosta" || value.bostaCityId.length === 0) {
      setDistricts([]);
      return;
    }
    void listBostaDistricts(value.bostaCityId).then(({ data }) => setDistricts(data));
  }, [value.carrier, value.bostaCityId]);

  const selectedCity = cities.find((c) => c.id === value.bostaCityId);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h4 className="text-sm font-medium">{t("customers.shippingInfo.title")}</h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="shipping-carrier">{t("shipping.field.carrier")}</Label>
          <select
            id="shipping-carrier"
            aria-label={t("shipping.field.carrier")}
            value={value.carrier}
            onChange={(e) =>
              onChange({
                carrier: e.target.value,
                bostaCityId: "",
                bostaDistrictId: "",
                bostaCityName: null,
              })
            }
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{DASH}</option>
            {availableCarriers.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>

        {value.carrier === "bosta" ? (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="shipping-bosta-city">{t("customers.address.field.bostaCity")}</Label>
              <select
                id="shipping-bosta-city"
                aria-label={t("customers.address.field.bostaCity")}
                value={value.bostaCityId}
                onChange={(e) =>
                  onChange({
                    ...value,
                    bostaCityId: e.target.value,
                    bostaDistrictId: "",
                    bostaCityName: cities.find((c) => c.id === e.target.value)?.name ?? null,
                  })
                }
                className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{DASH}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="shipping-bosta-district">
                {t("customers.address.field.bostaDistrict")}
              </Label>
              <select
                id="shipping-bosta-district"
                aria-label={t("customers.address.field.bostaDistrict")}
                value={value.bostaDistrictId}
                onChange={(e) =>
                  onChange({
                    ...value,
                    bostaDistrictId: e.target.value,
                    bostaCityName: selectedCity?.name ?? null,
                  })
                }
                disabled={value.bostaCityId.length === 0}
                className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{DASH}</option>
                {districts.map((d) => (
                  <option key={d.districtId} value={d.districtId}>
                    {d.districtName}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
