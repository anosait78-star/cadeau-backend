import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { ConfirmDialog } from "@/components/confirm-dialog/confirm-dialog";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { TableToolbar } from "@/components/table-toolbar/table-toolbar";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { listWarehouses, type Warehouse } from "@/features/inventory/inventory-api";
import {
  STOREFRONT_EVENT_STATUSES,
  STOREFRONT_EVENT_TYPES,
  STOREFRONT_PLATFORMS,
  createStorefrontConnection,
  createVendorWarehouseMapping,
  deleteVendorWarehouseMapping,
  listStorefrontConnections,
  listStorefrontEvents,
  listVendorWarehouseMappings,
  reprocessStorefrontEvent,
  revokeStorefrontConnection,
  rotateStorefrontConnectionKey,
  updateStorefrontConnection,
  type CreateConnectionInput,
  type StorefrontConnection,
  type StorefrontConnectionWithKey,
  type StorefrontEventStatus,
  type StorefrontEventType,
  type StorefrontPlatform,
  type StorefrontWebhookEvent,
  type VendorWarehouseMapping,
} from "@/features/integrations/storefront-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import {
  buildStorefrontColumns,
  connectionStatusLabel,
  connectionStatusTone,
  DASH,
  formatDateTime,
} from "./storefront-columns";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: StorefrontConnection[];
      readonly nextCursor: string | null;
    };

/**
 * Storefront integration settings (design plan §6.1/M-2/M-6, contract:
 * docs/api/storefront.md): connections a company's storefront(s) push orders
 * and products through, each owning its own API key (D1/D2). Gated by the
 * `storefront_integration` feature; create/edit/rotate/revoke/reprocess are
 * gated additionally by `integrations.manage`.
 */
export function StorefrontPanel(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="storefront_integration"
      fallback={<EmptyState title={t("storefront.forbidden")} />}
    >
      <StorefrontConnectionsScreen />
    </FeatureGate>
  );
}

