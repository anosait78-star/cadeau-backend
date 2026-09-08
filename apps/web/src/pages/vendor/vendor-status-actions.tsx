import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { forwardVendorStatuses, type VendorGroupStatus } from "@/features/vendor/vendor-api";
import type { TranslationKey } from "@/i18n/dictionaries";

/**
 * The vendor's status control: a primary button for the next step, plus a menu
 * for the states further ahead (a vendor may skip any distance forward).
 *
 * This is also the keyboard and screen-reader path for everything the orders
 * board's drag-and-drop can do — dragging is an accelerator, never the only
 * way to move an order.
 */
export function VendorStatusActions({
  status,
  disabled = false,
  onMove,
  t,
}: {
  readonly status: VendorGroupStatus;
  readonly disabled?: boolean;
  readonly onMove: (to: VendorGroupStatus) => void;
  readonly t: (key: TranslationKey) => string;
}): ReactNode {
  const [next, ...rest] = forwardVendorStatuses(status);
  if (next === undefined) return null;

  const label = (to: VendorGroupStatus): string =>
    t(`vendor.dashboard.advanceTo.${to}` as TranslationKey);

  return (
    <div className="flex items-center gap-2">
      <Button disabled={disabled} onClick={() => onMove(next)}>
        {label(next)}
      </Button>
      {rest.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label={t("vendor.status.more")}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {rest.map((to) => (
              <DropdownMenuItem key={to} onSelect={() => onMove(to)}>
                {label(to)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
