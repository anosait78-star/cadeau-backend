import { CalendarDays, Pencil, Plus, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCapabilities } from "@/features/access/use-capabilities";
import { expenseCategoryStyle, tint, tintText } from "@/features/finance/expense-category-style";
import {
  createExpense,
  getExpenseSummary,
  listExpenses,
  newIdempotencyKey,
  updateExpense,
  type Expense,
  type ExpenseInput,
  type ExpenseSummary,
} from "@/features/finance/finance-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { ExpenseCategoryChart, MonthlyExpensesChart } from "./expense-charts";
import { ExpenseDialog } from "./expense-dialog";
import { CurrencyAmount } from "./expense-display";
import { ExpenseStats } from "./expense-stats";
import { buildExpenseColumns } from "./expenses-columns";
import { formatDate, type Option } from "./finance-shared";

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: Expense[]; readonly nextCursor: string | null };

type SummaryState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly summary: ExpenseSummary };

type DialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly expense: Expense };

/** How many years the charts' picker offers, the current one included. */
const YEAR_CHOICES = 5;

/**
 * Expenses (EPIC-13): the picked year's statistics and charts above every
 * expense record, newest first.
 *
 * The cards and charts come from `GET /finance/expenses/summary` for the year
 * in the monthly chart's picker; the list is independent of it. Recording and
 * editing happen in a dialog behind `finance.manage`. There is no search, no
 * filter and no delete — a mistaken entry is corrected by editing it.
 */