function StorefrontConnectionsScreen(): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const toast = useToast();

  const [state, setState] = useState<State>({ kind: "loading" });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StorefrontConnection | null>(null);
  const [rotating, setRotating] = useState<StorefrontConnection | null>(null);
  const [revoking, setRevoking] = useState<StorefrontConnection | null>(null);
  const [reveal, setReveal] = useState<StorefrontConnectionWithKey | null>(null);
  const [eventsFor, setEventsFor] = useState<StorefrontConnection | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listStorefrontConnections();
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void listWarehouses({ active: true })
      .then((page) => setWarehouses(page.data))
      .catch(() => setWarehouses([]));
  }, []);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listStorefrontConnections({ cursor: state.nextCursor });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const warehouseName = useCallback(
    (warehouseId: string | null): string => {
      if (warehouseId === null) return DASH;
      return warehouses.find((w) => w.id === warehouseId)?.name ?? DASH;
    },
    [warehouses],
  );

  const upsert = (updated: StorefrontConnection): void => {
    setState((s) =>
      s.kind === "ready"
        ? { ...s, items: s.items.map((c) => (c.id === updated.id ? updated : c)) }
        : s,
    );
  };

  const onCreated = (result: StorefrontConnectionWithKey): void => {
    setState((s) => (s.kind === "ready" ? { ...s, items: [result, ...s.items] } : s));
    setCreating(false);
    setReveal(result);
  };

  const rotate = async (connection: StorefrontConnection): Promise<void> => {
    try {
      const result = await rotateStorefrontConnectionKey(connection.id);
      upsert(result);
      setReveal(result);
    } catch {
      toast.show(t("storefront.rotateFailed"), { variant: "error" });
    }
  };

  const revoke = async (connection: StorefrontConnection): Promise<void> => {
    try {
      const result = await revokeStorefrontConnection(connection.id);
      upsert(result);
      toast.show(t("storefront.revoked"));
    } catch {
      toast.show(t("storefront.revokeFailed"), { variant: "error" });
    }
  };

  const columns = useMemo(
    () => buildStorefrontColumns({ t, locale, warehouseName }),
    [t, locale, warehouseName],
  );

  const renderRowActions = (connection: StorefrontConnection): ReactNode => (
    <PermissionGate permission="integrations.manage">
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(connection)}>
          {t("storefront.actions.edit")}
        </Button>
        {connection.status !== "revoked" ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setRotating(connection)}>
              {t("storefront.actions.rotate")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevoking(connection)}>
              {t("storefront.actions.revoke")}
            </Button>
          </>
        ) : null}
      </div>
    </PermissionGate>
  );

  const renderCard = (connection: StorefrontConnection): ReactNode => (
    <ConnectionCard
      connection={connection}
      warehouseName={warehouseName(connection.defaultWarehouseId)}
      onEdit={() => setEditing(connection)}
      onRotate={() => setRotating(connection)}
      onRevoke={() => setRevoking(connection)}
      onViewEvents={() => setEventsFor(connection)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("storefront.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("storefront.subtitle")}</p>
      </header>

      <TableToolbar
        primaryActions={
          <PermissionGate permission="integrations.manage">
            <Button size="sm" onClick={() => setCreating(true)}>
              {t("storefront.actions.create")}
            </Button>
          </PermissionGate>
        }
      />

      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<StorefrontConnection>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={(row) => setEventsFor(row)}
            rowActions={renderRowActions}
            emptyState={<EmptyState title={t("storefront.empty")} />}
          />
        ) : (
          <MobileCardList<StorefrontConnection>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderCard}
            emptyTitle={t("storefront.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("storefront.loadMore")}
          />
        )
      ) : null}

      <CreateConnectionDialog
        open={creating}
        onOpenChange={setCreating}
        warehouses={warehouses}
        onCreated={onCreated}
      />

      <EditConnectionDialog
        connection={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        warehouses={warehouses}
        onSaved={(updated) => {
          upsert(updated);
          setEditing(null);
          toast.show(t("storefront.saved"));
        }}
        onFailed={() => toast.show(t("storefront.saveFailed"), { variant: "error" })}
      />

      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => {
          if (!open) setRotating(null);
        }}
        title={t("storefront.rotate.confirmTitle")}
        description={t("storefront.rotate.confirmDescription")}
        confirmLabel={t("storefront.actions.rotate")}
        cancelLabel={t("storefront.actions.cancel")}
        onConfirm={() => (rotating === null ? Promise.resolve() : rotate(rotating))}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("storefront.revoke.confirmTitle")}
        description={t("storefront.revoke.confirmDescription")}
        confirmLabel={t("storefront.revoke.confirmAction")}
        cancelLabel={t("storefront.actions.cancel")}
        destructive
        onConfirm={() => (revoking === null ? Promise.resolve() : revoke(revoking))}
      />

      <ApiKeyRevealDialog reveal={reveal} onClose={() => setReveal(null)} />

      <DetailPanel
        open={eventsFor !== null}
        onOpenChange={(open) => {
          if (!open) setEventsFor(null);
        }}
        title={eventsFor?.label ?? ""}
        sections={
          eventsFor === null
            ? []
            : [
                {
                  key: "events",
                  label: t("storefront.events.title"),
                  content: <ConnectionEventsSection connection={eventsFor} />,
                },
                {
                  key: "vendor-warehouses",
                  label: t("storefront.vendorWarehouses.title"),
                  content: (
                    <VendorWarehousesSection connection={eventsFor} warehouses={warehouses} />
                  ),
                },
              ]
        }
      />
    </div>
  );
}

