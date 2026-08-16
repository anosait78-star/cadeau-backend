import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/states/loading-state";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/i18n/i18n-provider";
import {
  getWarehouseJoinCode,
  revokeWarehouseJoinCode,
  rotateWarehouseJoinCode,
  type WarehouseJoinCodeCreated,
  type WarehouseJoinCodeStatus,
} from "./inventory-api";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "status"; readonly status: WarehouseJoinCodeStatus }
  /** Just (re)issued — shown once, like the team invitation code. */
  | { readonly kind: "created"; readonly created: WarehouseJoinCodeCreated };

/**
 * "كود دعوة المستودع": a per-warehouse, rotatable, revocable self-service join
 * code (Vendor Accounts, Phase 1). Follows the same "shown once" convention as
 * {@link InvitationCodeDialog} — the server stores only the code's hash, so a
 * freshly (re)issued code is the one and only chance to copy it; afterwards
 * this dialog only shows status (active/revoked, created date).
 */
export function WarehouseJoinCodeDialog({
  open,
  onOpenChange,
  warehouseId,
  warehouseName,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly warehouseId: string;
  readonly warehouseName: string;
}): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const status = await getWarehouseJoinCode(warehouseId);
      setState({ kind: "status", status });
    } catch {
      setState({ kind: "error" });
    }
  }, [warehouseId]);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setCopyFailed(false);
    void load();
  }, [open, load]);

  const rotate = async (): Promise<void> => {
    setPending(true);
    try {
      const created = await rotateWarehouseJoinCode(warehouseId);
      setState({ kind: "created", created });
    } catch {
      setState({ kind: "error" });
    } finally {
      setPending(false);
    }
  };

  const revoke = async (): Promise<void> => {
    setPending(true);
    try {
      await revokeWarehouseJoinCode(warehouseId);
      await load();
    } catch {
      setState({ kind: "error" });
    } finally {
      setPending(false);
    }
  };

  /** Falls back to the legacy `execCommand` copy when the Clipboard API is unavailable/denied. */
  const legacyCopy = (text: string): boolean => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let ok: boolean;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(textarea);
    return ok;
  };

  const copyCode = (code: string): void => {
    setCopyFailed(false);
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        if (legacyCopy(code)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } else {
          setCopyFailed(true);
        }
      });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}
      title={t("inventory.joinCode.title", { name: warehouseName })}
      closeLabel={t("inventory.joinCode.close")}
      size="sm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {state.kind === "loading" ? <LoadingState /> : null}
        {state.kind === "error" ? (
          <p className="text-sm text-destructive">{t("inventory.joinCode.loadError")}</p>
        ) : null}

        {state.kind === "created" ? (
          <>
            <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              {t("inventory.joinCode.shownOnce")}
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                {t("inventory.joinCode.codeLabel")}
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {state.created.code}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyCode(state.created.code)}
                >
                  {copied ? t("team.result.copied") : t("team.result.copy")}
                </Button>
              </div>
              {copyFailed ? (
                <p className="text-sm text-destructive">{t("team.result.copyFailed")}</p>
              ) : null}
            </div>
          </>
        ) : null}

        {state.kind === "status" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {state.status.exists
                ? state.status.isActive
                  ? t("inventory.joinCode.statusActive")
                  : t("inventory.joinCode.statusRevoked")
                : t("inventory.joinCode.statusNone")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => void rotate()}>
                {state.status.exists
                  ? t("inventory.joinCode.rotate")
                  : t("inventory.joinCode.create")}
              </Button>
              {state.status.exists && state.status.isActive ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void revoke()}
                >
                  {t("inventory.joinCode.revoke")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>
          {t("inventory.joinCode.close")}
        </Button>
      </div>
    </Modal>
  );
}
