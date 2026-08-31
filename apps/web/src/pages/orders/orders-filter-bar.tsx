import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { Translate } from "@/components/i18n/translate-type";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DatePicker } from "@/components/ui/date-picker";
import { ORDER_STATUSES, type OrderStatus, type PaymentStatus } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Horizontal filter bar for the Orders list, sitting directly above the
 * table (no more sidebar). Search / status / date stay always visible;
 * everything else (currently just payment status — the API has no
 * "assigned employee" filter param yet, so that one isn't offered) lives
 * behind the "Advanced filters" popover. Every field applies immediately —
 * there's no separate Apply step, only a single Reset.
 */
export function OrdersFilterBar({
  search,
  onSearchChange,
  status,
  onStatusChange,
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
  status: OrderStatus | "all";
  onStatusChange: (value: OrderStatus | "all") => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  paymentStatus: PaymentStatus | "all";
  onPaymentStatusChange: (value: PaymentStatus | "all") => void;
  onReset: () => void;
  t: Translate;
}): ReactNode {
  const advancedActiveCount = paymentStatus === "all" ? 0 : 1;
  const anyActive =
    search.trim().length > 0 ||
    status !== "all" ||
    dateFrom.length > 0 ||
    dateTo.length > 0 ||
    advancedActiveCount > 0;

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

      <div className="flex w-40 flex-col gap-1">
        <Label htmlFor="orders-filter-status" className="sr-only">
          {t("orders.status.title")}
        </Label>
        <select
          id="orders-filter-status"
          value={status}
          onChange={(e) => onStatusChange(e.target.value as OrderStatus | "all")}
          className={SELECT_CLASS}
        >
          <option value="all">{t("orders.filters.allStatuses")}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`orders.status.${s}` as TranslationKey)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex w-36 flex-col gap-1">
        <Label htmlFor="orders-filter-from" className="sr-only">
          {t("orders.filters.dateFrom")}
        </Label>
        <DatePicker
          id="orders-filter-from"
          value={dateFrom.length > 0 ? dateFrom : null}
          onChange={(next) => onDateFromChange(next ?? "")}
          ariaLabel={t("orders.filters.dateFrom")}
        />
      </div>

      <div className="flex w-36 flex-col gap-1">
        <Label htmlFor="orders-filter-to" className="sr-only">
          {t("orders.filters.dateTo")}
        </Label>
        <DatePicker
          id="orders-filter-to"
          value={dateTo.length > 0 ? dateTo : null}
          onChange={(next) => onDateToChange(next ?? "")}
          ariaLabel={t("orders.filters.dateTo")}
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {advancedActiveCount > 0
              ? `${t("orders.filters.count")} (${advancedActiveCount})`
              : t("orders.filters.advanced")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 max-w-none p-4">
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
        </PopoverContent>
      </Popover>

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
