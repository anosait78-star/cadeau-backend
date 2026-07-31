import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  newIdempotencyKey,
  payPurchaseOrder,
  PURCHASE_ORDER_STATUSES,
  receivePurchaseOrder,
  type CreatePurchaseOrderLineInput,
  type PurchaseOrderDetail,
  type PurchaseOrderListItem,
  type PurchaseOrderPayment,
  type PurchaseOrderReceipt,
  type PurchaseOrderStatus,
} from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { DASH, Field, formatDate, formatMoney, OptionSelect, type Option } from "./finance-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: PurchaseOrderListItem[];
      readonly nextCursor: string | null;
    };

/** Purchase orders — list, filtered; create; a simplified receive/pay flow (EPIC-13). */
export function PurchaseOrdersTab({
  suppliers,
  variants,
  warehouses,
  onNotify,
}: {
  suppliers: readonly Option[];
  variants: readonly Option[];
  warehouses: readonly Option[];
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [status, setStatus] = useState<PurchaseOrderStatus | "">("");
  const [supplierId, setSupplierId] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listPurchaseOrders({
        ...(status !== "" ? { status } : {}),
        ...(supplierId !== "" ? { supplierId } : {}),
      });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [status, supplierId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listPurchaseOrders({
      cursor: state.nextCursor,
      ...(status !== "" ? { status } : {}),
      ...(supplierId !== "" ? { supplierId } : {}),
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="po-status">
            {t("finance.po.filter.status")}
          </label>
          <select
            id="po-status"
            aria-label={t("finance.po.filter.status")}
            value={status}
            onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus | "")}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">—</option>
            {PURCHASE_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`finance.po.status.${s}` as TranslationKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="po-supplier">
            {t("finance.po.filter.supplier")}
          </label>
          <OptionSelect
            id="po-supplier"
            value={supplierId}
            options={suppliers}
            onChange={setSupplierId}
            ariaLabel={t("finance.po.filter.supplier")}
          />
        </div>
        <PermissionGate permission="finance.manage">
          {creating ? null : (
            <Button onClick={() => setCreating(true)}>{t("finance.actions.create")}</Button>
          )}
        </PermissionGate>
      </div>

      {creating ? (
        <PermissionGate permission="finance.manage">
          <CreatePurchaseOrderForm
            suppliers={suppliers}
            variants={variants}
            onDone={async (message) => {
              onNotify(message);
              setCreating(false);
              await load();
            }}
            onFail={() => onNotify(t("finance.saveFailed"))}
            onCancel={() => setCreating(false)}
          />
        </PermissionGate>
      ) : null}

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <EmptyState title={t("finance.po.empty")} />
      ) : null}

      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {state.items.map((po) => (
            <li key={po.id}>
              <PurchaseOrderCard
                po={po}
                supplierName={supplierNames.get(po.supplierId) ?? po.supplierId}
                expanded={expandedId === po.id}
                onToggle={() => setExpandedId(expandedId === po.id ? null : po.id)}
                variants={variants}
                warehouses={warehouses}
                onChanged={async (message) => {
                  onNotify(message);
                  await load();
                }}
                onFail={() => onNotify(t("finance.saveFailed"))}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.nextCursor !== null ? (
        <Button variant="outline" onClick={() => void loadMore()} className="self-center">
          {t("finance.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

function PurchaseOrderCard({
  po,
  supplierName,
  expanded,
  onToggle,
  variants,
  warehouses,
  onChanged,
  onFail,
}: {
  po: PurchaseOrderListItem;
  supplierName: string;
  expanded: boolean;
  onToggle: () => void;
  variants: readonly Option[];
  warehouses: readonly Option[];
  onChanged: (message: string) => void | Promise<void>;
  onFail: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const variantNames = new Map(variants.map((v) => [v.id, v.name]));
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [action, setAction] = useState<"receive" | "pay" | null>(null);
  const [lastReceipt, setLastReceipt] = useState<PurchaseOrderReceipt | null>(null);
  const [lastPayment, setLastPayment] = useState<PurchaseOrderPayment | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await getPurchaseOrder(po.id);
        if (!cancelled) setDetail(d);
      } catch {
        // Best-effort; card still renders summary fields.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, po.id]);

  const canReceive = po.status === "ordered" || po.status === "partially_received";
  const canPay = po.status !== "cancelled" && po.status !== "draft";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>
            {t("finance.po.field.number")} #{po.number}
          </span>
          <span className="text-sm font-normal text-muted-foreground">{supplierName}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {t(`finance.po.status.${po.status}` as TranslationKey)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.po.field.expectedDate")}</dt>
            <dd>{formatDate(po.expectedDate, locale)}</dd>
          </div>
          <div className="col-span-2 flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.po.field.notes")}</dt>
            <dd>{po.notes ?? DASH}</dd>
          </div>
        </dl>

        <Button size="sm" variant="outline" onClick={onToggle}>
          {t("finance.actions.view")}
        </Button>

        {expanded && detail !== null ? (
          <div className="flex flex-col gap-2 rounded-md border border-input p-3">
            <h3 className="text-sm font-medium">{t("finance.po.detail.lines")}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {detail.lines.map((line) => (
                <li key={line.id} className="flex flex-wrap justify-between gap-2">
                  <span>{variantNames.get(line.variantId) ?? line.variantId}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {line.quantityReceived}/{line.quantityOrdered} ×{" "}
                    {formatMoney(line.unitCost, locale)}
                  </span>
                </li>
              ))}
            </ul>
            {lastReceipt !== null ? (
              <p className="text-xs text-muted-foreground">
                {t("finance.po.actions.receive")}: {lastReceipt.id} —{" "}
                {formatDate(lastReceipt.receivedAt, locale)}
              </p>
            ) : null}
            {lastPayment !== null ? (
              <p className="text-xs text-muted-foreground">
                {t("finance.po.actions.pay")}: {formatMoney(lastPayment.amountMinor, locale)} (
                {lastPayment.method})
              </p>
            ) : null}
          </div>
        ) : null}

        <PermissionGate permission="finance.manage">
          <div className="flex flex-wrap gap-2">
            {canReceive ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAction(action === "receive" ? null : "receive")}
              >
                {t("finance.po.actions.receive")}
              </Button>
            ) : null}
            {canPay ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAction(action === "pay" ? null : "pay")}
              >
                {t("finance.po.actions.pay")}
              </Button>
            ) : null}
          </div>

          {action === "receive" ? (
            <ReceiveForm
              poId={po.id}
              warehouses={warehouses}
              onDone={async (result, message) => {
                setLastReceipt(result);
                setAction(null);
                await onChanged(message);
              }}
              onFail={onFail}
              onCancel={() => setAction(null)}
            />
          ) : null}

          {action === "pay" ? (
            <PayForm
              poId={po.id}
              onDone={async (result, message) => {
                setLastPayment(result);
                setAction(null);
                await onChanged(message);
              }}
              onFail={onFail}
              onCancel={() => setAction(null)}
            />
          ) : null}
        </PermissionGate>
      </CardContent>
    </Card>
  );
}

/**
 * Receive form (simplified per the M13.7 scope note): every line's full
 * *remaining* quantity (ordered − already received) is received in one call
 * into the chosen warehouse, rather than a per-line quantity picker.
 */
function ReceiveForm({
  poId,
  warehouses,
  onDone,
  onFail,
  onCancel,
}: {
  poId: string;
  warehouses: readonly Option[];
  onDone: (result: PurchaseOrderReceipt, message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [warehouseId, setWarehouseId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const detail = await getPurchaseOrder(poId);
      const lines = detail.lines
        .filter((l) => l.quantityReceived < l.quantityOrdered)
        .map((l) => ({ poLineId: l.id, quantity: l.quantityOrdered - l.quantityReceived }));
      const result = await receivePurchaseOrder(poId, { warehouseId, lines }, newIdempotencyKey());
      await onDone(result, t("finance.saved"));
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <p className="text-xs text-muted-foreground">{t("finance.po.receive.note")}</p>
        <Field id="receive-warehouse" label={t("finance.po.receive.warehouse")}>
          <OptionSelect
            id="receive-warehouse"
            value={warehouseId}
            options={warehouses}
            onChange={setWarehouseId}
            ariaLabel={t("finance.po.receive.warehouse")}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={submitting || warehouseId === ""}
            onClick={() => void submit()}
          >
            {t("finance.po.receive.submit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("finance.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PayForm({
  poId,
  onDone,
  onFail,
  onCancel,
}: {
  poId: string;
  onDone: (result: PurchaseOrderPayment, message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [submitting, setSubmitting] = useState(false);

  const amountMinor = Math.round(Number(amount) * 100);
  const invalid = !Number.isFinite(amountMinor) || amountMinor < 1 || method.trim().length === 0;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const result = await payPurchaseOrder(
        poId,
        { amountMinor, method: method.trim() },
        newIdempotencyKey(),
      );
      await onDone(result, t("finance.saved"));
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="pay-amount" label={t("finance.po.pay.amount")}>
            <Input
              id="pay-amount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t("finance.po.pay.amount")}
            />
          </Field>
          <Field id="pay-method" label={t("finance.po.pay.method")}>
            <Input
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label={t("finance.po.pay.method")}
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={submitting || invalid} onClick={() => void submit()}>
            {t("finance.po.pay.submit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("finance.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreatePurchaseOrderForm({
  suppliers,
  variants,
  onDone,
  onFail,
  onCancel,
}: {
  suppliers: readonly Option[];
  variants: readonly Option[];
  onDone: (message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CreatePurchaseOrderLineInput[]>([]);
  const [lineVariant, setLineVariant] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineCost, setLineCost] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const addLine = (): void => {
    const qty = Number(lineQty);
    const cost = Math.round(Number(lineCost) * 100);
    if (lineVariant === "" || !Number.isInteger(qty) || qty < 1 || !Number.isFinite(cost)) return;
    setLines([...lines, { variantId: lineVariant, quantityOrdered: qty, unitCost: cost }]);
    setLineVariant("");
    setLineQty("");
    setLineCost("");
  };

  const invalid = supplierId === "" || lines.length === 0;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await createPurchaseOrder(
        {
          supplierId,
          ...(expectedDate.length > 0
            ? { expectedDate: new Date(expectedDate).toISOString() }
            : {}),
          ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
          lines,
        },
        newIdempotencyKey(),
      );
      await onDone(t("finance.saved"));
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  const variantNames = new Map(variants.map((v) => [v.id, v.name]));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="po-create-supplier" label={t("finance.po.field.supplier")}>
            <OptionSelect
              id="po-create-supplier"
              value={supplierId}
              options={suppliers}
              onChange={setSupplierId}
              ariaLabel={t("finance.po.field.supplier")}
            />
          </Field>
          <Field id="po-create-expected" label={t("finance.po.field.expectedDate")}>
            <Input
              id="po-create-expected"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              aria-label={t("finance.po.field.expectedDate")}
            />
          </Field>
          <Field id="po-create-notes" label={t("finance.po.field.notes")} wide>
            <Input
              id="po-create-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-label={t("finance.po.field.notes")}
            />
          </Field>
        </div>

        {lines.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {lines.map((line, idx) => (
              <li key={`${line.variantId}-${idx}`} className="flex justify-between">
                <span>{variantNames.get(line.variantId) ?? line.variantId}</span>
                <span className="tabular-nums text-muted-foreground">
                  {line.quantityOrdered} × {(line.unitCost / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <Field id="po-line-variant" label={t("finance.po.field.variant")}>
            <OptionSelect
              id="po-line-variant"
              value={lineVariant}
              options={variants}
              onChange={setLineVariant}
              ariaLabel={t("finance.po.field.variant")}
            />
          </Field>
          <Field id="po-line-qty" label={t("finance.po.field.quantity")}>
            <Input
              id="po-line-qty"
              type="number"
              min={1}
              value={lineQty}
              onChange={(e) => setLineQty(e.target.value)}
              aria-label={t("finance.po.field.quantity")}
            />
          </Field>
          <Field id="po-line-cost" label={t("finance.po.field.unitCost")}>
            <Input
              id="po-line-cost"
              type="number"
              min={0}
              step="0.01"
              value={lineCost}
              onChange={(e) => setLineCost(e.target.value)}
              aria-label={t("finance.po.field.unitCost")}
            />
          </Field>
          <Button size="sm" variant="outline" onClick={addLine}>
            {t("finance.po.form.addLine")}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button size="sm" disabled={submitting || invalid} onClick={() => void submit()}>
            {t("finance.actions.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("finance.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
