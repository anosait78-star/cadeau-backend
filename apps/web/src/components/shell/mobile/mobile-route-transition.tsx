import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router";
import { cn } from "@/lib/cn";

/**
 * Slides each screen in as it is entered: forward navigations arrive from the
 * inline-end edge, back navigations from the inline-start edge, so movement
 * always matches the direction of travel through the app. Both mirror in RTL —
 * the direction lives in CSS custom properties (see `globals.css`), not here.
 *
 * Keyed on the pathname, so the animation runs on real screen changes and not
 * when a screen updates its own query string (a filter, a page). Motion is
 * removed entirely under `prefers-reduced-motion`.
 */
export function MobileRouteTransition({ children }: { children: ReactNode }): ReactNode {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  // The first render of a session is reported as a POP (the entry was already in
  // history), which would slide the app in backwards on a cold open. There is no
  // previous screen to have come from, so it simply appears.
  const first = useRef(true);
  const isFirstRender = first.current;
  useEffect(() => {
    first.current = false;
  }, []);

  return (
    <div
      key={pathname}
      className={cn(
        !isFirstRender && "route-motion",
        navigationType === "POP" ? "route-back" : "route-forward",
      )}
    >
      {children}
    </div>
  );
}
