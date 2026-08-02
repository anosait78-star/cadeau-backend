import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { TableToolbar } from "@/components/table-toolbar/table-toolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createInvoice,
  downloadInvoicePdf,
  getInvoice,
  listInvoices,
  newIdempotencyKey,
  type CreateInvoiceLineInput,
  type InvoiceDetail,
  type InvoiceListItem,
} from "@/features/finance/finance-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { buildInvoiceColumns } from "./invoices-columns";
import { DASH, Field, formatDate, formatMoney } from "./finance-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: InvoiceListItem[];
      readonly nextCursor: string | null;
    };

/** Invoices — list, detail (lines + VAT), a PDF download, and issuing (order or manual). */
export function InvoicesTab({ onNotify }: { onNotify: (text: string) => void }): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [orderId, setOrderId] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [selected, setSelected] = useState<InvoiceListItem | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listInvoices({
        ...(orderId.trim().length > 0 ? { orderId: orderId.trim() } : {}),
      });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listInvoices({
      cursor: state.nextCursor,
      ...(orderId.trim().length > 0 ? { orderId: orderId.trim() } : {}),
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const toggle = async (id: string): Promise<void> => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      setDetail(await getInvoice(id));
    } catch {
      setDetail(null);
    }
  };

  const download = async (invoice: InvoiceListItem): Promise<void> => {
    try {
      await downloadInvoicePdf(invoice.id, invoice.number);
    } catch {
      onNotify(t("finance.invoices.downloadFailed"));
    }
  };

  const columns = useMemo(() => buildInvoiceColumns({ t, locale }), [t, locale]);

  /** The card (with a toggleable line-items list) for one invoice — shared by the mobile list and the desktop detail panel. */
  const renderInvoiceCard = (invoice: InvoiceListItem): ReactNode => (
    <InvoiceCard
      invoice={invoice}
      lines={expandedId === invoice.id ? detail : null}
      onToggle={() => void toggle(invoice.id)}
      onDownload={() => void download(invoice)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        search={{
          value: orderId,
          onChange: setOrderId,
          onSubmit: () => void load(),
          placeholder: t("finance.invoices.field.order"),
          label: t("finance.invoices.field.order"),
        }}
        primaryActions={
          <PermissionGate permission="finance.manage">
            {creating ? null : (
              <Button onClick={() => setCreating(true)}>{t("finance.actions.create")}</Button>
            )}
          </PermissionGate>
        }
      />

      {creating ? (
        <PermissionGate permission="finance.manage">
          <CreateInvoiceForm
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

      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<InvoiceListItem>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={setSelected}
            emptyState={<EmptyState title={t("finance.invoices.empty")} />}
          />
        ) : (
          <MobileCardList<InvoiceListItem>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderInvoiceCard}
            emptyTitle={t("finance.invoices.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("finance.loadMore")}
          />
        )
      ) : null}

      <DetailPanel
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setExpandedId(null);
          }
        }}
        title={selected !== null ? `${t("finance.invoices.field.number")} #${selected.number}` : ""}
        sections={
          selected === null
            ? []
            : [
                {
                  key: "details",
                  label: t("finance.invoices.field.number"),
                  content: renderInvoiceCard(selected),
                },
              ]
        }
      />
    </div>
  );
}

