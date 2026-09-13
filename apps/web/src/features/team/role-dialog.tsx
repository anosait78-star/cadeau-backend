import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { LoadingState } from "@/components/states/loading-state";
import type { PermissionTemplateView } from "@/features/access/access-api";
import { useI18n } from "@/i18n/i18n-provider";
import { PermissionPicker } from "./permission-picker";
import { listAvailablePermissions, type AvailablePermission } from "./team-api";
import { templateLabel } from "./template-labels";

/** What the role form collects. */
export interface RoleDraft {
  readonly name: string;
  readonly description: string;
  readonly permissionKeys: readonly string[];
}

/**
 * Add or edit a role: a name, a description, and its permissions through the
 * same picker the custom-invite flow uses.
 *
 * Persisting roles is not built yet, so the dialog does not decide what saving
 * means: it hands the draft to `onSave`, which resolves `true` once the role is
 * stored (and the dialog closes) or `false` when it was not — for now always,
 * and the dialog then says plainly that saving arrives in the next phase rather
 * than pretending it worked. Wiring the API later is a change to `onSave` only.
 */
export function RoleDialog({
  open,
  onOpenChange,
  role,
  onSave,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The role being edited, or `null` to add a new one. */
  readonly role: PermissionTemplateView | null;
  readonly onSave: (draft: RoleDraft) => Promise<boolean>;
}): ReactNode {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [permissions, setPermissions] = useState<AvailablePermission[] | "loading" | "error">(
    "loading",
  );
  const [notSaved, setNotSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // Reset the form from the role every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const label = role === null ? null : templateLabel(role, t);
    setName(label?.name ?? "");
    setDescription(label?.description ?? "");
    setSelected(new Set(role?.permissions ?? []));
    setNotSaved(false);
    // `t` is left out on purpose: switching language must not wipe the form.
  }, [open, role]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPermissions("loading");
    listAvailablePermissions()
      .then(({ data }) => {
        if (active) setPermissions(data);
      })
      .catch(() => {
        if (active) setPermissions("error");
      });
    return () => {
      active = false;
    };
  }, [open]);

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectMany = (keys: readonly string[], select: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (select) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setPending(true);
    setNotSaved(false);
    try {
      const saved = await onSave({
        name: name.trim(),
        description: description.trim(),
        permissionKeys: [...selected],
      });
      if (saved) onOpenChange(false);
      else setNotSaved(true);
    } finally {
      setPending(false);
    }
  };

  const title =
    role === null
      ? t("team.roleDialog.addTitle")
      : t("team.roleDialog.editTitle", { role: templateLabel(role, t).name });

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} closeLabel={t("team.roles.close")}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-dialog-name">{t("team.roleDialog.name")}</Label>
          <Input
            id="role-dialog-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-dialog-description">{t("team.roleDialog.description")}</Label>
          <textarea
            id="role-dialog-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={300}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{t("team.roleDialog.permissions")}</p>
          {permissions === "loading" ? <LoadingState /> : null}
          {permissions === "error" ? (
            <p className="text-sm text-destructive">{t("team.roleDialog.loadError")}</p>
          ) : null}
          {Array.isArray(permissions) ? (
            <PermissionPicker
              permissions={permissions}
              selected={selected}
              onToggle={toggle}
              onSelectMany={selectMany}
            />
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t border-border px-6 py-4">
        {notSaved ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground"
          >
            <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t("team.roleDialog.comingSoon")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("team.roleDialog.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || name.trim().length === 0}
            onClick={() => void save()}
          >
            {t("team.roleDialog.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
