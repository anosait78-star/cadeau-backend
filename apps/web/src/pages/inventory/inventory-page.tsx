import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import { FilterBar } from "@/components/filter-bar/filter-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADJUSTMENT_REASONS,
  archiveWarehouse,
  createAdjustment,
  createTransfer,
  createWarehouse,
  listStock,
  listWarehouses,
  setReorderPoint,
  updateWarehouse,
  type AdjustmentReason,
  type StockLevel,
  type Warehouse,
  type WarehouseInput,
} from "@/features/inventory/inventory-api";
import { listProducts, listVariants } from "@/features/products/products-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { buildStockColumns } from "./inventory-stock-columns";
import { buildWarehouseColumns } from "./inventory-warehouse-columns";

/** A selectable option (warehouse or variant). */
interface Option {
  readonly id: string;
  readonly name: string;
}

type Tab = "stock" | "warehouses";

type WarehouseState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: Warehouse[] };

type StockState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: StockLevel[]; readonly nextCursor: string | null };

/**
 * Inventory — stock levels and the locations that hold them. The whole page is
 * behind the `inventory` feature; every write (create/edit/archive a warehouse,
 * adjust, transfer, set a reorder point) is behind `inventory.manage` (the API
 * re-checks both — ADR-003). One responsive card list serves both shells (the
 * card alternative required by ADR-002). Variant names come from the EPIC-8
 * catalog.
 */
export function InventoryPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="inventory"
      fallback={
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
          <EmptyState title={t("inventory.forbidden")} />
        </div>
      }
    >
      <InventoryScreen />
    </FeatureGate>
  );
}

