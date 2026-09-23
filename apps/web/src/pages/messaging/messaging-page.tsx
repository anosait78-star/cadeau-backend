import { Plus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/use-auth";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { PageTitle } from "@/components/layout/page-title";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { SideSheet } from "@/components/ui/side-sheet";
import { Spinner } from "@/components/ui/spinner";
import { listVendors, openThread, type VendorWarehouse } from "@/features/messaging/messaging-api";
import { ThreadListRow } from "@/features/messaging/thread-list-row";
import { ThreadView } from "@/features/messaging/thread-view";
import { useThreadList } from "@/features/messaging/use-thread-list";
import { useI18n } from "@/i18n/i18n-provider";

export function MessagingPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="messaging"
      fallback={
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          <EmptyState title={t("messaging.forbidden")} />
        </div>
      }
    >
      <MessagingScreen />
    </FeatureGate>
  );
}

/**
 * Staff side of vendor messaging (EPIC-17 M17.6): every conversation in the
 * company, opened into a shared `ThreadView` panel. Starting a new
 * conversation (the vendor picker + `POST /threads`) is `messaging.manage`
 * only — the same split `messaging.controller.ts` enforces, re-checked here
 * only so the button doesn't invite a click that the API would then refuse.
 */
function MessagingScreen(): ReactNode {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const { state, reload, loadMore, patchThread } = useThreadList();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [vendors, setVendors] = useState<readonly VendorWarehouse[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [chosenWarehouseId, setChosenWarehouseId] = useState("");
  const [opening, setOpening] = useState(false);

  const selectedThread =
    state.kind === "ready"
      ? (state.threads.find((thread) => thread.id === selectedId) ?? null)
      : null;

  const openPicker = async (): Promise<void> => {
    setPicking(true);
    setVendorsLoading(true);
    try {
      const { data } = await listVendors();
      setVendors(data);
    } catch {
      toast.show(t("messaging.picker.loadFailed"), { variant: "error" });
    } finally {
      setVendorsLoading(false);
    }
  };

  const startConversation = async (): Promise<void> => {
    if (chosenWarehouseId === "") return;
    setOpening(true);
    try {
      const thread = await openThread(chosenWarehouseId);
      setPicking(false);
      setChosenWarehouseId("");
      setSelectedId(thread.id);
      reload();
    } catch {
      toast.show(t("messaging.picker.openFailed"), { variant: "error" });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={t("messaging.title")} description={t("messaging.subtitle")} />
        <PermissionGate permission="messaging.manage">
          <Button onClick={() => void openPicker()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("messaging.actions.new")}
          </Button>
        </PermissionGate>
      </header>

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={reload} /> : null}
      {state.kind === "ready" && state.threads.length === 0 ? (
        <EmptyState
          title={t("messaging.empty.title")}
          description={t("messaging.empty.description")}
        />
      ) : null}

      {state.kind === "ready" && state.threads.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {state.threads.map((thread) => (
              <ThreadListRow
                key={thread.id}
                thread={thread}
                onPress={() => setSelectedId(thread.id)}
              />
            ))}
          </div>
          {state.nextCursor !== null ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadMore()}
              className="self-center"
            >
              {t("messaging.actions.loadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <SideSheet
        open={selectedThread !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        title={selectedThread?.warehouseName ?? ""}
        closeLabel={t("messaging.thread.close")}
        widthClassName="max-w-xl lg:max-w-2xl"
      >
        {selectedThread !== null ? (
          <ThreadView
            threadId={selectedThread.id}
            status={selectedThread.status}
            currentUserId={user?.id ?? null}
            orderHref={(orderId) => `/orders?orderId=${orderId}`}
            onRead={() => patchThread({ ...selectedThread, unreadCount: 0 })}
          />
        ) : null}
      </SideSheet>

      <Modal
        open={picking}
        onOpenChange={setPicking}
        title={t("messaging.picker.title")}
        closeLabel={t("messaging.picker.cancel")}
        size="sm"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
          {vendorsLoading ? (
            <LoadingState />
          ) : (
            <Combobox
              ariaLabel={t("messaging.picker.title")}
              value={chosenWarehouseId}
              onChange={setChosenWarehouseId}
              placeholder={t("messaging.picker.placeholder")}
              options={vendors.map((vendor) => ({
                value: vendor.warehouseId,
                label: vendor.warehouseName,
              }))}
            />
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={opening}
            onClick={() => setPicking(false)}
          >
            {t("messaging.picker.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={chosenWarehouseId === "" || opening}
            onClick={() => void startConversation()}
          >
            {opening ? <Spinner className="h-4 w-4" /> : t("messaging.picker.start")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
