import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel as SharedDetailPanel } from "@/components/detail-panel/detail-panel";
import type { Translate } from "@/components/i18n/translate-type";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { TableToolbar } from "@/components/table-toolbar/table-toolbar";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archiveCustomer,
  createAddress,
  createCustomer,
  getCustomer,
  listCustomers,
  updateAddress,
  updateCustomer,
  type AddressInput,
  type CustomerAddress,
  type CustomerDetail,
  type CustomerInput,
  type CustomerListItem,
} from "@/features/customers/customers-api";
import { listItems, type MasterDataItem } from "@/features/master-data/master-data-api";
import { CarrierShippingFields } from "@/features/shipping/carrier-shipping-fields";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { buildCustomerColumns } from "./customers-columns";

/** A governorate option for the address select. */
interface RefOption {
  readonly id: string;
  readonly name: string;
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: CustomerListItem[];
      readonly nextCursor: string | null;
    };

const DASH = "—";

/**
 * Customers — the customer base (EPIC-10). The whole screen is behind the
 * `customers` feature; create/edit/archive and address management are behind
 * `customers.manage` (the API re-checks both — ADR-003). One responsive card
 * list serves both shells (the card alternative required by ADR-002).
 *
 * The privacy split of the API is visible in the UI: **the list shows a masked
 * phone**, and the full number appears only after the user opens one customer,
 * which issues the single-customer read that decrypts it.
 */
export function CustomersPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="customers"
      fallback={
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
          <EmptyState title={t("customers.forbidden")} />
        </div>
      }
    >
      <CustomersScreen />
    </FeatureGate>
  );
}