function InvoiceCard({
  invoice,
  lines,
  onToggle,
  onDownload,
}: {
  invoice: InvoiceListItem;
  lines: InvoiceDetail | null;
  onToggle: () => void;
  onDownload: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>
            {t("finance.invoices.field.number")} #{invoice.number}
          </span>
          <span className="text-sm font-normal tabular-nums text-muted-foreground">
            {formatMoney(invoice.totalMinor, locale)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {t("finance.invoices.field.subtotal")}
            </dt>
            <dd className="tabular-nums">{formatMoney(invoice.subtotalMinor, locale)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.invoices.field.vat")}</dt>
            <dd className="tabular-nums">{formatMoney(invoice.vatMinor, locale)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.invoices.field.order")}</dt>
            <dd>{invoice.orderId ?? DASH}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {t("finance.expenses.field.incurredAt")}
            </dt>
            <dd>{formatDate(invoice.createdAt, locale)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onToggle}>
            {t("finance.actions.view")}
          </Button>
          <Button size="sm" variant="outline" onClick={onDownload}>
            {t("finance.invoices.actions.downloadPdf")}
          </Button>
        </div>

        {lines !== null ? (
          <ul className="flex flex-col gap-1 rounded-md border border-input p-3 text-sm">
            {lines.lines.map((line) => (
              <li key={line.id} className="flex flex-wrap justify-between gap-2">
                <span>{line.description}</span>
                <span className="tabular-nums text-muted-foreground">
                  {line.quantity} × {formatMoney(line.unitPriceMinor, locale)} ={" "}
                  {formatMoney(line.lineTotalMinor, locale)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CreateInvoiceForm({
  onDone,
  onFail,
  onCancel,
}: {
  onDone: (message: string) => void | Promise<void>;
  onFail: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [mode, setMode] = useState<"order" | "manual">("order");
  const [orderId, setOrderId] = useState("");
  const [lines, setLines] = useState<CreateInvoiceLineInput[]>([]);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const addLine = (): void => {
    const qty = Number(quantity);
    const price = Math.round(Number(unitPrice) * 100);
    if (
      description.trim().length === 0 ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      !Number.isFinite(price)
    ) {
      return;
    }
    setLines([...lines, { description: description.trim(), quantity: qty, unitPriceMinor: price }]);
    setDescription("");
    setQuantity("1");
    setUnitPrice("");
  };

  const invalid = mode === "order" ? orderId.trim().length === 0 : lines.length === 0;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await createInvoice(
        mode === "order" ? { orderId: orderId.trim() } : { lines },
        newIdempotencyKey(),
      );
      await onDone(t("finance.saved"));
    } catch {
      onFail();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex gap-2" role="tablist" aria-label={t("finance.tab.invoices")}>
          <Button
            role="tab"
            aria-selected={mode === "order"}
            size="sm"
            variant={mode === "order" ? "primary" : "outline"}
            onClick={() => setMode("order")}
          >
            {t("finance.invoices.mode.order")}
          </Button>
          <Button
            role="tab"
            aria-selected={mode === "manual"}
            size="sm"
            variant={mode === "manual" ? "primary" : "outline"}
            onClick={() => setMode("manual")}
          >
            {t("finance.invoices.mode.manual")}
          </Button>
        </div>

        {mode === "order" ? (
          <Field id="invoice-order-id" label={t("finance.invoices.form.orderId")}>
            <Input
              id="invoice-order-id"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              aria-label={t("finance.invoices.form.orderId")}
            />
          </Field>
        ) : (
          <>
            {lines.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {lines.map((line, idx) => (
                  <li key={`${line.description}-${idx}`} className="flex justify-between">
                    <span>{line.description}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {line.quantity} × {(line.unitPriceMinor / 100).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <Field id="invoice-line-desc" label={t("finance.invoices.form.description")}>
                <Input
                  id="invoice-line-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  aria-label={t("finance.invoices.form.description")}
                />
              </Field>
              <Field id="invoice-line-qty" label={t("finance.invoices.form.quantity")}>
                <Input
                  id="invoice-line-qty"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  aria-label={t("finance.invoices.form.quantity")}
                />
              </Field>
              <Field id="invoice-line-price" label={t("finance.invoices.form.unitPrice")}>
                <Input
                  id="invoice-line-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  aria-label={t("finance.invoices.form.unitPrice")}
                />
              </Field>
              <Button size="sm" variant="outline" onClick={addLine}>
                {t("finance.invoices.form.addLine")}
              </Button>
            </div>
          </>
        )}

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
