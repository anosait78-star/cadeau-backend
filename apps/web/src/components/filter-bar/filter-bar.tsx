import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

export interface FilterBarProps {
  /** One control per active filter (a `<Select>`, date range, toggle, ...) — supplied by the page. */
  readonly children: ReactNode;
  /** Count of currently-active (non-default) filters, shown as a chip. */
  readonly activeCount: number;
  readonly onClearAll?: () => void;
  /** Required whenever {@link onClearAll} is given; unused without it. */
  readonly clearAllLabel?: string;
  /**
   * Buttons that act on the screen rather than filter it (New, Adjust,
   * Transfer, ...). They stay in the bar on every viewport — on mobile the
   * filters move into a sheet, and an action buried in a filter sheet would be
   * an action nobody finds.
   */
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * Generic filter-row shell: lays out whatever filter controls a page passes
 * in, plus an active-filter-count chip and a "clear all" action. Carries no
 * filter definitions itself — those are entirely page-specific.
 *
 * On Desktop the controls sit inline, where a wide screen has room for them.
 * Below that breakpoint they collapse behind a single button that opens a
 * **bottom sheet** (ADR-002): a phone cannot afford several rows of controls
 * standing permanently between the user and their data, and a sheet reaches the
 * bottom edge where the thumb already is. The button carries the active count,
 * so a filter applied from inside the sheet is never invisible once it closes.
 */
export function FilterBar({
  children,
  activeCount,
  onClearAll,
  clearAllLabel,
  actions,
  className,
}: FilterBarProps): ReactNode {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);

  const countChip =
    activeCount > 0 ? (
      <div className="flex items-center gap-2">
        <span
          className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
          data-testid="filter-bar-active-count"
        >
          {activeCount}
        </span>
        {onClearAll !== undefined && clearAllLabel !== undefined ? (
          <Button variant="ghost" size="sm" onClick={onClearAll}>
            {clearAllLabel}
          </Button>
        ) : null}
      </div>
    ) : null;

  if (isDesktop) {
    return (
      <div className={cn("flex flex-wrap items-end gap-3", className)}>
        {children}
        {actions}
        {countChip}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button variant="outline" onClick={() => setSheetOpen(true)}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {activeCount > 0 ? `${t("filters.title")} (${activeCount})` : t("filters.title")}
      </Button>
      {actions}
      {countChip}

      <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title={t("filters.title")}>
        <div className="flex flex-col gap-4">{children}</div>
      </BottomSheet>
    </div>
  );
}
