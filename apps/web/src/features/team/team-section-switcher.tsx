import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

/** One section the Team page can show. */
export interface TeamSectionOption {
  readonly value: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  /** A short counts line ("8 roles") — `null` while its data is still loading. */
  readonly meta: string | null;
}

/**
 * The Team page's section picker: two cards, the open one outlined in the brand
 * color with a filled icon. They are real tabs (Radix, via the shared `Tabs`
 * primitives) — arrow keys move between them and the panel below is labelled
 * by the active card — only dressed as cards.
 *
 * Desktop gets roomy cards — icon beside title, description and counts. On a
 * phone the same two cards sit side by side with the icon above the text, and
 * the title and counts wrap instead of truncating: half a 375px screen cannot
 * fit "الأدوار والصلاحيات" on one line, and a clipped count says nothing.
 */
export function TeamSectionSwitcher({
  label,
  options,
}: {
  readonly label: string;
  readonly options: readonly TeamSectionOption[];
}): ReactNode {
  return (
    <TabsList
      aria-label={label}
      className="grid grid-cols-2 gap-2 overflow-visible border-0 lg:gap-4"
    >
      {options.map(({ value, icon: Icon, title, description, meta }) => (
        <TabsTrigger
          key={value}
          value={value}
          className={cn(
            "group relative flex min-w-0 shrink flex-col items-start gap-2 overflow-hidden rounded-xl border border-border bg-card p-3 text-start text-foreground shadow-sm",
            "transition-[border-color,box-shadow,background-color] hover:border-primary/40",
            "data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:text-foreground data-[state=active]:shadow-md",
            "lg:flex-row lg:items-center lg:gap-4 lg:p-5",
          )}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1 bg-primary opacity-0 transition-opacity group-data-[state=active]:opacity-100"
          />
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground lg:h-12 lg:w-12 lg:rounded-xl"
          >
            <Icon className="h-4 w-4 lg:h-6 lg:w-6" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-semibold leading-snug lg:truncate lg:text-base">
              {title}
            </span>
            <span className="hidden truncate text-sm text-muted-foreground lg:block">
              {description}
            </span>
            <span className="text-xs leading-snug text-muted-foreground lg:mt-1 lg:truncate">
              {meta ?? "…"}
            </span>
          </span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
