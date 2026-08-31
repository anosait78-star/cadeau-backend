import type { ReactNode } from "react";
import { useIsDesktop } from "@/hooks/use-media-query";

/**
 * A screen's title and one-line description.
 *
 * On the Desktop shell this is the page heading, as before. On the Mobile shell
 * it renders **nothing**: there the shell owns the title — as a large title that
 * collapses into the top bar — so a second copy inside the page would duplicate
 * the heading for screen readers and burn a screenful of a phone on chrome
 * (ADR-002: the two shells are designed independently, not reflowed).
 */
export function PageTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}): ReactNode {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return null;

  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description === undefined ? null : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  );
}
