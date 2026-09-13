import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { Expense, ExpenseInput } from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { Field, OptionSelect, type Option } from "./finance-shared";

/**
 * Record a new expense, or edit one, in a dialog — it replaces the form that
 * used to open above the list. There is deliberately no delete: a mistaken
 * entry is corrected by editing it (the API has no delete route).
 */
export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  suppliers,
  categories,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The expense being edited, or `null` to record a new one. */
  readonly expense: Expense | null;
  readonly suppliers: readonly Option[];
  /** Categories already in use, suggested so the same one is typed the same way. */
  readonly categories: readonly string[];
  /** Resolves `true` once saved (the dialog closes) or `false` to keep it open. */
  readonly onSubmit: (body: ExpenseInput) => Promise<boolean>;
}): ReactNode {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={expense === null ? t("finance.expenses.addTitle") : t("finance.expenses.editTitle")}
      closeLabel={t("finance.actions.close")}
      size="md"
    >
      {open ? (
        <ExpenseDialogForm
          // Remount per expense so the fields start from that expense's values.
          key={expense?.id ?? "new"}
          expense={expense}
          suppliers={suppliers}
          categories={categories}
          onSubmit={onSubmit}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Modal>
  );
}

function ExpenseDialogForm({
  expense,
  suppliers,
  categories,
  onSubmit,
  onDone,
}: {
  readonly expense: Expense | null;
  readonly suppliers: readonly Option[];
  readonly categories: readonly string[];
  readonly onSubmit: (body: ExpenseInput) => Promise<boolean>;
  readonly onDone: () => void;
}): ReactNode {
  const { t } = useI18n();
  const editing = expense !== null;
  const [category, setCategory] = useState(expense?.category ?? "");
  const [amount, setAmount] = useState(editing ? (expense.amountMinor / 100).toFixed(2) : "");
  const [incurredAt, setIncurredAt] = useState(
    editing ? expense.incurredAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [supplierId, setSupplierId] = useState(expense?.supplierId ?? "");
  const [submitting, setSubmitting] = useState(false);

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
      // Editing sends an explicit null to clear a field; creating just omits it.
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : editing ? { notes: null } : {}),
      ...(supplierId.length > 0 ? { supplierId } : editing ? { supplierId: null } : {}),
    };
    setSubmitting(true);
    const saved = await onSubmit(body);
    setSubmitting(false);
    if (saved) onDone();
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        <div className="form-gap grid grid-cols-1 sm:grid-cols-2">
          <Field id="expense-category" label={t("finance.expenses.field.category")} required>
            <Input
              id="expense-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              list="expense-category-options"
              autoComplete="off"
              aria-label={t("finance.expenses.field.category")}
            />
            <datalist id="expense-category-options">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field id="expense-amount" label={t("finance.expenses.field.amount")} required>
            <Input
              id="expense-amount"
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label={t("finance.expenses.field.amount")}
            />
          </Field>
          <Field id="expense-date" label={t("finance.expenses.field.incurredAt")} required>
            <DatePicker
              id="expense-date"
              value={incurredAt.length > 0 ? incurredAt : null}
              onChange={(value) => setIncurredAt(value ?? "")}
              ariaLabel={t("finance.expenses.field.incurredAt")}
            />
          </Field>
          <Field id="expense-supplier" label={t("finance.expenses.field.supplier")} optional>
            <OptionSelect
              id="expense-supplier"
              value={supplierId}
              options={suppliers}
              onChange={setSupplierId}
              ariaLabel={t("finance.expenses.field.supplier")}
            />
          </Field>
          <Field id="expense-notes" label={t("finance.expenses.field.notes")} optional wide>
            <Input
              id="expense-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-label={t("finance.expenses.field.notes")}
            />
          </Field>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
        <Button
          variant="outline"
          disabled={submitting}
          onClick={onDone}
          className="h-11 flex-1 sm:h-9 sm:flex-none"
        >
          {t("finance.actions.cancel")}
        </Button>
        <Button
          disabled={submitting || invalid}
          onClick={() => void submit()}
          className="h-11 flex-1 sm:h-9 sm:flex-none"
        >
          {t("finance.actions.save")}
        </Button>
      </div>
    </>
  );
}