function CustomersScreen(): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerListItem | null>(null);
  const [governorates, setGovernorates] = useState<RefOption[]>([]);
  const [searchParams] = useSearchParams();

  const flash = useCallback((text: string): void => toast.show(text), [toast]);

  // A deep link (e.g. the "Edit customer details" shortcut from the
  // create-shipment flow) opens that customer's detail panel directly.
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId === null) return;
    void getCustomer(editId)
      .then((detail) => setSelectedCustomer(toListItem(detail)))
      .catch(() => undefined);
  }, [searchParams]);

  const load = useCallback(async (q: string): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listCustomers({ active: "all", ...(q.length > 0 ? { q } : {}) });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  // Governorates are best-effort reference data: the address form still works
  // without them (the field is optional), so a failure must not break the page.
  useEffect(() => {
    void listItems("governorates", { active: true })
      .then((page) =>
        setGovernorates(
          page.data.map((row: MasterDataItem) => ({ id: row.id, name: String(row["name"] ?? "") })),
        ),
      )
      .catch(() => setGovernorates([]));
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const onSearch = (): void => {
    void load(search.trim());
  };

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const q = search.trim();
    const page = await listCustomers({
      active: "all",
      cursor: state.nextCursor,
      ...(q.length > 0 ? { q } : {}),
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  /** Fold a detail response back into the masked list row it came from. */
  const mergeDetail = (detail: CustomerDetail): void => {
    const listItem = toListItem(detail);
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            items: s.items.map((i) => (i.id === detail.id ? listItem : i)),
          }
        : s,
    );
    setSelectedCustomer((c) => (c !== null && c.id === detail.id ? listItem : c));
  };

  const onCreate = async (body: CustomerInput): Promise<void> => {
    try {
      const created = await createCustomer(body);
      setState((s) =>
        s.kind === "ready" ? { ...s, items: [toListItem(created), ...s.items] } : s,
      );
      setCreating(false);
      flash(t("customers.saved"));
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const onUpdate = async (id: string, body: CustomerInput): Promise<void> => {
    try {
      mergeDetail(await updateCustomer(id, body));
      setEditingId(null);
      flash(t("customers.saved"));
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const onArchive = async (id: string): Promise<void> => {
    try {
      await archiveCustomer(id);
      setState((s) =>
        s.kind === "ready"
          ? { ...s, items: s.items.map((i) => (i.id === id ? { ...i, active: false } : i)) }
          : s,
      );
      setSelectedCustomer((c) => (c !== null && c.id === id ? { ...c, active: false } : c));
      flash(t("customers.saved"));
    } catch (error) {
      flash(saveErrorText(error, t));
    }
  };

  const columns = useMemo(() => buildCustomerColumns({ t, locale }), [t, locale]);

  /** The card-or-edit-form for one customer — shared by the mobile list and the desktop detail panel. */
  const renderCustomerDetail = (customer: CustomerListItem): ReactNode =>
    editingId === customer.id ? (
      <CustomerForm
        customer={customer}
        onSubmit={(body) => onUpdate(customer.id, body)}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <CustomerCard
        customer={customer}
        governorates={governorates}
        onEdit={() => setEditingId(customer.id)}
        onArchive={() => void onArchive(customer.id)}
        onNotify={flash}
      />
    );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("customers.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("customers.subtitle")}</p>
      </header>

      <TableToolbar
        search={{
          value: search,
          onChange: setSearch,
          onSubmit: onSearch,
          placeholder: t("customers.search.placeholder"),
          label: t("customers.search.label"),
        }}
        secondaryActions={
          <Button variant="outline" onClick={onSearch}>
            {t("customers.search.submit")}
          </Button>
        }
        primaryActions={
          <PermissionGate permission="customers.manage">
            {creating ? null : (
              <Button onClick={() => setCreating(true)}>{t("customers.actions.create")}</Button>
            )}
          </PermissionGate>
        }
      />
      <p className="text-xs text-muted-foreground">{t("customers.search.hint")}</p>

      {creating ? (
        <PermissionGate permission="customers.manage">
          <CustomerForm onSubmit={onCreate} onCancel={() => setCreating(false)} />
        </PermissionGate>
      ) : null}

      {state.kind === "error" ? <ErrorState onRetry={() => void load(search.trim())} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<CustomerListItem>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={setSelectedCustomer}
            emptyState={<EmptyState title={t("customers.empty")} />}
          />
        ) : (
          <MobileCardList<CustomerListItem>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderCustomerDetail}
            emptyTitle={t("customers.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("customers.loadMore")}
          />
        )
      ) : null}

      <SharedDetailPanel
        open={selectedCustomer !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCustomer(null);
            setEditingId(null);
          }
        }}
        title={selectedCustomer?.name ?? ""}
        sections={
          selectedCustomer === null
            ? []
            : [
                {
                  key: "details",
                  label: t("customers.title"),
                  content: renderCustomerDetail(selectedCustomer),
                },
              ]
        }
      />
    </div>
  );
}

/** A customer row: masked phone, KPIs, actions, and an expandable detail panel. */
function CustomerCard({
  customer,
  governorates,
  onEdit,
  onArchive,
  onNotify,
}: {
  customer: CustomerListItem;
  governorates: readonly RefOption[];
  onEdit: () => void;
  onArchive: () => void;
  onNotify: (text: string) => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const [showDetail, setShowDetail] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>{customer.name}</span>
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
            data-testid="status"
          >
            {customer.active ? t("customers.status.active") : t("customers.status.inactive")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("customers.field.phone")}</dt>
            {/* Masked on the list by design — the full number needs a detail read. */}
            <dd dir="ltr">{customer.phoneMasked}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("customers.field.email")}</dt>
            <dd>{customer.email ?? DASH}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("customers.kpi.orders")}</dt>
            <dd>{customer.ordersCount}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("customers.kpi.spent")}</dt>
            <dd>{formatMoney(customer.totalSpent, locale)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("customers.kpi.lastOrder")}</dt>
            <dd>{formatDate(customer.lastOrderAt, locale)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowDetail((v) => !v)}>
            {t("customers.actions.details")}
          </Button>
          <PermissionGate permission="customers.manage">
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t("customers.actions.edit")}
            </Button>
            {customer.active ? (
              <Button size="sm" variant="ghost" onClick={onArchive}>
                {t("customers.actions.archive")}
              </Button>
            ) : null}
          </PermissionGate>
        </div>

        {showDetail ? (
          <CustomerDetailExpansion
            customerId={customer.id}
            governorates={governorates}
            onNotify={onNotify}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The expandable detail section for one customer (both the mobile card and
 * the desktop `DetailPanel` reuse it via `CustomerCard`). This is the only
 * place the full phone number is fetched or shown: opening it is a
 * deliberate act, not a side effect of browsing the list.
 */
function CustomerDetailExpansion({
  customerId,
  governorates,
  onNotify,
}: {
  customerId: string;
  governorates: readonly RefOption[];
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      setDetail(await getCustomer(customerId));
    } catch {
      setFailed(true);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceAddresses = (addresses: CustomerAddress[]): void => {
    setDetail((d) => (d === null ? d : { ...d, addresses }));
  };

  const onAdd = async (body: AddressInput): Promise<void> => {
    try {
      const created = await createAddress(customerId, body);
      // A new default demotes the incumbent server-side; mirror that locally.
      const existing = (detail?.addresses ?? []).map((a) =>
        created.isDefault ? { ...a, isDefault: false } : a,
      );
      replaceAddresses([...existing, created]);
      setAdding(false);
      onNotify(t("customers.saved"));
    } catch (error) {
      onNotify(saveErrorText(error, t));
    }
  };

  const onEditAddress = async (addressId: string, body: AddressInput): Promise<void> => {
    try {
      const updated = await updateAddress(customerId, addressId, body);
      replaceAddresses(
        (detail?.addresses ?? []).map((a) =>
          a.id === addressId ? updated : updated.isDefault ? { ...a, isDefault: false } : a,
        ),
      );
      setEditingId(null);
      onNotify(t("customers.saved"));
    } catch (error) {
      onNotify(saveErrorText(error, t));
    }
  };

  if (failed) return <ErrorState onRetry={() => void load()} />;
  if (detail === null) return <LoadingState />;

  const governorateNames = new Map(governorates.map((g) => [g.id, g.name]));

  return (
    <section
      className="mt-1 flex flex-col gap-3 border-t border-border pt-3"
      aria-label={t("customers.detail.title")}
    >
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{t("customers.field.phoneFull")}</dt>
          <dd dir="ltr">{detail.phone}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{t("customers.field.notes")}</dt>
          <dd>{detail.notes ?? DASH}</dd>
        </div>
      </dl>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("customers.addresses.title")}</h3>
        <PermissionGate permission="customers.manage">
          {adding ? null : (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              {t("customers.addresses.add")}
            </Button>
          )}
        </PermissionGate>
      </div>

      {adding ? (
        <PermissionGate permission="customers.manage">
          <AddressForm
            governorates={governorates}
            onSubmit={onAdd}
            onCancel={() => setAdding(false)}
          />
        </PermissionGate>
      ) : null}

      {detail.addresses.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{t("customers.addresses.empty")}</p>
      ) : null}

      {detail.addresses.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {detail.addresses.map((address) => (
            <li key={address.id}>
              {editingId === address.id ? (
                <AddressForm
                  address={address}
                  governorates={governorates}
                  onSubmit={(body) => onEditAddress(address.id, body)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {address.line}
                      {address.isDefault ? ` (${t("customers.addresses.default")})` : ""}
                      {address.active ? "" : ` (${t("customers.status.inactive")})`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("customers.address.field.governorate")}:{" "}
                      {(address.governorateId && governorateNames.get(address.governorateId)) ||
                        DASH}{" "}
                      · {t("customers.address.field.landmark")}: {address.landmark ?? DASH}
                    </span>
                  </div>
                  <PermissionGate permission="customers.manage">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(address.id)}>
                      {t("customers.actions.edit")}
                    </Button>
                  </PermissionGate>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Create/edit form for a customer.
 *
 * On edit it starts from the list row, which holds a **masked** phone — so the
 * phone field starts empty and only sends a value when the user types one.
 * Submitting a blank phone leaves the stored number untouched rather than
 * writing the mask back over it.
 */
function CustomerForm({
  customer,
  onSubmit,
  onCancel,
}: {
  customer?: CustomerListItem;
  onSubmit: (body: CustomerInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const editing = customer !== undefined;
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    const body: CustomerInput = {
      name: name.trim(),
      ...(phone.trim().length > 0 ? { phone: phone.trim() } : {}),
      ...(email.trim().length > 0 ? { email: email.trim() } : editing ? { email: null } : {}),
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : editing ? { notes: null } : {}),
    };
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  const invalid = name.trim().length === 0 || (!editing && phone.trim().length === 0);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="customer-name">{t("customers.field.name")} *</Label>
            <Input
              id="customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("customers.field.name")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="customer-phone">
              {t("customers.field.phone")}
              {editing ? "" : " *"}
            </Label>
            <Input
              id="customer-phone"
              dir="ltr"
              value={phone}
              placeholder="+201001234567"
              onChange={(e) => setPhone(e.target.value)}
              aria-label={t("customers.field.phone")}
            />
            <p className="text-xs text-muted-foreground">
              {editing ? t("customers.field.phoneEditHint") : t("customers.field.phoneHint")}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="customer-email">{t("customers.field.email")}</Label>
            <Input
              id="customer-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label={t("customers.field.email")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="customer-notes">{t("customers.field.notes")}</Label>
            <Input
              id="customer-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-label={t("customers.field.notes")}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={submitting || invalid} onClick={() => void submit()}>
            {t("customers.actions.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("customers.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Create/edit form for an address. */
function AddressForm({
  address,
  governorates,
  onSubmit,
  onCancel,
}: {
  address?: CustomerAddress;
  governorates: readonly RefOption[];
  onSubmit: (body: AddressInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const editing = address !== undefined;
  const [line, setLine] = useState(address?.line ?? "");
  const [landmark, setLandmark] = useState(address?.landmark ?? "");
  const [governorateId, setGovernorateId] = useState(address?.governorateId ?? "");
  const [isDefault, setIsDefault] = useState(address?.isDefault ?? false);
  const [active, setActive] = useState(address?.active ?? true);
  const [submitting, setSubmitting] = useState(false);

  // Shipping mapping (Bosta city/district today; carrier-agnostic — see
  // CarrierShippingFields). BostaCarrierAdapter refuses to ship without a
  // mapped city/district, deliberately, rather than guessing one.
  const [carrier, setCarrier] = useState(
    address !== undefined && address.bostaCityId !== null ? "bosta" : "",
  );
  const [bostaCityId, setBostaCityId] = useState(address?.bostaCityId ?? "");
  const [bostaDistrictId, setBostaDistrictId] = useState(address?.bostaDistrictId ?? "");
  const [bostaCityName, setBostaCityName] = useState(address?.bostaCityName ?? null);

  const submit = async (): Promise<void> => {
    const body: AddressInput = {
      line: line.trim(),
      ...(landmark.trim().length > 0
        ? { landmark: landmark.trim() }
        : editing
          ? { landmark: null }
          : {}),
      ...(governorateId.length > 0 ? { governorateId } : editing ? { governorateId: null } : {}),
      ...(carrier === "bosta"
        ? {
            bostaCityId: bostaCityId.length > 0 ? bostaCityId : null,
            bostaDistrictId: bostaDistrictId.length > 0 ? bostaDistrictId : null,
            bostaCityName,
          }
        : editing
          ? { bostaCityId: null, bostaDistrictId: null, bostaCityName: null }
          : {}),
      isDefault,
      ...(editing ? { active } : {}),
    };
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="address-line">{t("customers.address.field.line")} *</Label>
          <Input
            id="address-line"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            aria-label={t("customers.address.field.line")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="address-governorate">{t("customers.address.field.governorate")}</Label>
          <select
            id="address-governorate"
            aria-label={t("customers.address.field.governorate")}
            value={governorateId}
            onChange={(e) => setGovernorateId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
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
          <Label htmlFor="address-landmark">{t("customers.address.field.landmark")}</Label>
          <Input
            id="address-landmark"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            aria-label={t("customers.address.field.landmark")}
          />
        </div>
      </div>

      <CarrierShippingFields
        value={{ carrier, bostaCityId, bostaDistrictId }}
        onChange={(next) => {
          setCarrier(next.carrier);
          setBostaCityId(next.bostaCityId);
          setBostaDistrictId(next.bostaDistrictId);
          setBostaCityName(next.bostaCityName);
        }}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        {t("customers.address.field.isDefault")}
      </label>
      {editing ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("customers.status.active")}
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={submitting || line.trim().length === 0}
          onClick={() => void submit()}
        >
          {t("customers.actions.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("customers.actions.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------

/**
 * Narrow a detail response back to a list row. The full phone is dropped and
 * replaced by the mask the list is allowed to show — the same discipline the
 * API applies, applied again here so a detail read cannot leak a full number
 * into the list through a state update.
 */
function toListItem(detail: CustomerDetail): CustomerListItem {
  return {
    id: detail.id,
    name: detail.name,
    phoneMasked: maskPhone(detail.phone),
    email: detail.email,
    ordersCount: detail.ordersCount,
    totalSpent: detail.totalSpent,
    lastOrderAt: detail.lastOrderAt,
    active: detail.active,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

/** Mask an E.164 number the way the API masks it: `+2010•••4567`. */
function maskPhone(e164: string): string {
  if (e164.length <= 9) return e164;
  return `${e164.slice(0, 5)}•••${e164.slice(-4)}`;
}

/** Integer minor units → a locale-formatted amount. */
function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** An ISO date-time → a locale date, or a dash when there is none. */
function formatDate(iso: string | null, locale: string): string {
  return iso === null ? DASH : new Date(iso).toLocaleDateString(locale);
}

/**
 * Pick the message for a failed write. A duplicate phone is the one error a
 * back-office user can actually act on, so it gets its own line instead of the
 * generic "could not save".
 */
function saveErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError && error.code === "CONFLICT") return t("customers.duplicatePhone");
  if (error instanceof ApiError && error.code === "UNPROCESSABLE_ENTITY") {
    return t("customers.invalidPhone");
  }
  return t("customers.saveFailed");
}
