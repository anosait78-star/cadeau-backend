import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import { PageTitle } from "@/components/layout/page-title";
import { useRegisterMobileRefresh } from "@/components/shell/mobile/mobile-header-context";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  archiveWarehouse,
  createWarehouse,
  listWarehouses,
  updateWarehouse,
  type Warehouse,
  type WarehouseInput,
} from "@/features/inventory/inventory-api";
import { WarehouseJoinCodeDialog } from "@/features/inventory/warehouse-join-code-dialog";
import { filterWarehouses, sortWarehousesByName } from "@/features/inventory/warehouse-search";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { Field, FormActions } from "../inventory/inventory-form-parts";
import { buildWarehouseColumns } from "../inventory/inventory-warehouse-columns";

type WarehouseState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: Warehouse[] };

/**
 * Vendor warehouses — the stock locations (one per vendor), split out of the
 * inventory screen into their own destination. Behind the `inventory` feature;
 * every write is behind `inventory.manage` (the API re-checks both — ADR-003).
 *
 * The whole list is already loaded (warehouses are few), so search and sort run
 * here: `Intl.Collator` orders Arabic correctly where the database collation
 * may not, and the search folds Arabic spelling variants (أ/إ/ا, ة/ه, ى/ي).
 */
export function VendorWarehousesPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="inventory"
      fallback={
        <div className="mx-auto w-full max-w-5xl lg:p-6">
          <EmptyState title={t("inventory.forbidden")} />
        </div>
      }
    >
      <VendorWarehousesScreen />
    </FeatureGate>
  );
}

function VendorWarehousesScreen(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<WarehouseState>({ kind: "loading" });
  const [query, setQuery] = useState("");

  const flash = useCallback((text: string): void => toast.show(text), [toast]);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", items: await listWarehouses({ active: "all" }) });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useRegisterMobileRefresh(() => load());

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => (state.kind === "ready" ? sortWarehousesByName(state.items) : []),
    [state],
  );
  const visible: WarehouseState =
    state.kind === "ready" ? { kind: "ready", items: filterWarehouses(sorted, query) } : state;
  const searching = query.trim().length > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:p-6">
      <PageTitle title={t("vendorWarehouses.title")} description={t("vendorWarehouses.subtitle")} />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("vendorWarehouses.search")}
        aria-label={t("vendorWarehouses.search")}
        className="sm:max-w-sm"
      />
      <WarehousesTab
        state={visible}
        onReload={load}
        onNotify={flash}
        emptyTitle={searching ? t("vendorWarehouses.noMatch") : t("inventory.warehouses.empty")}
      />
    </div>
  );
}

function WarehousesTab({
  state,
  onReload,
  onNotify,
  emptyTitle,
}: {
  state: WarehouseState;
  onReload: () => Promise<void>;
  onNotify: (text: string) => void;
  emptyTitle: string;
}): ReactNode {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
  const [joinCodeWarehouse, setJoinCodeWarehouse] = useState<Warehouse | null>(null);

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
        onJoinCode={() => setJoinCodeWarehouse(warehouse)}
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
            emptyState={<EmptyState title={emptyTitle} />}
          />
        ) : (
          <MobileCardList<Warehouse>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderWarehouseDetail}
            emptyTitle={emptyTitle}
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

      {joinCodeWarehouse !== null ? (
        <PermissionGate permission="inventory.manage">
          <WarehouseJoinCodeDialog
            open={joinCodeWarehouse !== null}
            onOpenChange={(open) => {
              if (!open) setJoinCodeWarehouse(null);
            }}
            warehouseId={joinCodeWarehouse.id}
            warehouseName={joinCodeWarehouse.name}
          />
        </PermissionGate>
      ) : null}
    </div>
  );
}

function WarehouseCard({
  warehouse,
  onEdit,
  onArchive,
  onJoinCode,
}: {
  warehouse: Warehouse;
  onEdit: () => void;
  onArchive: () => void;
  onJoinCode: () => void;
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
            <Button size="sm" variant="outline" onClick={onJoinCode}>
              {t("inventory.actions.joinCode")}
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
