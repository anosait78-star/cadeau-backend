import {
  BarChart3,
  Calculator,
  Check,
  Coins,
  CreditCard,
  Layers,
  NotebookPen,
  NotebookText,
  Package,
  PackageOpen,
  Percent,
  Plus,
  ShoppingCart,
  Tag,
  Trash2,
  Truck,
  UserRound,
  Warehouse as WarehouseIcon,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
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
import {
  listBostaCities,
  listBostaDistricts,
  type BostaCity,
  type BostaDistrict,
} from "@/features/shipping/shipping-api";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { canonicalizeArabicName } from "@/lib/arabic-name";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";

const DASH = "—";

/** The API's limit on an order's notes (`@MaxLength(2000)`); the paste box shares it. */
const TEXT_LIMIT = 2000;

/** A minimal customer option for the create form. */
interface CustomerOption {
  readonly id: string;
  readonly name: string;
}

/** A flat variant option (product + variant label) for the line builder. */
interface VariantOption {
  readonly id: string;
  /** `product — variant`, for the added-lines list. */
  readonly label: string;
  readonly productName: string;
  readonly variantName: string;
  /** The parent product's picture, when it has one. */
  readonly imageUrl: string | null;
}

/** A master-data reference row reduced to id + display name. */
interface RefOption {
  readonly id: string;
  readonly name: string;
}

/** The API's own ceiling, so the catalogue is walked in as few pages as it allows. */
const PRODUCT_PAGE_SIZE = 100;

/** A stop on the paging loop, so a runaway cursor can never spin forever. */
const MAX_PRODUCTS = 2000;

/** How many products' variants are fetched at once. */
const VARIANT_FETCH_BATCH = 8;

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

type Tone = "info" | "primary" | "violet" | "success" | "warning";

/** Each section's icon wash — one hue per kind of information, as in the design. */
const TONES: Readonly<Record<Tone, string>> = {
  info: "bg-info/10 text-info",
  primary: "bg-primary/10 text-primary",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
};

const INPUT_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Create-order form: smart paste, warehouse, customer, products, discount &
 * shipping, notes and a live summary — one card per section, each with its own
 * icon, title and one-line hint, over a quiet grey ground so the cards read
 * as separate steps.
 *
 * One column at every width: the dialog keeps its size on desktop and goes
 * full screen on a phone, and the same cards stack in both. What changes with
 * width is only inside the products card — a table with room for columns on
 * desktop, a card per line on a phone. Save and Cancel stay pinned below the
 * scroll, so the total never has to be scrolled back to.
 */
export function OrderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: CreateOrderInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const currency = t("orders.form.currency");

  // Section — warehouse.
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  // Section — customer.
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
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  // Bosta's own catalog: its "city" is a governorate, its district is the city.
  // Empty when Bosta can't be reached — the form then falls back to the
  // company's governorates and a typed city.
  const [bostaCities, setBostaCities] = useState<BostaCity[]>([]);
  const [bostaDistricts, setBostaDistricts] = useState<BostaDistrict[]>([]);
  const [newBostaCityId, setNewBostaCityId] = useState("");
  const [newBostaDistrictId, setNewBostaDistrictId] = useState("");
  const useBosta = bostaCities.length > 0;

  // Section — products.
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [lines, setLines] = useState<OrderItemInput[]>([]);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("0");

  // Section — discount, shipping & payment.
  const [shipping, setShipping] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [paidAmount, setPaidAmount] = useState("0");

  // Section — notes.
  const [notes, setNotes] = useState("");

  // Smart paste (unchanged behavior — detect only, no autofill).
  const [paste, setPaste] = useState("");
  const [draft, setDraft] = useState<ParsedDraft | null>(null);

  useEffect(() => {
    void listWarehouses({ active: true })
      .then((warehouses) => setWarehouses(warehouses))
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

  useEffect(() => {
    void listBostaCities()
      .then(({ data }) => setBostaCities(data))
      .catch(() => setBostaCities([]));
  }, []);

  useEffect(() => {
    if (newBostaCityId === "") {
      setBostaDistricts([]);
      return;
    }
    void listBostaDistricts(newBostaCityId)
      .then(({ data }) => setBostaDistricts(data))
      .catch(() => setBostaDistricts([]));
  }, [newBostaCityId]);

  /*
   * Every active product's variants, flattened into one pickable list.
   *
   * This used to read one page of products and keep the first twenty of it, so
   * a catalogue of any size showed the same twenty and the rest simply could
   * not be ordered. It now walks every page.
   *
   * Variants still cost a request per product — there is no endpoint that
   * returns them across the catalogue — so the requests run a few at a time
   * and each batch is published as it lands. The list fills in rather than
   * waiting on the whole catalogue, and a long catalogue never opens hundreds
   * of sockets at once.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const products: { id: string; name: string; imageUrl: string | null }[] = [];
        let cursor: string | undefined;
        do {
          const page = await listProducts({
            active: true,
            limit: PRODUCT_PAGE_SIZE,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          if (cancelled) return;
          products.push(
            ...page.data.map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl })),
          );
          cursor = page.page.nextCursor ?? undefined;
        } while (cursor !== undefined && products.length < MAX_PRODUCTS);

        const flat: VariantOption[] = [];
        for (let i = 0; i < products.length; i += VARIANT_FETCH_BATCH) {
          const batch = products.slice(i, i + VARIANT_FETCH_BATCH);
          const details = await Promise.all(batch.map((p) => getProduct(p.id).catch(() => null)));
          if (cancelled) return;
          details.forEach((detail, index) => {
            if (detail === null) return;
            const parent = batch[index]!;
            for (const v of detail.variants as ProductVariant[]) {
              flat.push({
                id: v.id,
                label: `${parent.name} — ${v.name}`,
                productName: parent.name,
                variantName: v.name,
                imageUrl: parent.imageUrl,
              });
            }
          });
          setVariants([...flat]);
        }
      } catch {
        if (!cancelled) setVariants([]);
      }
    })();

    return () => {
      cancelled = true;
    };
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

  const removeLine = (index: number): void => {
    setLines((ls) => ls.filter((_, j) => j !== index));
  };

  const newCustomerInvalid = newName.trim() === "" || newPhone.trim() === "";

  const saveNewCustomer = async (): Promise<void> => {
    if (newCustomerInvalid) return;
    setSavingCustomer(true);
    setCustomerError(null);
    let created: { id: string; name: string };
    try {
      const customerNotes =
        newSecondaryPhone.trim().length > 0
          ? `${t("orders.form.customerSecondaryPhone")}: ${newSecondaryPhone.trim()}`
          : undefined;
      created = await createCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        ...(customerNotes !== undefined ? { notes: customerNotes } : {}),
      });
    } catch (error) {
      setCustomerError(customerSaveErrorText(error, t));
      setSavingCustomer(false);
      return;
    }
    // The customer exists from here on: pick it even if the address fails,
    // so a second click can't create a duplicate.
    setCustomers((cs) => [...cs, { id: created.id, name: created.name }]);
    setCustomerId(created.id);
    try {
      const city = bostaCities.find((c) => c.id === newBostaCityId);
      const district = bostaDistricts.find((d) => d.districtId === newBostaDistrictId);
      const cityName = useBosta ? (city?.nameAr ?? city?.name ?? "") : "";
      const districtName = district?.districtNameAr ?? district?.districtName ?? "";
      const typedCity = useBosta ? districtName : newCity.trim();
      // Bosta's governorate mapped onto the company's own list by name, so
      // governorate reports keep counting these customers.
      const governorateId = useBosta
        ? (governorates.find(
            (g) =>
              city !== undefined &&
              [city.nameAr, city.name].some(
                (n) => n !== null && canonicalizeArabicName(n) === canonicalizeArabicName(g.name),
              ),
          )?.id ?? null)
        : newGovernorateId !== ""
          ? newGovernorateId
          : null;
      if (
        city !== undefined ||
        governorateId !== null ||
        typedCity !== "" ||
        newStreet.trim() !== ""
      ) {
        const line =
          [typedCity, newStreet.trim()].filter((s) => s.length > 0).join(", ") || cityName;
        await createAddress(created.id, {
          // The API needs a non-empty line; a governorate alone still names a place.
          line:
            line !== "" ? line : (governorates.find((g) => g.id === governorateId)?.name ?? DASH),
          governorateId,
          ...(city !== undefined ? { bostaCityId: city.id, bostaCityName: city.name } : {}),
          ...(district !== undefined ? { bostaDistrictId: district.districtId } : {}),
          isDefault: true,
        });
      }
    } catch {
      setCustomerError(t("orders.form.addressSaveFailed"));
      setSavingCustomer(false);
      return;
    }
    setCreatingCustomer(false);
    setNewName("");
    setNewPhone("");
    setNewSecondaryPhone("");
    setNewGovernorateId("");
    setNewCity("");
    setNewStreet("");
    setNewBostaCityId("");
    setNewBostaDistrictId("");
    setSavingCustomer(false);
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

  const money = (minor: number): string => `${formatMoney(minor, locale)} ${currency}`;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/40 p-3 sm:gap-4 sm:p-4">
        {/* Smart paste — deterministic (no AI): paste a chat, get detected fields. */}
        <SectionCard
          tone="info"
          icon={NotebookPen}
          title={t("orders.paste.label")}
          optional
          hint={t("orders.form.pasteHint")}
        >
          <textarea
            id="order-paste"
            className={cn(INPUT_CLASS, "min-h-20 resize-y")}
            value={paste}
            maxLength={TEXT_LIMIT}
            placeholder={t("orders.form.pastePlaceholder")}
            aria-label={t("orders.paste.label")}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <Button
              size="sm"
              variant="outline"
              type="button"
              disabled={paste.trim().length === 0}
              onClick={() => {
                void parseOrder(paste)
                  .then(setDraft)
                  .catch(() => setDraft(null));
              }}
            >
              {t("orders.paste.button")}
            </Button>
            <CharCount length={paste.length} />
          </div>
          {draft !== null ? (
            <p
              className="mt-2 rounded-lg bg-info/10 px-3 py-2 text-xs text-foreground"
              data-testid="paste-detected"
            >
              {t("orders.paste.detected")}: {draft.phone ?? DASH}
              {draft.items.length > 0
                ? ` · ${draft.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}`
                : ""}
            </p>
          ) : null}
        </SectionCard>

        {/* Warehouse. */}
        <SectionCard
          tone="primary"
          icon={WarehouseIcon}
          title={t("orders.form.warehouse")}
          required
          hint={t("orders.form.warehouseHint")}
        >
          <Combobox
            id="order-warehouse"
            ariaLabel={t("orders.form.warehouse")}
            value={warehouseId}
            onChange={setWarehouseId}
            placeholder={DASH}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </SectionCard>

        {/* Customer. */}
        <SectionCard
          tone="violet"
          icon={UserRound}
          title={t("orders.form.customer")}
          required
          hint={t("orders.form.customerHint")}
        >
          <div className="flex flex-col gap-3">
            <Combobox
              id="order-customer"
              ariaLabel={t("orders.form.customer")}
              value={customerId}
              onChange={setCustomerId}
              placeholder={DASH}
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
            />

            <Button
              variant="outline"
              type="button"
              className="h-11 w-full border-dashed bg-muted/40"
              aria-expanded={creatingCustomer}
              onClick={() => setCreatingCustomer((v) => !v)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("orders.form.newCustomer")}
            </Button>

            {creatingCustomer ? (
              <fieldset className="grid grid-cols-1 gap-x-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2">
                <FormField
                  label={t("orders.form.customerName")}
                  htmlFor="new-customer-name"
                  required
                >
                  <Input
                    id="new-customer-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    aria-label={t("orders.form.customerName")}
                  />
                </FormField>
                <FormField
                  label={t("orders.form.customerPhone")}
                  htmlFor="new-customer-phone"
                  required
                >
                  <Input
                    id="new-customer-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="next"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    aria-label={t("orders.form.customerPhone")}
                  />
                </FormField>
                <FormField
                  label={t("orders.form.customerSecondaryPhone")}
                  htmlFor="new-customer-secondary-phone"
                  optional
                >
                  <Input
                    id="new-customer-secondary-phone"
                    type="tel"
                    inputMode="tel"
                    enterKeyHint="next"
                    value={newSecondaryPhone}
                    onChange={(e) => setNewSecondaryPhone(e.target.value)}
                    aria-label={t("orders.form.customerSecondaryPhone")}
                  />
                </FormField>
                <FormField
                  label={t("orders.form.customerGovernorate")}
                  htmlFor="new-customer-governorate"
                  optional
                >
                  {useBosta ? (
                    <Combobox
                      id="new-customer-governorate"
                      ariaLabel={t("orders.form.customerGovernorate")}
                      value={newBostaCityId}
                      onChange={(value) => {
                        setNewBostaCityId(value);
                        setNewBostaDistrictId("");
                      }}
                      placeholder={DASH}
                      options={bostaCities.map((c) => ({ value: c.id, label: c.nameAr ?? c.name }))}
                    />
                  ) : (
                    <Combobox
                      id="new-customer-governorate"
                      ariaLabel={t("orders.form.customerGovernorate")}
                      value={newGovernorateId}
                      onChange={setNewGovernorateId}
                      placeholder={DASH}
                      options={governorates.map((g) => ({ value: g.id, label: g.name }))}
                    />
                  )}
                </FormField>
                <FormField
                  label={t("orders.form.customerCity")}
                  htmlFor="new-customer-city"
                  optional
                >
                  {useBosta ? (
                    <Combobox
                      id="new-customer-city"
                      ariaLabel={t("orders.form.customerCity")}
                      value={newBostaDistrictId}
                      onChange={setNewBostaDistrictId}
                      placeholder={DASH}
                      disabled={newBostaCityId === ""}
                      options={bostaDistricts.map((d) => ({
                        value: d.districtId,
                        label: d.districtNameAr ?? d.districtName,
                      }))}
                    />
                  ) : (
                    <Input
                      id="new-customer-city"
                      value={newCity}
                      onChange={(e) => setNewCity(e.target.value)}
                      aria-label={t("orders.form.customerCity")}
                    />
                  )}
                </FormField>
                <FormField
                  label={t("orders.form.customerStreet")}
                  htmlFor="new-customer-street"
                  optional
                >
                  <Input
                    id="new-customer-street"
                    value={newStreet}
                    onChange={(e) => setNewStreet(e.target.value)}
                    aria-label={t("orders.form.customerStreet")}
                  />
                </FormField>
                <Button
                  type="button"
                  className="h-10 sm:col-span-2"
                  disabled={newCustomerInvalid || savingCustomer}
                  onClick={() => void saveNewCustomer()}
                >
                  {t("orders.form.saveCustomer")}
                </Button>
                {customerError !== null ? (
                  <p role="alert" className="mt-2 text-sm text-destructive sm:col-span-2">
                    {customerError}
                  </p>
                ) : null}
              </fieldset>
            ) : null}
          </div>
        </SectionCard>

        {/* Products. */}
        <SectionCard
          tone="success"
          icon={Package}
          title={t("orders.form.variant")}
          hint={t("orders.form.variantHint")}
        >
          <div className="flex flex-col gap-3">
            <Combobox
              id="order-variant"
              ariaLabel={t("orders.form.variant")}
              value={variantId}
              onChange={setVariantId}
              placeholder={DASH}
              /* The product names the row; the variant is the quieter second line. */
              options={variants.map((v) => ({
                value: v.id,
                label: v.productName,
                hint: v.variantName,
                imageUrl: v.imageUrl,
              }))}
            />

            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="order-qty" className="flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t("orders.form.quantity")}
                </Label>
                <Input
                  id="order-qty"
                  value={quantity}
                  inputMode="numeric"
                  onChange={(e) => setQuantity(e.target.value)}
                  aria-label={t("orders.form.quantity")}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="order-price" className="flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t("orders.form.price")} ({currency})
                </Label>
                <Input
                  id="order-price"
                  value={price}
                  inputMode="decimal"
                  onChange={(e) => setPrice(e.target.value)}
                  aria-label={t("orders.form.price")}
                />
              </div>
              {/*
                A quantity and a price on their own are not a line — until a
                product is picked, nothing can be added. The button says so by
                going inert, rather than swallowing the click and leaving the
                figures looking like they failed to reach the total.
              */}
              <Button
                variant="outline"
                type="button"
                className="col-span-2 h-10 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 sm:col-span-1"
                onClick={addLine}
                disabled={variantId === ""}
                title={variantId === "" ? t("orders.form.addLineHint") : undefined}
              >
                <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                {t("orders.form.addToCart")}
              </Button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-sm font-semibold text-foreground">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t("orders.form.linesTitle")}
                {lines.length > 0 ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {lines.length}
                  </span>
                ) : null}
              </div>

              {lines.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                  <PackageOpen className="h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("orders.form.emptyCartTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("orders.form.emptyCartHint")}</p>
                </div>
              ) : (
                <>
                  {/* Desktop: room for columns. */}
                  <table className="hidden w-full text-sm sm:table">
                    <thead className="bg-muted/20 text-xs text-muted-foreground">
                      <tr>
                        <th className="w-10 px-3 py-2 text-start font-medium">#</th>
                        <th className="px-3 py-2 text-start font-medium">
                          {t("orders.form.lineProduct")}
                        </th>
                        <th className="px-3 py-2 text-center font-medium">
                          {t("orders.form.quantity")}
                        </th>
                        <th className="px-3 py-2 text-end font-medium">
                          {t("orders.form.price")} ({currency})
                        </th>
                        <th className="px-3 py-2 text-end font-medium">
                          {t("orders.form.lineTotal")} ({currency})
                        </th>
                        <th className="w-16 px-3 py-2 text-center font-medium">
                          {t("orders.form.lineActions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => {
                        const v = variants.find((x) => x.id === line.variantId);
                        return (
                          <tr key={`${line.variantId}-${index}`} className="border-t border-border">
                            <td className="px-3 py-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                                {index + 1}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <ProductThumb imageUrl={v?.imageUrl ?? null} size="sm" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">
                                    {v?.productName ?? line.variantId}
                                  </p>
                                  {v !== undefined ? (
                                    <p className="truncate text-xs text-muted-foreground">
                                      {v.variantName}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">{line.quantity}</td>
                            <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                              {formatMoney(line.price, locale)}
                            </td>
                            <td className="px-3 py-2 text-end font-semibold tabular-nums" dir="ltr">
                              {formatMoney(line.price * line.quantity, locale)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <RemoveLineButton
                                label={t("orders.form.removeLine", { name: v?.label ?? "" })}
                                onClick={() => removeLine(index)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Phone: a card per line. */}
                  <ul className="flex flex-col sm:hidden">
                    {lines.map((line, index) => {
                      const v = variants.find((x) => x.id === line.variantId);
                      return (
                        <li
                          key={`${line.variantId}-${index}`}
                          className="flex items-center gap-3 border-t border-border px-3 py-3 first:border-t-0"
                        >
                          <ProductThumb imageUrl={v?.imageUrl ?? null} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {v?.productName ?? line.variantId}
                            </p>
                            {v !== undefined ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {v.variantName}
                              </p>
                            ) : null}
                            <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                              {line.quantity} × {formatMoney(line.price, locale)}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-bold tabular-nums" dir="ltr">
                            {money(line.price * line.quantity)}
                          </span>
                          <RemoveLineButton
                            label={t("orders.form.removeLine", { name: v?.label ?? "" })}
                            onClick={() => removeLine(index)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Discount, shipping & payment. */}
        <SectionCard
          tone="warning"
          icon={Percent}
          title={t("orders.form.pricingTitle")}
          optional
          hint={t("orders.form.pricingHint")}
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="order-discount" className="flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t("orders.form.discount")} ({currency})
                </Label>
                <Input
                  id="order-discount"
                  value={discount}
                  inputMode="decimal"
                  onChange={(e) => setDiscount(e.target.value)}
                  aria-label={t("orders.form.discount")}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="order-shipping" className="flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t("orders.form.shipping")} ({currency})
                </Label>
                <Input
                  id="order-shipping"
                  value={shipping}
                  inputMode="decimal"
                  onChange={(e) => setShipping(e.target.value)}
                  aria-label={t("orders.form.shipping")}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="order-payment-status" className="flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-success" aria-hidden="true" />
                {t("orders.form.paymentStatus")}
              </Label>
              <select
                id="order-payment-status"
                className={cn(INPUT_CLASS, "h-10")}
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
              >
                <option value="unpaid">{t("orders.form.paymentStatus.unpaid")}</option>
                <option value="paid">{t("orders.form.paymentStatus.paid")}</option>
                <option value="partial">{t("orders.form.paymentStatus.partial")}</option>
              </select>
            </div>

            {paymentStatus !== "unpaid" ? (
              <div className="grid grid-cols-2 gap-3">
                <FormField label={t("orders.form.paidAmount")} htmlFor="order-paid-amount" required>
                  <Input
                    id="order-paid-amount"
                    value={paidAmount}
                    inputMode="decimal"
                    onChange={(e) => setPaidAmount(e.target.value)}
                    aria-label={t("orders.form.paidAmount")}
                  />
                </FormField>
                <FormField
                  label={t("orders.form.remainingAmount")}
                  htmlFor="order-remaining-amount"
                >
                  <Input
                    id="order-remaining-amount"
                    value={formatMoney(remainingAmount, locale)}
                    readOnly
                    dir="ltr"
                    aria-label={t("orders.form.remainingAmount")}
                  />
                </FormField>
                {!paymentValid ? (
                  <p className="col-span-2 text-sm text-destructive">
                    {t("orders.form.paymentStatus.error")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </SectionCard>

        {/* Notes. */}
        <SectionCard tone="info" icon={NotebookText} title={t("orders.form.notes")} optional>
          <textarea
            id="order-notes"
            className={cn(INPUT_CLASS, "min-h-20 resize-y")}
            value={notes}
            maxLength={TEXT_LIMIT}
            placeholder={t("orders.form.notesPlaceholder")}
            onChange={(e) => setNotes(e.target.value)}
            aria-label={t("orders.form.notes")}
          />
          <div className="mt-2 flex justify-end">
            <CharCount length={notes.length} />
          </div>
        </SectionCard>

        {/* Order summary. */}
        <section className="rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:p-5">
          <header className="mb-3 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <BarChart3 className="h-5 w-5" />
            </span>
            <h3 className="text-base font-semibold text-foreground">
              {t("orders.form.summary.title")}
            </h3>
          </header>
          <dl className="flex flex-col gap-2 text-sm">
            <SummaryRow
              icon={Calculator}
              label={t("orders.form.summary.subtotal")}
              value={money(subtotal)}
              strong
            />
            <SummaryRow
              icon={Tag}
              label={t("orders.form.summary.discount")}
              value={money(discountMinor)}
            />
            <SummaryRow
              icon={Truck}
              label={t("orders.form.summary.shipping")}
              value={money(shippingMinor)}
            />
          </dl>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-primary/15 pt-3">
            <span className="flex items-center gap-2 text-base font-bold text-primary">
              <Coins className="h-5 w-5" aria-hidden="true" />
              {t("orders.form.summary.total")}
            </span>
            <span className="text-xl font-bold tabular-nums text-primary" dir="ltr">
              {money(total)}
            </span>
          </div>
        </section>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-3 py-3 sm:px-4">
        <Button onClick={submit} disabled={disabled} className="h-11 flex-[2] text-base">
          <Check className="h-4 w-4" aria-hidden="true" />
          {t("orders.form.saveOrder")}
        </Button>
        <Button variant="outline" onClick={onCancel} className="h-11 flex-1">
          <X className="h-4 w-4" aria-hidden="true" />
          {t("orders.actions.cancel")}
        </Button>
      </div>
    </>
  );
}

/** A form section: tinted icon, title (with required/optional marker), a one-line hint. */
function SectionCard({
  tone,
  icon: Icon,
  title,
  hint,
  required = false,
  optional = false,
  children,
}: {
  readonly tone: Tone;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly hint?: string;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <header className="mb-3 flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            TONES[tone],
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="text-base font-semibold text-foreground">
            {title}
            {required ? (
              <span className="text-destructive" aria-hidden="true">
                {" "}
                *
              </span>
            ) : null}
            {optional ? (
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                ({t("form.optional")})
              </span>
            ) : null}
          </h3>
          {hint !== undefined ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

/** Characters used against the shared text limit. */
function CharCount({ length }: { readonly length: number }): ReactNode {
  return (
    <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
      {length}/{TEXT_LIMIT}
    </span>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
  strong = false,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn("tabular-nums", strong ? "font-semibold text-foreground" : "text-foreground")}
        dir="ltr"
      >
        {value}
      </dd>
    </div>
  );
}

function RemoveLineButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10"
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/** The inline new-customer error: a duplicate or bad phone gets its own line. */
function customerSaveErrorText(error: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  if (error instanceof ApiError && error.code === "CONFLICT") return t("customers.duplicatePhone");
  if (error instanceof ApiError && error.code === "UNPROCESSABLE_ENTITY") {
    return t("customers.invalidPhone");
  }
  return t("customers.saveFailed");
}
