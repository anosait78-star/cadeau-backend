import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/i18n/i18n-provider";
import type { CreatedInvitation } from "./team-api";

/**
 * Shown once, immediately after `POST .../invitations` succeeds. The plaintext
 * code is never retrievable again afterwards (the server stores only its hash)
 * — this dialog is the single chance to copy it.
 */
export function InvitationCodeDialog({
  invitation,
  onOpenChange,
}: {
  readonly invitation: CreatedInvitation | null;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

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

  const copyCode = (): void => {
    if (invitation === null) return;
    setCopyFailed(false);
    navigator.clipboard
      .writeText(invitation.code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        if (legacyCopy(invitation.code)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } else {
          setCopyFailed(true);
        }
      });
  };

  return (
    <Modal
      open={invitation !== null}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
      title={t("team.result.title")}
      closeLabel={t("team.result.done")}
      size="sm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {t("team.result.description")}
        </p>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase text-muted-foreground">
            {t("team.result.code.label")}
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border border-border bg-muted px-3 py-2 text-sm">
              {invitation?.code ?? ""}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copyCode}>
              {copied ? t("team.result.copied") : t("team.result.copy")}
            </Button>
          </div>
          {copyFailed ? (
            <p className="text-sm text-destructive">{t("team.result.copyFailed")}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>
          {t("team.result.done")}
        </Button>
      </div>
    </Modal>
  );
}
