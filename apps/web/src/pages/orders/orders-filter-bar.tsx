import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Translate } from "@/components/i18n/translate-type";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BottomSheet } from "@/components/ui/sheet";
import { DatePicker } from "@/components/ui/date-picker";
import type { OrderStatus, PaymentStatus } from "@/features/orders/orders-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface AdvancedFilterProps {
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  paymentStatus: PaymentStatus | "all";
  onPaymentStatusChange: (value: PaymentStatus | "all") => void;
  t: Translate;
}

/** The fields themselves, so the two shells present the same set of filters. */
function AdvancedFilterFields({
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  paymentStatus,
  onPaymentStatusChange,
  t,
}: AdvancedFilterProps): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="orders-filter-from">{t("orders.filters.dateFrom")}</Label>
        <DatePicker
          id="orders-filter-from"
          value={dateFrom.length > 0 ? dateFrom : null}
          onChange={(next) => onDateFromChange(next ?? "")}
          ariaLabel={t("orders.filters.dateFrom")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="orders-filter-to">{t("orders.filters.dateTo")}</Label>
        <DatePicker
          id="orders-filter-to"
          value={dateTo.length > 0 ? dateTo : null}
          onChange={(next) => onDateToChange(next ?? "")}
          ariaLabel={t("orders.filters.dateTo")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="orders-filter-payment">{t("orders.field.payment")}</Label>
        <select
          id="orders-filter-payment"
          value={paymentStatus}
          onChange={(e) => onPaymentStatusChange(e.target.value as PaymentStatus | "all")}
          className={SELECT_CLASS}
        >
          <option value="all">{t("orders.filters.allPayments")}</option>
          <option value="paid">{t("orders.payment.paid")}</option>
          <option value="partial">{t("orders.payment.partial")}</option>
          <option value="unpaid">{t("orders.payment.unpaid")}</option>
        </select>
      </div>
    </div>
  );
}

/**
 * Horizontal filter bar for the Orders list, sitting directly above the
 * table (no more sidebar). Only **search** stays permanently on show; the date
 * range and payment status live behind the "Advanced filters" control, whose
 * trigger carries a count so a filter applied from in there is never invisible.
 * (The API has no "assigned employee" filter param yet, so that one isn't
 * offered.) Every field applies immediately — there's no separate Apply step,
 * only a single Reset.
 *
 * That control opens as a **popover on Desktop and a bottom sheet on Mobile**
 * (ADR-002): a popover anchored to a button is a pointer idiom — on a phone it
 * lands wherever the button happens to be, at a size the screen dictates, while
 * a sheet comes from the bottom edge within thumb reach and dismisses by drag.
 *
 * Status is **not** a field here: the status tab strip above the list already
 * owns it, and offering a second control for the same state left two widgets
 * to keep in sync and the user guessing which one was in charge. The bar still
 * reads `status` so Reset knows whether anything is filtered.
 */
export function OrdersFilterBar({
  search,
  onSearchChange,
  status,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  paymentStatus,
  onPaymentStatusChange,
  onReset,
  t,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  /** Read-only here — the status tab strip owns it; used only to enable Reset. */
  status: OrderStatus | "all";
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  paymentStatus: PaymentStatus | "all";
  onPaymentStatusChange: (value: PaymentStatus | "all") => void;
  onReset: () => void;
  t: Translate;
}): ReactNode {
  const isDesktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Everything inside the popover counts toward the badge on its trigger: once
  // a filter is hidden behind a button, the badge is the only thing telling the
  // user their list is filtered at all.
  const advancedActiveCount =
    (dateFrom.length > 0 ? 1 : 0) + (dateTo.length > 0 ? 1 : 0) + (paymentStatus === "all" ? 0 : 1);
  const anyActive = search.trim().length > 0 || status !== "all" || advancedActiveCount > 0;

  const fields: AdvancedFilterProps = {
    dateFrom,
    onDateFromChange,
    dateTo,
    onDateToChange,
    paymentStatus,
    onPaymentStatusChange,
    t,
  };

  const advancedLabel =
    advancedActiveCount > 0
      ? `${t("orders.filters.count")} (${advancedActiveCount})`
      : t("orders.filters.advanced");

  const advancedTriggerContent = (
    <>
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      {advancedLabel}
    </>
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-3 shadow-xs">
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <Label htmlFor="orders-filter-search" className="sr-only">
          {t("orders.search.label")}
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="orders-filter-search"
            type="search"
            enterKeyHint="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("orders.search.placeholder")}
            className="ps-9"
          />
        </div>
      </div>

      {isDesktop ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">{advancedTriggerContent}</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 max-w-none p-4">
            <AdvancedFilterFields {...fields} />
          </PopoverContent>
        </Popover>
      ) : (
        <>
          <Button variant="outline" onClick={() => setSheetOpen(true)}>
            {advancedTriggerContent}
          </Button>
          <BottomSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={t("orders.filters.advanced")}
          >
            <AdvancedFilterFields {...fields} />
          </BottomSheet>
        </>
      )}

      <Button
        variant="ghost"
        onClick={onReset}
        disabled={!anyActive}
        className={cn(!anyActive && "opacity-50")}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {t("orders.filters.reset")}
      </Button>
    </div>
  );
}