/** A read row for the mobile shell — fields + actions, mirrors the desktop columns + row actions. */
function ConnectionCard({
  connection,
  warehouseName,
  onEdit,
  onRotate,
  onRevoke,
  onViewEvents,
}: {
  connection: StorefrontConnection;
  warehouseName: string;
  onEdit: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  onViewEvents: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{connection.label}</span>
          <StatusBadge
            tone={connectionStatusTone(connection.status)}
            label={connectionStatusLabel(connection.status, t)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("storefront.field.platform")}</dt>
            <dd>{t(`storefront.platform.${connection.platform}` as TranslationKey)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("storefront.field.apiKeyPrefix")}</dt>
            <dd>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {connection.apiKeyPrefix}••••
              </code>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {t("storefront.field.defaultWarehouse")}
            </dt>
            <dd>{warehouseName}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("storefront.field.lastEventAt")}</dt>
            <dd>{formatDateTime(connection.lastEventAt, locale)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onViewEvents}>
            {t("storefront.actions.viewEvents")}
          </Button>
          <PermissionGate permission="integrations.manage">
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t("storefront.actions.edit")}
            </Button>
          </PermissionGate>
          {connection.status !== "revoked" ? (
            <PermissionGate permission="integrations.manage">
              <Button size="sm" variant="outline" onClick={onRotate}>
                {t("storefront.actions.rotate")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onRevoke}>
                {t("storefront.actions.revoke")}
              </Button>
            </PermissionGate>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function platformOptions(t: ReturnType<typeof useI18n>["t"]): ComboboxOption[] {
  return STOREFRONT_PLATFORMS.map((p) => ({
    value: p,
    label: t(`storefront.platform.${p}` as TranslationKey),
  }));
}

function warehouseOptions(
  t: ReturnType<typeof useI18n>["t"],
  warehouses: Warehouse[],
): ComboboxOption[] {
  return [
    { value: "", label: t("storefront.field.noWarehouse") },
    ...warehouses.map((w) => ({ value: w.id, label: w.name })),
  ];
}

/** Create-connection dialog (label / platform / optional default warehouse). */
function CreateConnectionDialog({
  open,
  onOpenChange,
  warehouses,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: Warehouse[];
  onCreated: (result: StorefrontConnectionWithKey) => void;
}): ReactNode {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<StorefrontPlatform>("generic");
  const [warehouseId, setWarehouseId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setPlatform("generic");
    setWarehouseId("");
    setWebhookSecret("");
    setError(null);
  }, [open]);

  const submit = async (): Promise<void> => {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const body: CreateConnectionInput = {
        label: trimmed,
        platform,
        ...(warehouseId !== "" ? { defaultWarehouseId: warehouseId } : {}),
        ...(webhookSecret.trim() !== "" ? { webhookSecret: webhookSecret.trim() } : {}),
      };
      const result = await createStorefrontConnection(body);
      onCreated(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        setError(t("storefront.create.labelTaken"));
      } else {
        setError(t("storefront.saveFailed"));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}
      title={t("storefront.create.title")}
      closeLabel={t("storefront.actions.cancel")}
      size="sm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <FormField label={t("storefront.field.label")} htmlFor="storefront-create-label" required>
          <Input
            id="storefront-create-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label={t("storefront.field.label")}
          />
        </FormField>
        <FormField label={t("storefront.field.platform")} htmlFor="storefront-create-platform">
          <Combobox
            id="storefront-create-platform"
            ariaLabel={t("storefront.field.platform")}
            value={platform}
            onChange={(v) => setPlatform(v as StorefrontPlatform)}
            options={platformOptions(t)}
          />
        </FormField>
        <FormField
          label={t("storefront.field.defaultWarehouse")}
          htmlFor="storefront-create-warehouse"
          optional
        >
          <Combobox
            id="storefront-create-warehouse"
            ariaLabel={t("storefront.field.defaultWarehouse")}
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouseOptions(t, warehouses)}
          />
        </FormField>
        {platform === "woocommerce" ? (
          <FormField
            label={t("storefront.field.webhookSecret")}
            htmlFor="storefront-create-webhook-secret"
            optional
            hint={t("storefront.field.webhookSecretHint")}
          >
            <Input
              id="storefront-create-webhook-secret"
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              aria-label={t("storefront.field.webhookSecret")}
            />
          </FormField>
        ) : null}
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
          {t("storefront.actions.cancel")}
        </Button>
        <Button
          size="sm"
          disabled={pending || label.trim().length === 0}
          onClick={() => void submit()}
        >
          {t("storefront.actions.create")}
        </Button>
      </div>
    </Modal>
  );
}