export function ExpensesTab({
  suppliers,
  onNotify,
}: {
  suppliers: readonly Option[];
  onNotify: (text: string) => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const { has } = useCapabilities();
  const canManage = has({ permission: "finance.manage" });

  const [currentYear] = useState(() => new Date().getFullYear());
  const years = useMemo(
    () => Array.from({ length: YEAR_CHOICES }, (_, index) => currentYear - index),
    [currentYear],
  );
  const [year, setYear] = useState(currentYear);
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [summary, setSummary] = useState<SummaryState>({ kind: "loading" });
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  // Switching years quickly must not let a slow earlier answer overwrite a later one.
  const summaryRequest = useRef(0);

  const supplierNames = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const loadList = useCallback(async (): Promise<void> => {
    setList({ kind: "loading" });
    try {
      const page = await listExpenses();
      setList({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setList({ kind: "error" });
    }
  }, []);

  const loadSummary = useCallback(async (forYear: number): Promise<void> => {
    const request = ++summaryRequest.current;
    setSummary({ kind: "loading" });
    try {
      const data = await getExpenseSummary(forYear);
      if (request === summaryRequest.current) setSummary({ kind: "ready", summary: data });
    } catch {
      if (request === summaryRequest.current) setSummary({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadSummary(year);
  }, [loadSummary, year]);

  const loadMore = async (): Promise<void> => {
    if (list.kind !== "ready" || list.nextCursor === null) return;
    const page = await listExpenses({ cursor: list.nextCursor });
    setList({
      kind: "ready",
      items: [...list.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const categories = useMemo(() => {
    const names = new Set<string>();
    if (summary.kind === "ready") {
      for (const entry of summary.summary.byCategory) names.add(entry.category);
    }
    if (list.kind === "ready") {
      for (const expense of list.items) names.add(expense.category);
    }
    return [...names];
  }, [summary, list]);

  const openEdit = (expense: Expense): void => setDialog({ kind: "edit", expense });

  const submit = async (body: ExpenseInput): Promise<boolean> => {
    try {
      if (dialog.kind === "edit") {
        await updateExpense(dialog.expense.id, body);
      } else {
        await createExpense(
          {
            category: body.category ?? "",
            amountMinor: body.amountMinor ?? 0,
            incurredAt: body.incurredAt ?? new Date().toISOString(),
            ...(typeof body.notes === "string" ? { notes: body.notes } : {}),
            ...(typeof body.supplierId === "string" ? { supplierId: body.supplierId } : {}),
          },
          newIdempotencyKey(),
        );
      }
      onNotify(t("finance.saved"));
      void loadList();
      void loadSummary(year);
      return true;
    } catch {
      onNotify(t("finance.saveFailed"));
      return false;
    }
  };

  const columns = useMemo(
    () => buildExpenseColumns({ t, locale, supplierNames }),
    [t, locale, supplierNames],
  );

  const editButton = (expense: Expense, className: string): ReactNode => (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={t("finance.expenses.editFor", { category: expense.category })}
      onClick={(event) => {
        event.stopPropagation();
        openEdit(expense);
      }}
    >
      <Pencil className="h-4 w-4" aria-hidden="true" />
    </Button>
  );

  const readySummary = summary.kind === "ready" ? summary.summary : null;

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {summary.kind === "error" ? (
        <ErrorState
          description={t("finance.expenses.statsError")}
          onRetry={() => void loadSummary(year)}
        />
      ) : (
        <>
          <ExpenseStats summary={readySummary} />
          <div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
            <ExpenseCategoryChart className="lg:col-span-2" summary={readySummary} />
            <MonthlyExpensesChart
              className="lg:col-span-3"
              summary={readySummary}
              year={year}
              years={years}
              onYearChange={setYear}
              onRefresh={() => void loadSummary(year)}
            />
          </div>
        </>
      )}

      <section aria-labelledby="expenses-list-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2
            id="expenses-list-heading"
            className="text-base font-semibold text-foreground lg:text-lg"
          >
            {t("finance.expenses.listTitle")}
          </h2>
          {canManage ? (
            <Button
              onClick={() => setDialog({ kind: "create" })}
              className="h-11 w-full sm:h-10 sm:w-auto"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("finance.expenses.add")}
            </Button>
          ) : null}
        </div>

        {list.kind === "error" ? <ErrorState onRetry={() => void loadList()} /> : null}

        {list.kind !== "error" ? (
          isDesktop ? (
            <DataGrid<Expense>
              columns={columns}
              rows={list.kind === "ready" ? list.items : []}
              getRowId={(row) => row.id}
              loading={list.kind === "loading"}
              hasMore={list.kind === "ready" && list.nextCursor !== null}
              onLoadMore={loadMore}
              emptyState={<EmptyState title={t("finance.expenses.empty")} />}
              {...(canManage
                ? {
                    onRowClick: openEdit,
                    rowActions: (row: Expense) => editButton(row, "h-8 w-8"),
                  }
                : {})}
            />
          ) : (
            <MobileCardList<Expense>
              items={list.kind === "ready" ? list.items : []}
              loading={list.kind === "loading"}
              getRowId={(row) => row.id}
              renderCard={(expense) => (
                <ExpenseListCard
                  expense={expense}
                  supplierName={
                    expense.supplierId === null
                      ? null
                      : (supplierNames.get(expense.supplierId) ?? null)
                  }
                  action={canManage ? editButton(expense, "-me-2 -mt-1 h-10 w-10 shrink-0") : null}
                />
              )}
              emptyTitle={t("finance.expenses.empty")}
              hasMore={list.kind === "ready" && list.nextCursor !== null}
              onLoadMore={loadMore}
              loadMoreLabel={t("finance.loadMore")}
            />
          )
        ) : null}
      </section>

      <ExpenseDialog
        open={dialog.kind !== "closed"}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: "closed" });
        }}
        expense={dialog.kind === "edit" ? dialog.expense : null}
        suppliers={suppliers}
        categories={categories}
        onSubmit={submit}
      />
    </div>
  );
}

/** One expense on a phone: category icon, name and amount, then date, supplier and notes. */
function ExpenseListCard({
  expense,
  supplierName,
  action,
}: {
  readonly expense: Expense;
  readonly supplierName: string | null;
  readonly action: ReactNode;
}): ReactNode {
  const { t, locale } = useI18n();
  const { icon: Icon, color } = expenseCategoryStyle(expense.category);

  return (
    <Card className="flex items-start gap-3 p-4">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: tint(color, 14), color: tintText(color) }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-semibold text-foreground">{expense.category}</p>
          <CurrencyAmount
            minor={expense.amountMinor}
            locale={locale}
            unit={t("finance.expenses.currency")}
            className="shrink-0 font-bold text-foreground"
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {formatDate(expense.incurredAt, locale)}
          </span>
          {supplierName !== null ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Store className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{supplierName}</span>
            </span>
          ) : null}
        </div>
        {expense.notes !== null ? (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{expense.notes}</p>
        ) : null}
      </div>
      {action}
    </Card>
  );
}
