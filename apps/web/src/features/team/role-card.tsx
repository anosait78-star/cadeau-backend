import { KeyRound, MoreHorizontal, Pencil, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PermissionTemplateView } from "@/features/access/access-api";
import { useI18n } from "@/i18n/i18n-provider";
import { PermissionChips } from "./permission-chips";
import { roleColor, roleIcon, roleText, roleTint } from "./role-appearance";
import { templateLabel } from "./template-labels";

/** How many permission chips a role card shows before "+N more". */
const TOP_PERMISSIONS = 4;

/**
 * One role (permission template) on the Team page: its icon and color, name
 * and description, its most significant permissions, and how many permissions
 * and members it has. Editing is offered only to `access.manage` holders.
 */
export function RoleCard({
  template,
  memberCount,
  canManage,
  onEdit,
  onViewAll,
}: {
  readonly template: PermissionTemplateView;
  readonly memberCount: number;
  readonly canManage: boolean;
  readonly onEdit: () => void;
  readonly onViewAll: () => void;
}): ReactNode {
  const { t } = useI18n();
  const label = templateLabel(template, t);
  const color = roleColor(template.key);
  const Icon = roleIcon(template.key);

  return (
    <Card
      className="relative flex flex-col gap-4 overflow-hidden p-5"
      data-testid={`role-card-${template.key}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: roleTint(color, 14), color: roleText(color) }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">{label.name}</h3>
          {label.description !== null ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{label.description}</p>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t("team.roles.actionsFor", { role: label.name })}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onViewAll}>{t("team.roles.viewAll")}</DropdownMenuItem>
            {canManage ? (
              <DropdownMenuItem onSelect={onEdit}>{t("team.roles.edit")}</DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("team.roles.topPermissions")}
        </p>
        {template.permissions.length > 0 ? (
          <PermissionChips
            permissions={template.permissions}
            color={color}
            limit={TOP_PERMISSIONS}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("team.roles.noPermissions")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
          style={{ backgroundColor: roleTint(color, 8), color: roleText(color) }}
        >
          <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("team.roles.permissionCount", { count: template.permissions.length })}
        </div>
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("team.roles.memberCount", { count: memberCount })}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {canManage ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            style={{ borderColor: roleTint(color, 45), color: roleText(color) }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {t("team.roles.edit")}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onViewAll} className="ms-auto">
          {t("team.roles.viewAll")}
        </Button>
      </div>
    </Card>
  );
}
