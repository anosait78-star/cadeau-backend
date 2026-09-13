import type { ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import type { PermissionTemplateView } from "@/features/access/access-api";
import { useI18n } from "@/i18n/i18n-provider";
import { PermissionChips } from "./permission-chips";
import { moduleLabel } from "./permission-labels";
import { roleColor } from "./role-appearance";
import { CORE_MODULE_KEY } from "./team-module-labels";
import { templateLabel } from "./template-labels";

/** The module a bare permission key belongs to: its first segment, `access.*` being core. */
function moduleOf(key: string): string {
  const head = key.split(".")[0] ?? key;
  return head === "access" ? CORE_MODULE_KEY : head;
}

/** Every permission of one role, grouped by module (core first), in the role's color. */
export function RolePermissionsDialog({
  template,
  onOpenChange,
}: {
  /** The role to show; `null` keeps the dialog closed. */
  readonly template: PermissionTemplateView | null;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { t } = useI18n();

  const groups = new Map<string, string[]>();
  for (const key of template?.permissions ?? []) {
    const module = moduleOf(key);
    groups.set(module, [...(groups.get(module) ?? []), key]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === CORE_MODULE_KEY ? -1 : b === CORE_MODULE_KEY ? 1 : 0,
  );

  const name = template === null ? "" : templateLabel(template, t).name;
  const color = roleColor(template?.key ?? "");

  return (
    <Modal
      open={template !== null}
      onOpenChange={onOpenChange}
      title={t("team.roles.allPermissionsTitle", { role: name })}
      closeLabel={t("team.roles.close")}
      size="md"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("team.roles.noPermissions")}</p>
        ) : null}
        {ordered.map(([module, keys]) => (
          <section key={module} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">{moduleLabel(module, t)}</h3>
            <PermissionChips permissions={keys} color={color} limit={keys.length} />
          </section>
        ))}
      </div>
    </Modal>
  );
}
