import { ChevronDown, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { moduleLabel, permissionLabel } from "./permission-labels";
import type { AvailablePermission } from "./team-api";
import { CORE_MODULE_KEY } from "./team-module-labels";

/** One module's permissions, in the order the picker renders them. */
interface Group {
  readonly moduleKey: string;
  readonly permissions: readonly AvailablePermission[];
  readonly grantable: readonly AvailablePermission[];
}

/**
 * The custom-role permission picker: the whole catalog grouped by module, each
 * module a collapsible section carrying a `selected/total` count.
 *
 * Two decisions shape it. **Permissions read as sentences, not keys** — the
 * dotted key (`orders.manage`) is a routing detail, so it moves to the row's
 * `title` and the visible label is a translated name with a sentence under it;
 * that is what makes the list mean something in Arabic, where the raw key never
 * could. And **out-of-plan permissions stay visible but disabled**, because a
 * filtered list cannot tell an admin whether it is complete — a locked row
 * says "your plan does not include this", while a missing row says nothing.
 *
 * Core (`access.*`) sorts first — it decides whether the invitee can invite
 * others — but every section starts collapsed, including that one: the picker
 * should open as a scannable list of modules, not with one already unpacked.
 *
 * Type is set in `sm`/`xs` rather than the app's `body`/`caption` tokens: this
 * is a dense checklist inside a dialog that already sizes its text that way,
 * and at reading size the rows push the sections past a screenful.
 */
export function PermissionPicker({
  permissions,
  selected,
  onToggle,
  onSelectMany,
}: {
  readonly permissions: readonly AvailablePermission[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  /** Replaces the selection for exactly these keys (a section's "select all"). */
  readonly onSelectMany: (keys: readonly string[], select: boolean) => void;
}): ReactNode {
  const { t } = useI18n();

  const groups = useMemo<Group[]>(() => {
    const byModule = new Map<string, AvailablePermission[]>();
    for (const permission of permissions) {
      const key = permission.featureKey ?? CORE_MODULE_KEY;
      const list = byModule.get(key) ?? [];
      list.push(permission);
      byModule.set(key, list);
    }
    return (
      [...byModule.entries()]
        .map(([moduleKey, list]) => ({
          moduleKey,
          permissions: list,
          grantable: list.filter((p) => p.available),
        }))
        // Core first — it holds the "can this person manage the team" answer.
        .sort((a, b) =>
          a.moduleKey === CORE_MODULE_KEY ? -1 : b.moduleKey === CORE_MODULE_KEY ? 1 : 0,
        )
    );
  }, [permissions]);

  // Every section starts closed, so the picker opens as a short list of modules
  // rather than a wall of checkboxes — the reader chooses what to expand.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(groups.map((g) => g.moduleKey)),
  );

  const toggleSection = (moduleKey: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(moduleKey)) next.delete(moduleKey);
      else next.add(moduleKey);
      return next;
    });
  };

  const anyLocked = permissions.some((p) => !p.available);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const label = moduleLabel(group.moduleKey, t);
        const chosen = group.grantable.filter((p) => selected.has(p.key)).length;
        const isCollapsed = collapsed.has(group.moduleKey);
        const allChosen = group.grantable.length > 0 && chosen === group.grantable.length;

        return (
          <section
            key={group.moduleKey}
            className="card-raised overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => toggleSection(group.moduleKey)}
                aria-expanded={!isCollapsed}
                className="pressable flex min-w-0 flex-1 items-center gap-2 text-start"
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    isCollapsed && "ltr:-rotate-90 rtl:rotate-90",
                  )}
                  aria-hidden="true"
                />
                <span className="truncate text-sm font-semibold text-foreground">{label}</span>
                {chosen > 0 ? (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                    {t("team.invite.custom.moduleCount", {
                      selected: chosen,
                      total: group.grantable.length,
                    })}
                  </span>
                ) : null}
              </button>

              {group.grantable.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    onSelectMany(
                      group.grantable.map((p) => p.key),
                      !allChosen,
                    )
                  }
                  className="shrink-0 text-xs text-primary hover:underline"
                >
                  {allChosen
                    ? t("team.invite.custom.clearAll")
                    : t("team.invite.custom.moduleSelectAll")}
                </button>
              ) : null}
            </div>

            {isCollapsed ? null : (
              <ul className="list-flush-separators border-t border-border">
                {group.permissions.map((permission) => (
                  <PermissionRow
                    key={permission.key}
                    permission={permission}
                    checked={selected.has(permission.key)}
                    onToggle={() => onToggle(permission.key)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {anyLocked ? (
        <p className="text-xs text-muted-foreground">{t("team.invite.custom.unavailableHint")}</p>
      ) : null}
    </div>
  );
}

/** One permission: a translated name, its sentence, and — when locked — why. */
function PermissionRow({
  permission,
  checked,
  onToggle,
}: {
  readonly permission: AvailablePermission;
  readonly checked: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const { t } = useI18n();
  const { name, description, action } = permissionLabel(permission, t);
  const locked = !permission.available;
  const id = `perm-${permission.key}`;

  return (
    <li>
      <label
        htmlFor={id}
        // The dotted key is the one thing a support conversation needs and the
        // one thing a reader never does, so it lives in the tooltip.
        title={permission.key}
        className={cn(
          "flex items-start gap-3 px-4 py-3",
          locked ? "cursor-not-allowed opacity-55" : "cursor-pointer",
        )}
      >
        <Checkbox
          id={id}
          checked={checked}
          disabled={locked}
          onChange={onToggle}
          className="mt-0.5"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            {action === "manage" ? (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                {t("team.permission.action.manage")}
              </span>
            ) : null}
          </span>
          {description === "" ? null : (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </span>
        {locked ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {t("team.invite.custom.unavailable")}
          </span>
        ) : null}
      </label>
    </li>
  );
}
