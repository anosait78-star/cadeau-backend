import type { ReactNode } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { permissionLabelFromKey } from "./permission-labels";
import { rankPermissions, roleText, roleTint } from "./role-appearance";

/**
 * The first `limit` of a permission set as chips in a role's color, most
 * significant first, followed by a neutral "+N more" when some are left out.
 * Names are translated; the raw key only survives as a tooltip-free fallback
 * for a permission this build does not know.
 */
export function PermissionChips({
  permissions,
  color,
  limit,
}: {
  readonly permissions: readonly string[];
  readonly color: string;
  readonly limit: number;
}): ReactNode {
  const { t } = useI18n();
  const ranked = rankPermissions(permissions);
  const shown = ranked.slice(0, limit);
  const hidden = ranked.length - shown.length;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((key) => {
        const label = permissionLabelFromKey(key, t);
        return (
          <li
            key={key}
            title={label.description.length > 0 ? label.description : undefined}
            className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: roleTint(color, 10),
              borderColor: roleTint(color, 30),
              color: roleText(color),
            }}
          >
            {label.name}
          </li>
        );
      })}
      {hidden > 0 ? (
        <li className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {t("team.roles.more", { count: hidden })}
        </li>
      ) : null}
    </ul>
  );
}
