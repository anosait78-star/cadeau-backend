import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge, type BadgeTone } from "@/components/status-badge/status-badge";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { roleColor, roleIcon, roleName, roleText, roleTint } from "./role-appearance";
import type { TeamInvitation } from "./team-api";

function statusTone(status: string, expired: boolean): BadgeTone {
  if (status === "pending") return expired ? "destructive" : "warning";
  if (status === "accepted") return "success";
  return "neutral";
}

/** One invitation: the role it grants, its status, when it expires, and "Revoke" while pending. */
export function InvitationCard({
  invitation,
  canManage,
  onRevoke,
}: {
  readonly invitation: TeamInvitation;
  readonly canManage: boolean;
  readonly onRevoke: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const expired = new Date(invitation.expiresAt).getTime() <= Date.now();
  const color = roleColor(invitation.role);
  const Icon = roleIcon(invitation.role);

  return (
    <Card className="flex items-center gap-3 p-4">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: roleTint(color, 14), color: roleText(color) }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-foreground">{roleName(invitation.role, t)}</p>
          <StatusBadge
            label={
              invitation.status === "pending" && expired
                ? t("team.status.expired")
                : t(`team.status.${invitation.status}` as TranslationKey)
            }
            tone={statusTone(invitation.status, expired)}
          />
        </div>
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {t("team.invitations.expires", {
            date: new Date(invitation.expiresAt).toLocaleDateString(locale),
          })}
        </p>
      </div>
      {canManage && invitation.status === "pending" ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRevoke}
        >
          {t("team.invitations.actions.revoke")}
        </Button>
      ) : null}
    </Card>
  );
}
