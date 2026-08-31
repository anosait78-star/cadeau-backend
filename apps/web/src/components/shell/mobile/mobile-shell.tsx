import { useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Outlet } from "react-router";
import { useEdgeSwipeBack } from "@/hooks/use-edge-swipe-back";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useScrollCollapse } from "@/hooks/use-scroll-collapse";
import { haptic } from "@/lib/haptics";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileFab } from "./mobile-fab";
import { MobileHeaderProvider, useMobileRefresh } from "./mobile-header-context";
import { MobileLargeTitle, MobilePageHeader } from "./mobile-page-header";
import { MobileMoreSheet } from "./mobile-more-sheet";
import { MobileRefreshIndicator } from "./mobile-refresh-indicator";
import { MobileRouteTransition } from "./mobile-route-transition";
import { useMobileBack } from "./use-mobile-back";
import { useMobileRouteTitle } from "./use-mobile-route-title";

/**
 * Mobile shell (ADR-002): a native-feeling experience — a contextual top bar,
 * scrollable content, a floating action button, and a fixed bottom navigation
 * with a "More" bottom sheet. An independent tree from the Desktop shell, not a
 * reflow of it.
 *
 * Chrome geometry — bar heights and the device safe areas (notch, home
 * indicator) — lives in the `.mobile-header` / `.mobile-main` / `.mobile-nav`
 * classes in `globals.css`, so no component hardcodes a bar height.
 *
 * Navigation hierarchy: a root destination renders a large title that collapses
 * into the bar as it scrolls away; a deeper screen renders a back control, and
 * can also be dismissed by swiping from the leading edge. Screens contribute
 * their create action and their reload through {@link MobileHeaderProvider},
 * which the FAB and pull-to-refresh render.
 */
export function MobileShell(): ReactNode {
  return (
    <MobileHeaderProvider>
      <MobileShellFrame />
    </MobileHeaderProvider>
  );
}

/** Inside the provider, so the frame can read what the current screen registered. */
function MobileShellFrame(): ReactNode {
  const [moreOpen, setMoreOpen] = useState(false);
  const { title, isRoot } = useMobileRouteTitle();
  const { sentinelRef, collapsed } = useScrollCollapse();
  const goBack = useMobileBack();

  const swipe = useEdgeSwipeBack({
    // A root destination has nowhere to go back to, so the gesture is inert
    // there rather than moving a screen it cannot leave.
    enabled: !isRoot,
    onBack: () => {
      haptic("impact");
      goBack();
    },
  });

  const screenRefresh = useMobileRefresh();
  const pull = usePullToRefresh(async () => {
    haptic("impact");
    await screenRefresh?.();
  });

  // Both gestures observe the same pointer stream and each decides for itself
  // whether it applies (edge + horizontal vs. top-of-page + downward).
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    swipe.handlers.onPointerDown(event);
    if (screenRefresh !== null) pull.handlers.onPointerDown(event);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    swipe.handlers.onPointerMove(event);
    if (screenRefresh !== null) pull.handlers.onPointerMove(event);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    swipe.handlers.onPointerUp(event);
    pull.handlers.onPointerUp();
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLElement>): void => {
    swipe.handlers.onPointerCancel(event);
    pull.handlers.onPointerCancel();
  };

  return (
    <div className="flex min-h-full flex-col">
      <MobilePageHeader title={title} isRoot={isRoot} collapsed={collapsed} />

      <main
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        data-dragging={swipe.dragging}
        // The transform is applied only while a gesture is live or settling: a
        // transform makes this element a containing block for `position: fixed`
        // descendants, which must not be true at rest.
        style={
          swipe.active ? ({ "--swipe-travel": `${swipe.travel}px` } as CSSProperties) : undefined
        }
        className={
          swipe.active ? "relative mobile-main swipe-follow flex-1" : "relative mobile-main flex-1"
        }
      >
        <MobileRefreshIndicator
          distance={pull.distance}
          armed={pull.armed}
          refreshing={pull.refreshing}
        />
        {isRoot ? <MobileLargeTitle title={title} sentinelRef={sentinelRef} /> : null}
        <MobileRouteTransition>
          <Outlet />
        </MobileRouteTransition>
      </main>

      <MobileFab />
      <MobileBottomNav onMore={() => setMoreOpen(true)} />
      <MobileMoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </div>
  );
}
