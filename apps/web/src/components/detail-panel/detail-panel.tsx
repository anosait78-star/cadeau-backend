import type { ReactNode } from "react";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { SideSheet } from "@/components/ui/side-sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

export interface DetailPanelSection {
  readonly key: string;
  readonly label: string;
  readonly content: ReactNode;
}

export interface DetailPanelProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly sections: DetailPanelSection[];
  readonly loading?: boolean;
  readonly error?: boolean;
  readonly onRetry?: () => void;
  readonly closeLabel?: string;
  /** Chip beside the title (e.g. the record's status badge). */
  readonly titleBadge?: ReactNode;
  /** Quiet context line under the title (e.g. customer · date). */
  readonly subtitle?: ReactNode;
  /** Pinned block under the title row — the record's headline figure. */
  readonly headerExtra?: ReactNode;
}

/**
 * Generic right-side detail panel: a SideSheet with tabbed sections. Content
 * per section is fully owned by the consumer (e.g. `orders-detail-sections.tsx`)
 * — this shell has no knowledge of what it is displaying details for.
 *
 * Header and tab strip stay pinned; only the active section's content scrolls.
 */
export function DetailPanel({
  open,
  onOpenChange,
  title,
  sections,
  loading = false,
  error = false,
  onRetry,
  closeLabel,
  titleBadge,
  subtitle,
  headerExtra,
}: DetailPanelProps): ReactNode {
  // Header decoration describes a loaded record; while loading or failed there
  // is nothing to decorate, so the header falls back to the bare title.
  const settled = !loading && !error;

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(closeLabel !== undefined ? { closeLabel } : {})}
      {...(settled && titleBadge !== undefined ? { titleBadge } : {})}
      {...(settled && subtitle !== undefined ? { subtitle } : {})}
      {...(settled && headerExtra !== undefined ? { headerExtra } : {})}
      widthClassName="max-w-xl lg:max-w-2xl"
    >
      {loading ? (
        <div className="flex-1 overflow-auto px-5 py-6 sm:px-6">
          <LoadingState />
        </div>
      ) : error ? (
        <div className="flex-1 overflow-auto px-5 py-6 sm:px-6">
          <ErrorState {...(onRetry !== undefined ? { onRetry } : {})} />
        </div>
      ) : sections.length === 0 ? null : sections.length === 1 ? (
        // A single section has nothing to switch between — skip the tab
        // chrome entirely instead of showing a redundant one-item tab strip.
        <div className="flex min-h-0 flex-1 flex-col overflow-auto px-5 py-5 sm:px-6">
          {sections[0]?.content}
        </div>
      ) : (
        <Tabs
          {...(sections[0] !== undefined ? { defaultValue: sections[0].key } : {})}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="relative shrink-0">
            <TabsList className="hide-scrollbar gap-0.5 px-3 sm:px-4">
              {sections.map((section) => (
                <TabsTrigger
                  key={section.key}
                  value={section.key}
                  className={cn(
                    "rounded-t-lg px-3.5 py-3 text-[0.8125rem] font-medium tracking-tight",
                    "hover:bg-muted/70 hover:text-foreground",
                    "data-[state=active]:font-semibold",
                  )}
                >
                  {section.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <span className="tabs-edge-fade" aria-hidden />
          </div>
          {sections.map((section) => (
            <TabsContent
              key={section.key}
              value={section.key}
              className="min-h-0 px-5 py-5 sm:px-6"
            >
              {section.content}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </SideSheet>
  );
}
