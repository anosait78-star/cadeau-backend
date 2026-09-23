import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/use-auth";
import { PageTitle } from "@/components/layout/page-title";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { getOwnThread, type MessageThread } from "@/features/messaging/messaging-api";
import { ThreadView } from "@/features/messaging/thread-view";
import { ThreadViewFrame } from "@/features/messaging/thread-view-frame";
import { useI18n } from "@/i18n/i18n-provider";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly thread: MessageThread };

/**
 * The vendor's own conversation with the company's staff (Vendor Accounts,
 * EPIC-17 M17.6) — one tab that opens straight onto `GET /threads/me`, no
 * thread list or picker, because a vendor never has more than one
 * conversation. `GET /threads/me` is the isolation boundary here, the same
 * as every other vendor screen (`use-my-vendor-groups.ts`): it always
 * resolves to the caller's own warehouse server-side, so there is nothing
 * for this screen to filter or hide — a thread for another vendor simply
 * cannot come back from this call.
 */
export function VendorMessagesPage(): ReactNode {
  const { t } = useI18n();
  const { user } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const thread = await getOwnThread();
      setState({ kind: "ready", thread });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageTitle title={t("vendor.messages.title")} description={t("vendor.messages.subtitle")} />

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind === "ready" ? (
        <ThreadViewFrame>
          <ThreadView
            threadId={state.thread.id}
            status={state.thread.status}
            currentUserId={user?.id ?? null}
          />
        </ThreadViewFrame>
      ) : null}
    </div>
  );
}
