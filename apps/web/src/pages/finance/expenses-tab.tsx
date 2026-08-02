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
  createExpense,
  listExpenses,
  newIdempotencyKey,
  updateExpense,
  type Expense,
  type ExpenseInput,
} from "@/features/finance/finance-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { buildExpenseColumns } from "./expenses-columns";
import { DASH, Field, formatDate, formatMoney, OptionSelect, type Option } from "./finance-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: Expense[]; readonly nextCursor: string | null };

/** Expenses — unified, categorized, dated money-out records (EPIC-13). */
export function ExpensesTab({
  suppliers,
  onNotify,
}: {
  suppliers: readonly Option[];
  onNotify: (text: string) => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listExpenses({
        ...(category.trim().length > 0 ? { category: category.trim() } : {}),
      });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listExpenses({
      cursor: state.nextCursor,
      ...(category.trim().length > 0 ? { category: category.trim() } : {}),
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const save = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      setCreating(false);
      setEditingId(null);
      onNotify(t("finance.saved"));
      await load();
    } catch {
      onNotify(t("finance.saveFailed"));
    }
  };

  const columns = useMemo(
    () => buildExpenseColumns({ t, locale, supplierNames }),
    [t, locale, suppliers],
  );

  /** The card-or-edit-form for one expense — shared by the mobile list and the desktop detail panel. */
  const renderExpenseDetail = (expense: Expense): ReactNode =>
    editingId === expense.id ? (
      <ExpenseForm
        expense={expense}
        suppliers={suppliers}
        onSubmit={(body) => save(() => updateExpense(expense.id, body))}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <ExpenseCard
        expense={expense}
        supplierNames={supplierNames}
        onEdit={() => setEditingId(expense.id)}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        search={{
          value: category,
          onChange: setCategory,
          onSubmit: () => void load(),
          placeholder: t("finance.expenses.filter.category"),
          label: t("finance.expenses.filter.category"),
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
          <ExpenseForm
            suppliers={suppliers}
            onSubmit={(body) =>
              save(() =>
                createExpense(
                  {
                    category: body.category ?? "",
                    amountMinor: body.amountMinor ?? 0,
                    incurredAt: body.incurredAt ?? new Date().toISOString(),
                    ...(body.notes !== undefined ? { notes: body.notes } : {}),
                    ...(body.supplierId !== undefined ? { supplierId: body.supplierId } : {}),
                  },
                  newIdempotencyKey(),
                ),
              )
            }
            onCancel={() => setCreating(false)}
          />
        </PermissionGate>
      ) : null}

      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<Expense>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={setSelectedExpense}
            emptyState={<EmptyState title={t("finance.expenses.empty")} />}
          />
        ) : (
          <MobileCardList<Expense>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderExpenseDetail}
            emptyTitle={t("finance.expenses.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("finance.loadMore")}
          />
        )
      ) : null}

      <DetailPanel
        open={selectedExpense !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedExpense(null);
            setEditingId(null);
          }
        }}
        title={selectedExpense?.category ?? ""}
        sections={
          selectedExpense === null
            ? []
            : [
                {
                  key: "details",
                  label: t("finance.expenses.field.category"),
                  content: renderExpenseDetail(selectedExpense),
                },
              ]
        }
      />
    </div>
  );
}

function ExpenseCard({
  expense,
  supplierNames,
  onEdit,
}: {
  expense: Expense;
  supplierNames: Map<string, string>;
  onEdit: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{expense.category}</span>
          <span className="text-sm font-normal tabular-nums text-muted-foreground">
            {formatMoney(expense.amountMinor, locale)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {t("finance.expenses.field.incurredAt")}
            </dt>
            <dd>{formatDate(expense.incurredAt, locale)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {t("finance.expenses.field.supplier")}
            </dt>
            <dd>
              {expense.supplierId !== null
                ? (supplierNames.get(expense.supplierId) ?? expense.supplierId)
                : DASH}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.expenses.field.notes")}</dt>
            <dd>{expense.notes ?? DASH}</dd>
          </div>
        </dl>
        <PermissionGate permission="finance.manage">
          <div>
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t("finance.actions.edit")}
            </Button>
          </div>
        </PermissionGate>
      </CardContent>
    </Card>
  );
}

function ExpenseForm({
  expense,
  suppliers,
  onSubmit,
  onCancel,
}: {
  expense?: Expense;
  suppliers: readonly Option[];
  onSubmit: (body: ExpenseInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [category, setCategory] = useState(expense?.category ?? "");
  const [amount, setAmount] = useState(
    expense !== undefined ? (expense.amountMinor / 100).toFixed(2) : "",
  );
  const [incurredAt, setIncurredAt] = useState(
    expense !== undefined ? expense.incurredAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [supplierId, setSupplierId] = useState(expense?.supplierId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const editing = expense !== undefined;

  const amountMinor = Math.round(Number(amount) * 100);
  const invalid =
    category.trim().length === 0 ||
    !Number.isFinite(amountMinor) ||
    amountMinor < 1 ||
    incurredAt.length === 0;

  const submit = async (): Promise<void> => {
    const body: ExpenseInput = {
      category: category.trim(),
      amountMinor,
      incurredAt: new Date(incurredAt).toISOString(),
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : editing ? { notes: null } : {}),
      ...(supplierId.length > 0 ? { supplierId } : editing ? { supplierId: null } : {}),
    };
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="expense-category" label={`${t("finance.expenses.field.category")} *`}>
            <Input
              id="expense-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t("finance.expenses.field.category")}
            />
          </Field>
          <Field id="expense-amount" label={`${t("finance.expenses.field.amount")} *`}>
            <Input
              id="expense-amount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t("finance.expenses.field.amount")}
            />
          </Field>
          <Field id="expense-date" label={`${t("finance.expenses.field.incurredAt")} *`}>
            <Input
              id="expense-date"
              type="date"
              value={incurredAt}
              onChange={(e) => setIncurredAt(e.target.value)}
              aria-label={t("finance.expenses.field.incurredAt")}
            />
          </Field>
          <Field id="expense-supplier" label={t("finance.expenses.field.supplier")}>
            <OptionSelect
              id="expense-supplier"
              value={supplierId}
              options={suppliers}
              onChange={setSupplierId}
              ariaLabel={t("finance.expenses.field.supplier")}
            />
          </Field>
          <Field id="expense-notes" label={t("finance.expenses.field.notes")} wide>
            <Input
              id="expense-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-label={t("finance.expenses.field.notes")}
            />
          </Field>
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
