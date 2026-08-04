import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAddress, createCustomer, listCustomers } from "@/features/customers/customers-api";
import { listWarehouses, type Warehouse } from "@/features/inventory/inventory-api";
import { listItems as listMasterDataItems } from "@/features/master-data/master-data-api";
import {
  parseOrder,
  type CreateOrderInput,
  type OrderItemInput,
  type ParsedDraft,
  type PaymentStatus,
} from "@/features/orders/orders-api";
import { getProduct, listProducts, type ProductVariant } from "@/features/products/products-api";
import { CarrierShippingFields } from "@/features/shipping/carrier-shipping-fields";
import { useI18n } from "@/i18n/i18n-provider";

const DASH = "—";

/** A minimal customer option for the create form. */
interface CustomerOption {
  readonly id: string;
  readonly name: string;
}

/** A flat variant option (product + variant label) for the line builder. */
interface VariantOption {
  readonly id: string;
  readonly label: string;
}

/** A master-data reference row reduced to id + display name. */
interface RefOption {
  readonly id: string;
  readonly name: string;
}

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toMinor(value: string): number {
  return Math.max(0, Math.round(Number(value) * 100));
}

function computeTotal(
  lines: readonly OrderItemInput[],
  shippingMinor: number,
  discountMinor: number,
): { subtotal: number; total: number } {
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const total = Math.max(0, subtotal + shippingMinor - discountMinor);
  return { subtotal, total };
}

