import { CalendarDays, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { PermissionChips } from "./permission-chips";
import { initials, roleColor, roleName, roleText, roleTint } from "./role-appearance";
import type { TeamMember } from "./team-api";

/** How many permission chips a member card shows before "+N more". */
const TOP_PERMISSIONS = 6;

/** A member's effective permissions, or where fetching them got to. */
export type MemberPermissionsState = readonly string[] | "loading" | "error";

/**
 * One team member: avatar, name and email, a badge in their role's color, and
 * their effective permissions as chips in that same color. A member whose
 * permissions failed to load is still shown — only the chips are replaced.
 */
export function MemberCard({
  member,
  permissions,
  canManage,
  onRemove,
}: {
  readonly member: TeamMember;
  readonly permissions: MemberPermissionsState;
  readonly canManage: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const color = roleColor(member.role);
  const displayName = member.name ?? member.email;

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid={`member-card-${member.id}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{ backgroundColor: roleTint(color, 16), color: roleText(color) }}
        >
          {initials(member.name, member.email)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{displayName}</p>
          {member.name !== null ? (
            <p className="truncate text-sm text-muted-foreground" dir="ltr">
              {member.email}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: roleTint(color, 16), color: roleText(color) }}
            >
              {roleName(member.role, t)}
            </span>
            <StatusBadge
              label={t(`team.status.${member.status}` as TranslationKey)}
              tone={member.status === "active" ? "success" : "neutral"}
            />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {t("team.members.joined", {
                date: new Date(member.joinedAt).toLocaleDateString(locale),
              })}
            </span>
          </div>
        </div>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t("team.members.actionsFor", { name: displayName })}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={onRemove}
              >
                {t("team.members.actions.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="border-t border-border pt-3">
        {permissions === "loading" ? (
          <div className="h-6 w-2/3 animate-pulse rounded-full bg-muted" />
        ) : null}
        {permissions === "error" ? (
          <p className="text-xs text-muted-foreground">
            {t("team.members.permissionsUnavailable")}
          </p>
        ) : null}
        {Array.isArray(permissions) && permissions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("team.members.noPermissions")}</p>
        ) : null}
        {Array.isArray(permissions) && permissions.length > 0 ? (
          <PermissionChips permissions={permissions} color={color} limit={TOP_PERMISSIONS} />
        ) : null}
      </div>
    </Card>
  );
}
