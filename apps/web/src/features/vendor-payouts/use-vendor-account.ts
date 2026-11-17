import { useCallback, useEffect, useState } from "react";
import type { LedgerEntry, Page, VendorBalance, VendorPayout } from "./vendor-payouts-api";

/** Where to load one vendor account from — the vendor's own routes or the company's. */
export interface VendorAccountSource {
  readonly balance: () => Promise<VendorBalance>;
  readonly ledger: (cursor?: string) => Promise<Page<LedgerEntry>>;
  readonly payouts: () => Promise<Page<VendorPayout>>;
}

export type VendorAccountState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly balance: VendorBalance;
      readonly entries: LedgerEntry[];
      readonly nextCursor: string | null;
      readonly payouts: VendorPayout[];
    };

/**
 * One vendor account: balance, the first page of the statement, and recent
 * payouts, loaded together; `loadMore` appends the next statement page.
 * Shared by the vendor's own page and the company's per-vendor page — only
 * the {@link VendorAccountSource} differs, so the two can never disagree on
 * how an account is read.
 */
export function useVendorAccount(source: VendorAccountSource): {
  readonly state: VendorAccountState;
  readonly reload: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
  readonly loadingMore: boolean;
} {
  const [state, setState] = useState<VendorAccountState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const { balance, ledger, payouts } = source;

  const reload = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const [b, l, p] = await Promise.all([balance(), ledger(), payouts()]);
      setState({
        kind: "ready",
        balance: b,
        entries: l.data,
        nextCursor: l.page.nextCursor,
        payouts: p.data,
      });
    } catch {
      setState({ kind: "error" });
    }
  }, [balance, ledger, payouts]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    setLoadingMore(true);
    try {
      const next = await ledger(state.nextCursor);
      setState({
        ...state,
        entries: [...state.entries, ...next.data],
        nextCursor: next.page.nextCursor,
      });
    } finally {
      setLoadingMore(false);
    }
  }, [ledger, state]);

  return { state, reload, loadMore, loadingMore };
}
