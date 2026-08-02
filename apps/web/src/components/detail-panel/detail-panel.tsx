import type { ReactNode } from "react";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { SideSheet } from "@/components/ui/side-sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
}

/**
 * Generic right-side detail panel: a SideSheet with tabbed sections. Content
 * per section is fully owned by the consumer (e.g. `orders-detail-sections.tsx`)
 * — this shell has no knowledge of what it is displaying details for.
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
}: DetailPanelProps): ReactNode {
  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(closeLabel !== undefined ? { closeLabel } : {})}
      widthClassName="max-w-xl"
    >
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState {...(onRetry !== undefined ? { onRetry } : {})} />
      ) : sections.length === 0 ? null : sections.length === 1 ? (
        // A single section has nothing to switch between — skip the tab
        // chrome entirely instead of showing a redundant one-item tab strip.
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">{sections[0]?.content}</div>
      ) : (
        <Tabs
          {...(sections[0] !== undefined ? { defaultValue: sections[0].key } : {})}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList>
            {sections.map((section) => (
              <TabsTrigger key={section.key} value={section.key}>
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {sections.map((section) => (
            <TabsContent key={section.key} value={section.key}>
              {section.content}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </SideSheet>
  );
}
