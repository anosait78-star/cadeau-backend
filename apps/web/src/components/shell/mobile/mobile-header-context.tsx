import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The primary create action of the screen currently on display — what the FAB
 * does. Native apps bind the floating button to *creation*, not search, and the
 * action belongs to the screen, so screens register it here and the shell
 * renders it.
 */
export interface MobilePrimaryAction {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onAction: () => void;
}

interface MobileHeaderContextValue {
  readonly primaryAction: MobilePrimaryAction | null;
  readonly setPrimaryAction: (action: MobilePrimaryAction | null) => void;
  /** How the current screen reloads itself, for pull-to-refresh; `null` if it cannot. */
  readonly refresh: (() => void | Promise<void>) | null;
  readonly setRefresh: (refresh: (() => void | Promise<void>) | null) => void;
}

const MobileHeaderContext = createContext<MobileHeaderContextValue | undefined>(undefined);

/** Holds what the current screen contributes to the mobile chrome. */
export function MobileHeaderProvider({ children }: { children: ReactNode }): ReactNode {
  const [primaryAction, setPrimaryAction] = useState<MobilePrimaryAction | null>(null);
  const [refresh, setRefreshState] = useState<(() => void | Promise<void>) | null>(null);

  // A function in state must be set through an updater, or React would call it
  // as a reducer instead of storing it.
  const setRefresh = useCallback((next: (() => void | Promise<void>) | null) => {
    setRefreshState(() => next);
  }, []);

  const value = useMemo<MobileHeaderContextValue>(
    () => ({ primaryAction, setPrimaryAction, refresh, setRefresh }),
    [primaryAction, refresh, setRefresh],
  );
  return <MobileHeaderContext value={value}>{children}</MobileHeaderContext>;
}

/** The action the shell should render in the FAB, or `null` for none. */
export function useMobilePrimaryAction(): MobilePrimaryAction | null {
  return useContext(MobileHeaderContext)?.primaryAction ?? null;
}

/** How the shell should reload the current screen, or `null` if it cannot. */
export function useMobileRefresh(): (() => void | Promise<void>) | null {
  return useContext(MobileHeaderContext)?.refresh ?? null;
}

/**
 * Register this screen's primary create action with the mobile shell, which
 * renders it as the FAB while the screen is mounted and drops it on unmount.
 * Pass `enabled: false` to register nothing (e.g. the caller lacks the
 * permission to create) — the FAB then simply does not appear.
 *
 * `onAction` is read through a ref, so an inline callback does not re-register
 * on every render; only `label`, `icon` and `enabled` drive the registration.
 * On the Desktop shell there is no provider and this is a no-op.
 */
export function useRegisterMobilePrimaryAction(action: {
  label: string;
  icon: LucideIcon;
  onAction: () => void;
  enabled?: boolean;
}): void {
  const context = useContext(MobileHeaderContext);
  const { label, icon, enabled = true } = action;
  const onActionRef = useRef(action.onAction);
  onActionRef.current = action.onAction;

  const setPrimaryAction = context?.setPrimaryAction;
  useEffect(() => {
    if (setPrimaryAction === undefined) return;
    if (!enabled) {
      setPrimaryAction(null);
      return;
    }
    setPrimaryAction({ label, icon, onAction: () => onActionRef.current() });
    return () => setPrimaryAction(null);
  }, [setPrimaryAction, label, icon, enabled]);
}

/**
 * Register how this screen reloads itself, which is what pull-to-refresh runs.
 * Read through a ref like the create action, so passing the screen's own `load`
 * callback inline is safe. A no-op on the Desktop shell.
 */
export function useRegisterMobileRefresh(onRefresh: () => void | Promise<void>): void {
  const context = useContext(MobileHeaderContext);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const setRefresh = context?.setRefresh;
  useEffect(() => {
    if (setRefresh === undefined) return;
    setRefresh(() => onRefreshRef.current());
    return () => setRefresh(null);
  }, [setRefresh]);
}