function InventoryScreen(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("stock");
  const [warehouses, setWarehouses] = useState<WarehouseState>({ kind: "loading" });
  const [variants, setVariants] = useState<Option[]>([]);

  const flash = useCallback((text: string): void => toast.show(text), [toast]);

  const loadWarehouses = useCallback(async (): Promise<void> => {
    setWarehouses({ kind: "loading" });
    try {
      const page = await listWarehouses({ active: "all" });
      setWarehouses({ kind: "ready", items: page.data });
    } catch {
      setWarehouses({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  // Resolve variant ids to readable "Product — Variant" labels (best-effort:
  // the screen still works with raw ids if the catalog call fails).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const products = await listProducts({ active: true });
        const lists = await Promise.all(
          products.data.map(async (product) => {
            const res = await listVariants(product.id);
            return res.data.map((v) => ({ id: v.id, name: `${product.name} — ${v.name}` }));
          }),
        );
        if (!cancelled) setVariants(lists.flat());
      } catch {
        if (!cancelled) setVariants([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const warehouseOptions: Option[] =
    warehouses.kind === "ready"
      ? warehouses.items.filter((w) => w.active).map((w) => ({ id: w.id, name: w.name }))
      : [];
  const warehouseNames = new Map(
    warehouses.kind === "ready" ? warehouses.items.map((w) => [w.id, w.name]) : [],
  );
  const variantNames = new Map(variants.map((v) => [v.id, v.name]));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("inventory.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("inventory.subtitle")}</p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("inventory.title")}>
        <Button
          role="tab"
          aria-selected={tab === "stock"}
          variant={tab === "stock" ? "primary" : "outline"}
          onClick={() => setTab("stock")}
        >
          {t("inventory.tab.stock")}
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "warehouses"}
          variant={tab === "warehouses" ? "primary" : "outline"}
          onClick={() => setTab("warehouses")}
        >
          {t("inventory.tab.warehouses")}
        </Button>
      </div>

      {tab === "stock" ? (
        <StockTab
          warehouses={warehouseOptions}
          variants={variants}
          warehouseNames={warehouseNames}
          variantNames={variantNames}
          onNotify={flash}
        />
      ) : (
        <WarehousesTab state={warehouses} onReload={loadWarehouses} onNotify={flash} />
      )}
    </div>
  );
}

// ---- Stock tab -------------------------------------------------------------

function StockTab({
  warehouses,
  variants,
  warehouseNames,
  variantNames,
  onNotify,
}: {
  warehouses: readonly Option[];
  variants: readonly Option[];
  warehouseNames: ReadonlyMap<string, string>;
  variantNames: ReadonlyMap<string, string>;
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const [state, setState] = useState<StockState>({ kind: "loading" });
  const [warehouseId, setWarehouseId] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [form, setForm] = useState<"adjust" | "transfer" | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<StockLevel | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listStock({
        ...(warehouseId.length > 0 ? { warehouseId } : {}),
        ...(lowOnly ? { belowReorder: true } : {}),
        sort: lowOnly ? "available" : "-updatedAt",
      });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [warehouseId, lowOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listStock({
      cursor: state.nextCursor,
      ...(warehouseId.length > 0 ? { warehouseId } : {}),
      ...(lowOnly ? { belowReorder: true } : {}),
      sort: lowOnly ? "available" : "-updatedAt",
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const afterWrite = async (message: string): Promise<void> => {
    onNotify(message);
    setForm(null);
    setSelectedLevel(null);
    await load();
  };

  const activeFilterCount = (warehouseId.length > 0 ? 1 : 0) + (lowOnly ? 1 : 0);
  const clearFilters = (): void => {
    setWarehouseId("");
    setLowOnly(false);
  };

  const columns = useMemo(
    () => buildStockColumns({ t, warehouseNames, variantNames }),
    [t, warehouseNames, variantNames],
  );

  const renderStockDetail = (level: StockLevel): ReactNode => (
    <StockCard
      level={level}
      warehouseName={warehouseNames.get(level.warehouseId) ?? level.warehouseId}
      variantName={variantNames.get(level.variantId) ?? level.variantId}
      onSaved={() => void afterWrite(t("inventory.saved"))}
      onFail={() => onNotify(t("inventory.saveFailed"))}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        activeCount={activeFilterCount}
        onClearAll={clearFilters}
        clearAllLabel={t("inventory.filter.clear")}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="stock-warehouse">{t("inventory.filter.warehouse")}</Label>
          <OptionSelect
            id="stock-warehouse"
            value={warehouseId}
            options={warehouses}
            onChange={setWarehouseId}
            ariaLabel={t("inventory.filter.warehouse")}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          {t("inventory.filter.lowOnly")}
        </label>
        <PermissionGate permission="inventory.manage">
          <Button variant="outline" onClick={() => setForm(form === "adjust" ? null : "adjust")}>
            {t("inventory.actions.adjust")}
          </Button>
          <Button
            variant="outline"
            onClick={() => setForm(form === "transfer" ? null : "transfer")}
          >
            {t("inventory.actions.transfer")}
          </Button>
        </PermissionGate>
      </FilterBar>

      {form === "adjust" ? (
        <PermissionGate permission="inventory.manage">
          <AdjustForm
            warehouses={warehouses}
            variants={variants}
            onDone={afterWrite}
            onFail={() => onNotify(t("inventory.saveFailed"))}
            onCancel={() => setForm(null)}
          />
        </PermissionGate>
      ) : null}

      {form === "transfer" ? (
        <PermissionGate permission="inventory.manage">
          <TransferForm
            warehouses={warehouses}
            variants={variants}
            onDone={afterWrite}
            onFail={() => onNotify(t("inventory.saveFailed"))}
            onCancel={() => setForm(null)}
          />
        </PermissionGate>
      ) : null}

      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<StockLevel>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={setSelectedLevel}
            emptyState={<EmptyState title={t("inventory.stock.empty")} />}
          />
        ) : (
          <MobileCardList<StockLevel>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderStockDetail}
            emptyTitle={t("inventory.stock.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("inventory.loadMore")}
          />
        )
      ) : null}

      <DetailPanel
        open={selectedLevel !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedLevel(null);
        }}
        title={
          selectedLevel === null
            ? ""
            : (variantNames.get(selectedLevel.variantId) ?? selectedLevel.variantId)
        }
        sections={
          selectedLevel === null
            ? []
            : [
                {
                  key: "details",
                  label: t("inventory.title"),
                  content: renderStockDetail(selectedLevel),
                },
              ]
        }
      />
    </div>
  );
}

/** One stock level: balances, a low-stock badge, and an inline threshold editor. */
function StockCard({
  level,
  warehouseName,
  variantName,
  onSaved,
  onFail,
}: {
  level: StockLevel;
  warehouseName: string;
  variantName: string;
  onSaved: () => void;
  onFail: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(level.reorderPoint));
  const [submitting, setSubmitting] = useState(false);
  const low = level.reorderPoint > 0 && level.available <= level.reorderPoint;

  const save = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await setReorderPoint({
        warehouseId: level.warehouseId,
        variantId: level.variantId,
        reorderPoint: Number(value),
      });
      setEditing(false);
      onSaved();
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{variantName}</span>
          <span className="text-sm font-normal text-muted-foreground">{warehouseName}</span>
          {low ? (
            <span
              className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-normal text-destructive"
              data-testid="low-badge"
            >
              {t("inventory.stock.low")}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Figure label={t("inventory.stock.onHand")} value={level.onHand} />
          <Figure label={t("inventory.stock.committed")} value={level.committed} />
          <Figure label={t("inventory.stock.available")} value={level.available} />
          <Figure label={t("inventory.stock.reorderPoint")} value={level.reorderPoint} />
        </dl>

        <PermissionGate permission="inventory.manage">
          {editing ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`reorder-${level.id}`}>{t("inventory.stock.reorderPoint")}</Label>
                <Input
                  id={`reorder-${level.id}`}
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-label={t("inventory.stock.reorderPoint")}
                />
              </div>
              <Button size="sm" disabled={submitting} onClick={() => void save()}>
                {t("inventory.actions.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("inventory.actions.cancel")}
              </Button>
            </div>
          ) : (
            <div>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {t("inventory.actions.setReorderPoint")}
              </Button>
            </div>
          )}
        </PermissionGate>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Adjust on-hand stock with a reason code. */
function AdjustForm({
  warehouses,
  variants,
  onDone,
  onFail,
  onCancel,
}: {
  warehouses: readonly Option[];
  variants: readonly Option[];
  onDone: (message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [warehouseId, setWarehouseId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("count");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const invalid =
    warehouseId.length === 0 ||
    variantId.length === 0 ||
    !Number.isInteger(Number(delta)) ||
    Number(delta) === 0;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await createAdjustment({
        warehouseId,
        variantId,
        quantityDelta: Number(delta),
        reason,
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
      });
      await onDone(t("inventory.saved"));
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <h2 className="text-sm font-medium">{t("inventory.actions.adjust")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="adjust-warehouse" label={t("inventory.field.warehouse")}>
            <OptionSelect
              id="adjust-warehouse"
              value={warehouseId}
              options={warehouses}
              onChange={setWarehouseId}
              ariaLabel={t("inventory.field.warehouse")}
            />
          </Field>
          <Field id="adjust-variant" label={t("inventory.field.variant")}>
            <OptionSelect
              id="adjust-variant"
              value={variantId}
              options={variants}
              onChange={setVariantId}
              ariaLabel={t("inventory.field.variant")}
            />
          </Field>
          <Field id="adjust-delta" label={t("inventory.field.quantityDelta")}>
            <Input
              id="adjust-delta"
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              aria-label={t("inventory.field.quantityDelta")}
            />
          </Field>
          <Field id="adjust-reason" label={t("inventory.field.reason")}>
            <select
              id="adjust-reason"
              aria-label={t("inventory.field.reason")}
              value={reason}
              onChange={(e) => setReason(e.target.value as AdjustmentReason)}
              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            >
              {ADJUSTMENT_REASONS.map((code) => (
                <option key={code} value={code}>
                  {t(`inventory.reason.${code}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="adjust-note" label={t("inventory.field.note")} wide>
            <Input
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={t("inventory.field.note")}
            />
          </Field>
        </div>
        <FormActions
          disabled={submitting || invalid}
          onSubmit={() => void submit()}
          onCancel={onCancel}
        />
      </CardContent>
    </Card>
  );
}

/** Move stock between two warehouses. */
function TransferForm({
  warehouses,
  variants,
  onDone,
  onFail,
  onCancel,
}: {
  warehouses: readonly Option[];
  variants: readonly Option[];
  onDone: (message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [fromWarehouseId, setFrom] = useState("");
  const [toWarehouseId, setTo] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const invalid =
    fromWarehouseId.length === 0 ||
    toWarehouseId.length === 0 ||
    fromWarehouseId === toWarehouseId ||
    variantId.length === 0 ||
    !Number.isInteger(Number(quantity)) ||
    Number(quantity) < 1;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await createTransfer({
        fromWarehouseId,
        toWarehouseId,
        variantId,
        quantity: Number(quantity),
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
      });
      await onDone(t("inventory.saved"));
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <h2 className="text-sm font-medium">{t("inventory.actions.transfer")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="transfer-from" label={t("inventory.field.fromWarehouse")}>
            <OptionSelect
              id="transfer-from"
              value={fromWarehouseId}
              options={warehouses}
              onChange={setFrom}
              ariaLabel={t("inventory.field.fromWarehouse")}
            />
          </Field>
          <Field id="transfer-to" label={t("inventory.field.toWarehouse")}>
            <OptionSelect
              id="transfer-to"
              value={toWarehouseId}
              options={warehouses}
              onChange={setTo}
              ariaLabel={t("inventory.field.toWarehouse")}
            />
          </Field>
          <Field id="transfer-variant" label={t("inventory.field.variant")}>
            <OptionSelect
              id="transfer-variant"
              value={variantId}
              options={variants}
              onChange={setVariantId}
              ariaLabel={t("inventory.field.variant")}
            />
          </Field>
          <Field id="transfer-quantity" label={t("inventory.field.quantity")}>
            <Input
              id="transfer-quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-label={t("inventory.field.quantity")}
            />
          </Field>
          <Field id="transfer-note" label={t("inventory.field.note")} wide>
            <Input
              id="transfer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={t("inventory.field.note")}
            />
          </Field>
        </div>
        <FormActions
          disabled={submitting || invalid}
          onSubmit={() => void submit()}
          onCancel={onCancel}
        />
      </CardContent>
    </Card>
  );
}

// ---- Warehouses tab --------------------------------------------------------

function WarehousesTab({
  state,
  onReload,
  onNotify,
}: {
  state: WarehouseState;
  onReload: () => Promise<void>;
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);

  const save = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      setCreating(false);
      setEditingId(null);
      setSelectedWarehouse(null);
      onNotify(t("inventory.saved"));
      await onReload();
    } catch {
      onNotify(t("inventory.saveFailed"));
    }
  };

  const columns = useMemo(() => buildWarehouseColumns({ t }), [t]);

  const renderWarehouseDetail = (warehouse: Warehouse): ReactNode =>
    editingId === warehouse.id ? (
      <WarehouseForm
        warehouse={warehouse}
        onSubmit={(body) => save(() => updateWarehouse(warehouse.id, body))}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <WarehouseCard
        warehouse={warehouse}
        onEdit={() => setEditingId(warehouse.id)}
        onArchive={() => void save(() => archiveWarehouse(warehouse.id))}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <PermissionGate permission="inventory.manage">
        {creating ? null : (
          <div>
            <Button onClick={() => setCreating(true)}>{t("inventory.actions.create")}</Button>
          </div>
        )}
      </PermissionGate>

      {creating ? (
        <PermissionGate permission="inventory.manage">
          <WarehouseForm
            onSubmit={(body) => save(() => createWarehouse(body))}
            onCancel={() => setCreating(false)}
          />
        </PermissionGate>
      ) : null}

      {state.kind === "error" ? <ErrorState onRetry={() => void onReload()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<Warehouse>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={false}
            onLoadMore={() => {}}
            onRowClick={setSelectedWarehouse}
            emptyState={<EmptyState title={t("inventory.warehouses.empty")} />}
          />
        ) : (
          <MobileCardList<Warehouse>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderWarehouseDetail}
            emptyTitle={t("inventory.warehouses.empty")}
            hasMore={false}
            onLoadMore={() => {}}
            loadMoreLabel=""
          />
        )
      ) : null}

      <DetailPanel
        open={selectedWarehouse !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedWarehouse(null);
            setEditingId(null);
          }
        }}
        title={selectedWarehouse?.name ?? ""}
        sections={
          selectedWarehouse === null
            ? []
            : [
                {
                  key: "details",
                  label: t("inventory.tab.warehouses"),
                  content: renderWarehouseDetail(selectedWarehouse),
                },
              ]
        }
      />
    </div>
  );
}

function WarehouseCard({
  warehouse,
  onEdit,
  onArchive,
}: {
  warehouse: Warehouse;
  onEdit: () => void;
  onArchive: () => void;
}): ReactNode {
  const { t } = useI18n();
  const dash = "—";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{warehouse.name}</span>
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
            data-testid="status"
          >
            {warehouse.active ? t("inventory.status.active") : t("inventory.status.inactive")}
          </span>
          {warehouse.isDefault ? (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-normal text-primary">
              {t("inventory.field.isDefault")}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("inventory.field.code")}</dt>
            <dd>{warehouse.code ?? dash}</dd>
          </div>
          <div className="col-span-2 flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("inventory.field.address")}</dt>
            <dd>{warehouse.address ?? dash}</dd>
          </div>
        </dl>
        <PermissionGate permission="inventory.manage">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t("inventory.actions.edit")}
            </Button>
            {warehouse.active ? (
              <Button size="sm" variant="ghost" onClick={onArchive}>
                {t("inventory.actions.archive")}
              </Button>
            ) : null}
          </div>
        </PermissionGate>
      </CardContent>
    </Card>
  );
}

function WarehouseForm({
  warehouse,
  onSubmit,
  onCancel,
}: {
  warehouse?: Warehouse;
  onSubmit: (body: WarehouseInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [name, setName] = useState(warehouse?.name ?? "");
  const [code, setCode] = useState(warehouse?.code ?? "");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [isDefault, setIsDefault] = useState(warehouse?.isDefault ?? false);
  const [submitting, setSubmitting] = useState(false);
  const editing = warehouse !== undefined;

  const submit = async (): Promise<void> => {
    const body: WarehouseInput = {
      name: name.trim(),
      // On edit an emptied optional clears it (null); on create, omit empties.
      ...(code.trim().length > 0 ? { code: code.trim() } : editing ? { code: null } : {}),
      ...(address.trim().length > 0
        ? { address: address.trim() }
        : editing
          ? { address: null }
          : {}),
      isDefault,
    };
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="warehouse-name" label={`${t("inventory.field.name")} *`}>
            <Input
              id="warehouse-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("inventory.field.name")}
            />
          </Field>
          <Field id="warehouse-code" label={t("inventory.field.code")}>
            <Input
              id="warehouse-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label={t("inventory.field.code")}
            />
          </Field>
          <Field id="warehouse-address" label={t("inventory.field.address")} wide>
            <Input
              id="warehouse-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-label={t("inventory.field.address")}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {t("inventory.field.isDefault")}
        </label>
        <FormActions
          disabled={submitting || name.trim().length === 0}
          onSubmit={() => void submit()}
          onCancel={onCancel}
        />
      </CardContent>
    </Card>
  );
}

// ---- Small shared pieces ---------------------------------------------------

function Field({
  id,
  label,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`flex flex-col gap-1${wide ? " sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function FormActions({
  disabled,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={disabled} onClick={onSubmit}>
        {t("inventory.actions.save")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t("inventory.actions.cancel")}
      </Button>
    </div>
  );
}

/** A select over a set of options, with a blank (“all/none”) entry. */
function OptionSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  ariaLabel: string;
}): ReactNode {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="">—</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}