/** Create-order form: warehouse, customer, lines, payment, notes — one card per section. */
export function OrderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: CreateOrderInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t, locale } = useI18n();

  // Section 1 — warehouse.
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  // Section 2 — customer.
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [governorates, setGovernorates] = useState<RefOption[]>([]);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newSecondaryPhone, setNewSecondaryPhone] = useState("");
  const [newGovernorateId, setNewGovernorateId] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newStreet, setNewStreet] = useState("");
  const [newCarrier, setNewCarrier] = useState("");
  const [newBostaCityId, setNewBostaCityId] = useState("");
  const [newBostaDistrictId, setNewBostaDistrictId] = useState("");
  const [newBostaCityName, setNewBostaCityName] = useState<string | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Section 3 — products.
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [lines, setLines] = useState<OrderItemInput[]>([]);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("0");

  // Section 4 — payment.
  const [shipping, setShipping] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [paidAmount, setPaidAmount] = useState("0");

  // Section 5 — notes.
  const [notes, setNotes] = useState("");

  // Smart paste (unchanged behavior — detect only, no autofill).
  const [paste, setPaste] = useState("");
  const [draft, setDraft] = useState<ParsedDraft | null>(null);

  useEffect(() => {
    void listWarehouses({ active: true })
      .then((page) => setWarehouses(page.data))
      .catch(() => setWarehouses([]));
  }, []);

  // Default to the company's default warehouse, if one exists.
  useEffect(() => {
    if (warehouseId !== "" || warehouses.length === 0) return;
    const preferred = warehouses.find((w) => w.isDefault);
    if (preferred !== undefined) setWarehouseId(preferred.id);
  }, [warehouses, warehouseId]);

  useEffect(() => {
    void listCustomers({ active: true })
      .then((page) => setCustomers(page.data.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    void listMasterDataItems("governorates", { active: true })
      .then((page) =>
        setGovernorates(page.data.map((row) => ({ id: row.id, name: String(row["name"] ?? "") }))),
      )
      .catch(() => setGovernorates([]));
  }, []);

  // Build a flat variant list from the active products (product — variant).
  useEffect(() => {
    void listProducts({ active: true })
      .then(async (page) => {
        const details = await Promise.all(page.data.slice(0, 20).map((p) => getProduct(p.id)));
        const flat: VariantOption[] = [];
        for (const p of details) {
          for (const v of p.variants as ProductVariant[]) {
            flat.push({ id: v.id, label: `${p.name} — ${v.name}` });
          }
        }
        setVariants(flat);
      })
      .catch(() => setVariants([]));
  }, []);

  const shippingMinor = toMinor(shipping);
  const discountMinor = toMinor(discount);
  const paidAmountMinor = paymentStatus === "unpaid" ? 0 : toMinor(paidAmount);
  const { subtotal, total } = useMemo(
    () => computeTotal(lines, shippingMinor, discountMinor),
    [lines, shippingMinor, discountMinor],
  );
  const remainingAmount = total - paidAmountMinor;

  const paymentValid = useMemo(() => {
    if (paymentStatus === "unpaid") return true;
    if (paymentStatus === "paid") return paidAmountMinor === total;
    return paidAmountMinor > 0 && paidAmountMinor < total;
  }, [paymentStatus, paidAmountMinor, total]);

  const addLine = (): void => {
    const qty = Math.max(1, Math.round(Number(quantity)));
    const unit = toMinor(price);
    if (variantId === "" || !Number.isFinite(qty)) return;
    setLines((ls) => [...ls, { variantId, quantity: qty, price: unit }]);
    setVariantId("");
    setQuantity("1");
    setPrice("0");
  };

  const newCustomerInvalid = newName.trim() === "" || newPhone.trim() === "";

  const saveNewCustomer = async (): Promise<void> => {
    if (newCustomerInvalid) return;
    setSavingCustomer(true);
    try {
      const customerNotes =
        newSecondaryPhone.trim().length > 0
          ? `${t("orders.form.customerSecondaryPhone")}: ${newSecondaryPhone.trim()}`
          : undefined;
      const created = await createCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        ...(customerNotes !== undefined ? { notes: customerNotes } : {}),
      });
      if (
        newGovernorateId !== "" ||
        newCity.trim() !== "" ||
        newStreet.trim() !== "" ||
        newCarrier === "bosta"
      ) {
        const line = [newCity.trim(), newStreet.trim()].filter((s) => s.length > 0).join(", ");
        await createAddress(created.id, {
          line,
          governorateId: newGovernorateId !== "" ? newGovernorateId : null,
          isDefault: true,
          ...(newCarrier === "bosta"
            ? {
                bostaCityId: newBostaCityId.length > 0 ? newBostaCityId : null,
                bostaDistrictId: newBostaDistrictId.length > 0 ? newBostaDistrictId : null,
                bostaCityName: newBostaCityName,
              }
            : {}),
        });
      }
      setCustomers((cs) => [...cs, { id: created.id, name: created.name }]);
      setCustomerId(created.id);
      setCreatingCustomer(false);
      setNewName("");
      setNewPhone("");
      setNewSecondaryPhone("");
      setNewGovernorateId("");
      setNewCity("");
      setNewStreet("");
      setNewCarrier("");
      setNewBostaCityId("");
      setNewBostaDistrictId("");
      setNewBostaCityName(null);
    } finally {
      setSavingCustomer(false);
    }
  };

  const submit = (): void => {
    if (customerId === "" || lines.length === 0 || warehouseId === "" || !paymentValid) return;
    void onSubmit({
      customerId,
      warehouseId,
      items: lines,
      shippingFee: shippingMinor,
      discount: discountMinor,
      paymentStatus,
      collectedAmount: paidAmountMinor,
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
    });
  };

  const disabled = customerId === "" || lines.length === 0 || warehouseId === "" || !paymentValid;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Deterministic smart-paste (no AI): paste a chat, get detected fields. */}
        <div className="flex flex-col gap-1 rounded border border-dashed border-input p-3">
          <Label htmlFor="order-paste">{t("orders.paste.label")}</Label>
          <textarea
            id="order-paste"
            className="min-h-16 rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                void parseOrder(paste)
                  .then(setDraft)
                  .catch(() => setDraft(null));
              }}
            >
              {t("orders.paste.button")}
            </Button>
            {draft !== null ? (
              <p className="text-xs text-muted-foreground" data-testid="paste-detected">
                {t("orders.paste.detected")}: {draft.phone ?? DASH}
                {draft.items.length > 0
                  ? ` · ${draft.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>

        {/* Card 1 — Warehouse. */}
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4">
            <Label htmlFor="order-warehouse">{t("orders.form.warehouse")}</Label>
            <select
              id="order-warehouse"
              className="rounded border border-input bg-background px-2 py-1.5 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">{DASH}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        {/* Card 2 — Customer information. */}
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="order-customer">{t("orders.form.customer")}</Label>
              <select
                id="order-customer"
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">{DASH}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setCreatingCustomer((v) => !v)}
            >
              {t("orders.form.newCustomer")}
            </Button>

            {creatingCustomer ? (
              <fieldset className="flex flex-col gap-2 rounded border border-input p-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new-customer-name">{t("orders.form.customerName")}</Label>
                  <Input
                    id="new-customer-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new-customer-phone">{t("orders.form.customerPhone")}</Label>
                  <Input
                    id="new-customer-phone"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new-customer-secondary-phone">
                    {t("orders.form.customerSecondaryPhone")}
                  </Label>
                  <Input
                    id="new-customer-secondary-phone"
                    value={newSecondaryPhone}
                    onChange={(e) => setNewSecondaryPhone(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new-customer-governorate">
                    {t("orders.form.customerGovernorate")}
                  </Label>
                  <select
                    id="new-customer-governorate"
                    className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                    value={newGovernorateId}
                    onChange={(e) => setNewGovernorateId(e.target.value)}
                  >
                    <option value="">{DASH}</option>
                    {governorates.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new-customer-city">{t("orders.form.customerCity")}</Label>
                  <Input
                    id="new-customer-city"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="new-customer-street">{t("orders.form.customerStreet")}</Label>
                  <Input
                    id="new-customer-street"
                    value={newStreet}
                    onChange={(e) => setNewStreet(e.target.value)}
                  />
                </div>
                <CarrierShippingFields
                  value={{
                    carrier: newCarrier,
                    bostaCityId: newBostaCityId,
                    bostaDistrictId: newBostaDistrictId,
                  }}
                  onChange={(next) => {
                    setNewCarrier(next.carrier);
                    setNewBostaCityId(next.bostaCityId);
                    setNewBostaDistrictId(next.bostaDistrictId);
                    setNewBostaCityName(next.bostaCityName);
                  }}
                />
                <Button
                  size="sm"
                  type="button"
                  disabled={newCustomerInvalid || savingCustomer}
                  onClick={() => void saveNewCustomer()}
                >
                  {t("orders.form.saveCustomer")}
                </Button>
              </fieldset>
            ) : null}
          </CardContent>
        </Card>

        {/* Card 3 — Products. */}
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <fieldset className="flex flex-wrap items-end gap-2 rounded border border-input p-3">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="order-variant">{t("orders.form.variant")}</Label>
                <select
                  id="order-variant"
                  className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                  value={variantId}
                  onChange={(e) => setVariantId(e.target.value)}
                >
                  <option value="">{DASH}</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex w-20 flex-col gap-1">
                <Label htmlFor="order-qty">{t("orders.form.quantity")}</Label>
                <Input
                  id="order-qty"
                  value={quantity}
                  inputMode="numeric"
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="flex w-24 flex-col gap-1">
                <Label htmlFor="order-price">{t("orders.form.price")}</Label>
                <Input
                  id="order-price"
                  value={price}
                  inputMode="decimal"
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={addLine} type="button">
                {t("orders.form.addLine")}
              </Button>
            </fieldset>

            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("orders.form.noLines")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {lines.map((l, i) => {
                  const v = variants.find((x) => x.id === l.variantId);
                  return (
                    <li key={`${l.variantId}-${i}`} className="flex justify-between gap-2">
                      <span>
                        {v?.label ?? l.variantId} × {l.quantity}
                      </span>
                      <button
                        type="button"
                        className="text-muted-foreground underline"
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Card 4 — Payment. */}
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap gap-3">
              <div className="flex w-28 flex-col gap-1">
                <Label htmlFor="order-shipping">{t("orders.form.shipping")}</Label>
                <Input
                  id="order-shipping"
                  value={shipping}
                  inputMode="decimal"
                  onChange={(e) => setShipping(e.target.value)}
                />
              </div>
              <div className="flex w-28 flex-col gap-1">
                <Label htmlFor="order-discount">{t("orders.form.discount")}</Label>
                <Input
                  id="order-discount"
                  value={discount}
                  inputMode="decimal"
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="order-payment-status">{t("orders.form.paymentStatus")}</Label>
              <select
                id="order-payment-status"
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
              >
                <option value="unpaid">{t("orders.form.paymentStatus.unpaid")}</option>
                <option value="paid">{t("orders.form.paymentStatus.paid")}</option>
                <option value="partial">{t("orders.form.paymentStatus.partial")}</option>
              </select>
            </div>

            {paymentStatus !== "unpaid" ? (
              <div className="flex flex-wrap gap-3">
                <div className="flex w-32 flex-col gap-1">
                  <Label htmlFor="order-paid-amount">{t("orders.form.paidAmount")}</Label>
                  <Input
                    id="order-paid-amount"
                    value={paidAmount}
                    inputMode="decimal"
                    onChange={(e) => setPaidAmount(e.target.value)}
                  />
                </div>
                <div className="flex w-32 flex-col gap-1">
                  <Label htmlFor="order-remaining-amount">{t("orders.form.remainingAmount")}</Label>
                  <Input
                    id="order-remaining-amount"
                    value={formatMoney(remainingAmount, locale)}
                    readOnly
                    dir="ltr"
                  />
                </div>
                {!paymentValid ? (
                  <p className="w-full text-sm text-destructive">
                    {t("orders.form.paymentStatus.error")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Card 5 — Notes. */}
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4">
            <Label htmlFor="order-notes">{t("orders.form.notes")}</Label>
            <textarea
              id="order-notes"
              className="min-h-16 rounded border border-input bg-background px-2 py-1.5 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Card 6 — Order summary. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("orders.form.summary.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-0 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("orders.form.summary.subtotal")}</span>
              <span dir="ltr">{formatMoney(subtotal, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("orders.form.summary.discount")}</span>
              <span dir="ltr">{formatMoney(discountMinor, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("orders.form.summary.shipping")}</span>
              <span dir="ltr">{formatMoney(shippingMinor, locale)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>{t("orders.form.summary.total")}</span>
              <span dir="ltr">{formatMoney(total, locale)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex h-[76px] shrink-0 items-center gap-2 border-t border-border bg-card px-4">
        <Button onClick={submit} disabled={disabled}>
          {t("orders.actions.save")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("orders.actions.cancel")}
        </Button>
      </div>
    </>
  );
}