/** Edit-connection dialog (label / default warehouse / active⇄paused). */
function EditConnectionDialog({
  connection,
  onOpenChange,
  warehouses,
  onSaved,
  onFailed,
}: {
  connection: StorefrontConnection | null;
  onOpenChange: (open: boolean) => void;
  warehouses: Warehouse[];
  onSaved: (updated: StorefrontConnection) => void;
  onFailed: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [active, setActive] = useState(true);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (connection === null) return;
    setLabel(connection.label);
    setWarehouseId(connection.defaultWarehouseId ?? "");
    setActive(connection.status === "active");
    setWebhookSecret("");
  }, [connection]);

  if (connection === null) return null;

  const submit = async (): Promise<void> => {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    try {
      const updated = await updateStorefrontConnection(connection.id, {
        label: trimmed,
        defaultWarehouseId: warehouseId === "" ? null : warehouseId,
        status: active ? "active" : "paused",
        ...(webhookSecret.trim() !== "" ? { webhookSecret: webhookSecret.trim() } : {}),
      });
      onSaved(updated);
    } catch {
      onFailed();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={connection !== null}
      onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}
      title={t("storefront.edit.title")}
      closeLabel={t("storefront.actions.cancel")}
      size="sm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <FormField label={t("storefront.field.label")} htmlFor="storefront-edit-label" required>
          <Input
            id="storefront-edit-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label={t("storefront.field.label")}
          />
        </FormField>
        <FormField
          label={t("storefront.field.defaultWarehouse")}
          htmlFor="storefront-edit-warehouse"
          optional
        >
          <Combobox
            id="storefront-edit-warehouse"
            ariaLabel={t("storefront.field.defaultWarehouse")}
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouseOptions(t, warehouses)}
          />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("storefront.field.active")}
        </label>
        {connection.platform === "woocommerce" ? (
          <FormField
            label={t("storefront.field.webhookSecret")}
            htmlFor="storefront-edit-webhook-secret"
            optional
            hint={t("storefront.field.webhookSecretHint")}
          >
            <Input
              id="storefront-edit-webhook-secret"
              type="password"
              autoComplete="off"
              placeholder="••••••••"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              aria-label={t("storefront.field.webhookSecret")}
            />
          </FormField>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
          {t("storefront.actions.cancel")}
        </Button>
        <Button
          size="sm"
          disabled={pending || label.trim().length === 0}
          onClick={() => void submit()}
        >
          {t("storefront.actions.save")}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * The one-time plaintext API key reveal (create + rotate share this shape).
 * Cannot be dismissed via escape/overlay/the header close button until the
 * user checks "I've copied this key" — the key is never retrievable again.
 */
function ApiKeyRevealDialog({
  reveal,
  onClose,
}: {
  reveal: StorefrontConnectionWithKey | null;
  onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setAcknowledged(false);
  }, [reveal]);

  const copy = async (): Promise<void> => {
    if (reveal === null) return;
    try {
      await navigator.clipboard.writeText(reveal.apiKey);
      toast.show(t("storefront.apiKey.copied"));
    } catch {
      toast.show(t("storefront.apiKey.copyFailed"), { variant: "error" });
    }
  };

  return (
    <Modal
      open={reveal !== null}
      onOpenChange={(next) => {
        if (!next && !acknowledged) return;
        if (!next) onClose();
      }}
      title={t("storefront.apiKey.title")}
      closeLabel={t("storefront.actions.cancel")}
      size="sm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <p className="text-sm text-destructive">{t("storefront.apiKey.warning")}</p>
        {reveal !== null ? (
          <div className="flex flex-col gap-2">
            <code
              data-testid="storefront-api-key"
              className="break-all rounded-md border border-border bg-muted p-3 text-sm"
            >
              {reveal.apiKey}
            </code>
            <Button size="sm" variant="outline" className="self-start" onClick={() => void copy()}>
              {t("storefront.apiKey.copy")}
            </Button>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          {t("storefront.apiKey.ack")}
        </label>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
        <Button size="sm" disabled={!acknowledged} onClick={onClose}>
          {t("storefront.actions.close")}
        </Button>
      </div>
    </Modal>
  );
}

type EventsState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: StorefrontWebhookEvent[];
      readonly nextCursor: string | null;
    };

/** Recent `storefront_webhook_events` for one connection — filter + manual reprocess (D7). */
function ConnectionEventsSection({ connection }: { connection: StorefrontConnection }): ReactNode {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<EventsState>({ kind: "loading" });
  const [status, setStatus] = useState<StorefrontEventStatus | "">("");
  const [eventType, setEventType] = useState<StorefrontEventType | "">("");
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listStorefrontEvents(connection.id, {
        ...(status !== "" ? { status } : {}),
        ...(eventType !== "" ? { eventType } : {}),
      });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [connection.id, status, eventType]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listStorefrontEvents(connection.id, {
      cursor: state.nextCursor,
      ...(status !== "" ? { status } : {}),
      ...(eventType !== "" ? { eventType } : {}),
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const reprocess = async (event: StorefrontWebhookEvent): Promise<void> => {
    setReprocessingId(event.id);
    try {
      await reprocessStorefrontEvent(connection.id, event.id);
      toast.show(t("storefront.events.reprocessSuccess"));
      await load();
    } catch {
      toast.show(t("storefront.events.reprocessFailed"), { variant: "error" });
    } finally {
      setReprocessingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StorefrontEventStatus | "")}
          aria-label={t("storefront.events.filter.status")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">{t("storefront.events.filter.allStatuses")}</option>
          {STOREFRONT_EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`storefront.events.status.${s}` as TranslationKey)}
            </option>
          ))}
        </select>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value as StorefrontEventType | "")}
          aria-label={t("storefront.events.filter.eventType")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">{t("storefront.events.filter.allTypes")}</option>
          {STOREFRONT_EVENT_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`storefront.events.type.${ty}` as TranslationKey)}
            </option>
          ))}
        </select>
      </div>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <EmptyState title={t("storefront.events.empty")} />
      ) : null}

      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.items.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{event.externalId}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone="neutral"
                    label={t(`storefront.events.type.${event.eventType}` as TranslationKey)}
                  />
                  <StatusBadge
                    tone={
                      event.status === "processed"
                        ? "success"
                        : event.status === "failed"
                          ? "destructive"
                          : "warning"
                    }
                    label={t(`storefront.events.status.${event.status}` as TranslationKey)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(event.receivedAt, locale)} · {t("storefront.events.field.attempts")}
                : {event.attemptCount}
              </p>
              {event.error !== null ? (
                <p className="text-xs text-destructive">{event.error}</p>
              ) : null}
              {event.status === "failed" ? (
                <PermissionGate permission="integrations.manage">
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start"
                    disabled={reprocessingId === event.id}
                    onClick={() => void reprocess(event)}
                  >
                    {t("storefront.events.reprocess")}
                  </Button>
                </PermissionGate>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.nextCursor !== null ? (
        <Button variant="outline" size="sm" className="self-center" onClick={() => void loadMore()}>
          {t("storefront.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

type VendorWarehousesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: VendorWarehouseMapping[];
      readonly nextCursor: string | null;
    };

/**
 * Marketplace vendor -> warehouse routing for one connection (multi-vendor
 * discovery, 2026-08-10). No mapping is ever created automatically — an
 * unmapped vendor's orders fail closed until an admin adds one here.
 */
function VendorWarehousesSection({
  connection,
  warehouses,
}: {
  connection: StorefrontConnection;
  warehouses: Warehouse[];
}): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const [state, setState] = useState<VendorWarehousesState>({ kind: "loading" });
  const [vendorId, setVendorId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<VendorWarehouseMapping | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listVendorWarehouseMappings(connection.id);
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [connection.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listVendorWarehouseMappings(connection.id, { cursor: state.nextCursor });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const warehouseName = (id: string): string => warehouses.find((w) => w.id === id)?.name ?? id;

  const add = async (): Promise<void> => {
    const trimmed = vendorId.trim();
    if (trimmed.length === 0 || warehouseId === "") return;
    setAdding(true);
    setAddError(null);
    try {
      await createVendorWarehouseMapping(connection.id, {
        externalVendorId: trimmed,
        warehouseId,
      });
      setVendorId("");
      setWarehouseId("");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        setAddError(t("storefront.vendorWarehouses.duplicateVendor"));
      } else {
        setAddError(t("storefront.vendorWarehouses.addFailed"));
      }
    } finally {
      setAdding(false);
    }
  };

  const remove = async (mapping: VendorWarehouseMapping): Promise<void> => {
    try {
      await deleteVendorWarehouseMapping(connection.id, mapping.id);
      toast.show(t("storefront.vendorWarehouses.removed"));
      await load();
    } catch {
      toast.show(t("storefront.vendorWarehouses.removeFailed"), { variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">
        {t("storefront.vendorWarehouses.description")}
      </p>

      <PermissionGate permission="integrations.manage">
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <FormField
              label={t("storefront.vendorWarehouses.field.vendorId")}
              htmlFor="vendor-warehouse-vendor-id"
              hint={t("storefront.vendorWarehouses.field.vendorIdHint")}
              className="flex-1"
            >
              <Input
                id="vendor-warehouse-vendor-id"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                aria-label={t("storefront.vendorWarehouses.field.vendorId")}
              />
            </FormField>
            <FormField
              label={t("storefront.vendorWarehouses.field.warehouse")}
              htmlFor="vendor-warehouse-warehouse"
              className="flex-1"
            >
              <Combobox
                id="vendor-warehouse-warehouse"
                ariaLabel={t("storefront.vendorWarehouses.field.warehouse")}
                value={warehouseId}
                onChange={setWarehouseId}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </FormField>
            <Button
              size="sm"
              disabled={adding || vendorId.trim().length === 0 || warehouseId === ""}
              onClick={() => void add()}
            >
              {t("storefront.vendorWarehouses.actions.add")}
            </Button>
          </div>
          {addError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {addError}
            </p>
          ) : null}
        </div>
      </PermissionGate>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <EmptyState title={t("storefront.vendorWarehouses.empty")} />
      ) : null}

      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.items.map((mapping) => (
            <li
              key={mapping.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
            >
              <span className="font-medium">{mapping.externalVendorId}</span>
              <span className="text-muted-foreground">{warehouseName(mapping.warehouseId)}</span>
              <PermissionGate permission="integrations.manage">
                <Button size="sm" variant="ghost" onClick={() => setRemoving(mapping)}>
                  {t("storefront.vendorWarehouses.actions.remove")}
                </Button>
              </PermissionGate>
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.nextCursor !== null ? (
        <Button variant="outline" size="sm" className="self-center" onClick={() => void loadMore()}>
          {t("storefront.loadMore")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("storefront.vendorWarehouses.remove.confirmTitle")}
        description={t("storefront.vendorWarehouses.remove.confirmDescription")}
        confirmLabel={t("storefront.vendorWarehouses.remove.confirmAction")}
        cancelLabel={t("storefront.actions.cancel")}
        destructive
        onConfirm={async () => {
          if (removing === null) return;
          await remove(removing);
          setRemoving(null);
        }}
      />
    </div>
  );
}
