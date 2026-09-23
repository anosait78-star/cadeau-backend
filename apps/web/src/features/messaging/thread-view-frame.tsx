import type { CSSProperties, ReactNode } from "react";

/**
 * Bounds a full-page {@link ThreadView} (as opposed to the staff panel's
 * `SideSheet`, which is already viewport-fixed) so its internal scroll region
 * works on both shells.
 *
 * The Desktop shell's `<main>` sits in a genuine `h-full` flex chain, so
 * `lg:flex-1 lg:min-h-0` — the page root passes it the remaining column
 * height after its own title — is all a chat box needs there. The Mobile
 * shell is the opposite:
 * per `globals.css`'s own comment, it is "a fixed header + **scrolling
 * document** + fixed bottom nav" — there is no bounded-height content region
 * to hand a `flex-1 overflow-y-auto` list, only the window itself scrolling.
 * Below `lg:` this is therefore `position: fixed`, pinned between the same
 * `--mobile-header-total`/`--mobile-nav-total` custom properties
 * `.mobile-header`/`.mobile-nav` use, so the chat's own message list — not
 * the document — is what scrolls, exactly like every other screen's content
 * area, just carved out of the fixed layer instead of the flowing one.
 */
export function ThreadViewFrame({ children }: { children: ReactNode }): ReactNode {
  const style: CSSProperties = {
    top: "var(--mobile-header-total)",
    bottom: "var(--mobile-nav-total)",
  };
  return (
    <div
      style={style}
      className="fixed inset-x-0 flex flex-col overflow-hidden border-border bg-card lg:static lg:inset-auto lg:min-h-0 lg:flex-1 lg:rounded-lg lg:border"
    >
      {children}
    </div>
  );
}
