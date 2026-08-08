import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { LoadingState } from "@/components/states/loading-state";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { teamErrorText } from "./team-error-text";
import {
  CUSTOM_ROLE,
  TEMPLATE_ROLES,
  createInvitation,
  listAvailablePermissions,
  type AvailablePermission,
  type CreatedInvitation,
  type TemplateRole,
} from "./team-api";
import { CORE_MODULE_KEY, MODULE_LABEL_KEYS } from "./team-module-labels";

type RoleType = "predefined" | "custom";
type Step = 1 | 2;

/**
 * "Invite member": step 1 picks the email + role (a fixed template, or
 * "custom"); step 2 — custom only — picks the exact permission set from what
 * the company's plan/features currently make available. The server
 * re-validates everything (role, permission keys, and the Owner-invite rule)
 * regardless of what this dialog sends — this is UX only, never the security
 * boundary.
 */
export function InviteMemberDialog({
  open,
  onOpenChange,
  companyId,
  isOwner,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly companyId: string;
  /** Whether the caller may pick "Owner" as the invited role (UX only — the server enforces this). */
  readonly isOwner: boolean;
  readonly onCreated: (invitation: CreatedInvitation) => void;
}): ReactNode {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [roleType, setRoleType] = useState<RoleType>("predefined");
  const [predefinedRole, setPredefinedRole] = useState<TemplateRole>("store_manager");
  const [availablePermissions, setAvailablePermissions] = useState<AvailablePermission[]>([]);
  const [permissionsState, setPermissionsState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setEmail("");
    setRoleType("predefined");
    setPredefinedRole("store_manager");
    setSelected(new Set());
    setError(null);
    setPermissionsState("idle");
  }, [open]);

  useEffect(() => {
    if (!open || roleType !== "custom" || permissionsState !== "idle") return;
    setPermissionsState("loading");
    listAvailablePermissions()
      .then(({ data }) => {
        setAvailablePermissions(data);
        setPermissionsState("ready");
      })
      .catch(() => setPermissionsState("error"));
  }, [open, roleType, permissionsState]);

  const groups = useMemo(() => {
    const byModule = new Map<string, AvailablePermission[]>();
    for (const permission of availablePermissions) {
      const key = permission.featureKey ?? CORE_MODULE_KEY;
      const list = byModule.get(key) ?? [];
      list.push(permission);
      byModule.set(key, list);
    }
    return [...byModule.entries()];
  }, [availablePermissions]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const predefinedRoleOptions = TEMPLATE_ROLES.filter((role) => role !== "owner" || isOwner);

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const created = await createInvitation(companyId, {
        email: email.trim(),
        role: roleType === "custom" ? CUSTOM_ROLE : predefinedRole,
        ...(roleType === "custom" ? { permissionKeys: [...selected] } : {}),
      });
      onCreated(created);
      onOpenChange(false);
    } catch (caught) {
      setError(teamErrorText(caught, t));
    } finally {
      setPending(false);
    }
  };

  const canGoNext = emailValid && roleType === "custom";
  const canSubmitPredefined = emailValid && roleType === "predefined";
  const canSubmitCustom = emailValid && selected.size > 0;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}
      title={t("team.invite.title")}
      closeLabel={t("team.invite.cancel")}
      size="lg"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <FormField label={t("team.invite.field.email")} htmlFor="invite-email" required>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                aria-label={t("team.invite.field.email")}
              />
            </FormField>

            <div className="flex flex-col gap-1.5">
              <Label>{t("team.invite.field.role")}</Label>
              <div
                role="radiogroup"
                aria-label={t("team.invite.field.role")}
                className="inline-flex w-fit rounded-md border border-input p-0.5"
              >
                {(["predefined", "custom"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={roleType === type}
                    onClick={() => setRoleType(type)}
                    className={cn(
                      "rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                      roleType === type
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {type === "predefined"
                      ? t("team.invite.roleType.predefined")
                      : t("team.invite.roleType.custom")}
                  </button>
                ))}
              </div>
            </div>

            {roleType === "predefined" ? (
              <FormField label={t("team.invite.field.predefinedRole")} htmlFor="invite-role">
                <Combobox
                  id="invite-role"
                  ariaLabel={t("team.invite.field.predefinedRole")}
                  value={predefinedRole}
                  onChange={(value) => setPredefinedRole(value as TemplateRole)}
                  options={predefinedRoleOptions.map((role) => ({
                    value: role,
                    label: t(`team.invite.role.${role}`),
                  }))}
                />
              </FormField>
            ) : (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {t("team.invite.custom.description")}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t("team.invite.custom.description")}
            </p>

            {permissionsState === "loading" ? <LoadingState /> : null}
            {permissionsState === "error" ? (
              <p className="text-sm text-destructive">{t("team.invite.custom.loadError")}</p>
            ) : null}
            {permissionsState === "ready" && availablePermissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("team.invite.custom.empty")}</p>
            ) : null}

            {permissionsState === "ready" && availablePermissions.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("team.invite.custom.selected", { count: selected.size })}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => setSelected(new Set(availablePermissions.map((p) => p.key)))}
                    >
                      {t("team.invite.custom.selectAll")}
                    </button>
                    <button
                      type="button"
                      className="text-sm text-primary hover:underline"
                      onClick={() => setSelected(new Set())}
                    >
                      {t("team.invite.custom.clearAll")}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {groups.map(([moduleKey, permissions]) => (
                    <div key={moduleKey} className="rounded-md border border-border p-3">
                      <p className="mb-2 text-sm font-medium">
                        {moduleKey === CORE_MODULE_KEY
                          ? t("team.module.core")
                          : MODULE_LABEL_KEYS[moduleKey] !== undefined
                            ? t(MODULE_LABEL_KEYS[moduleKey])
                            : moduleKey}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {permissions.map((permission) => (
                          <label
                            key={permission.key}
                            className="flex items-start gap-2 text-sm"
                            htmlFor={`perm-${permission.key}`}
                          >
                            <Checkbox
                              id={`perm-${permission.key}`}
                              checked={selected.has(permission.key)}
                              onChange={() => toggle(permission.key)}
                              className="mt-0.5"
                            />
                            <span className="flex flex-col">
                              <span className="font-mono text-xs">{permission.key}</span>
                              {permission.description !== null ? (
                                <span className="text-xs text-muted-foreground">
                                  {permission.description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}

        {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="flex shrink-0 justify-between gap-2 border-t border-border px-6 py-4">
        <div>
          {step === 2 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setStep(1)}
            >
              {t("team.invite.back")}
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("team.invite.cancel")}
          </Button>
          {step === 1 && roleType === "custom" ? (
            <Button type="button" size="sm" disabled={!canGoNext} onClick={() => setStep(2)}>
              {t("team.invite.next")}
            </Button>
          ) : null}
          {step === 1 && roleType === "predefined" ? (
            <Button
              type="button"
              size="sm"
              disabled={!canSubmitPredefined || pending}
              onClick={() => void submit()}
            >
              {pending ? t("team.invite.submitting") : t("team.invite.submit")}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button
              type="button"
              size="sm"
              disabled={!canSubmitCustom || pending}
              onClick={() => void submit()}
            >
              {pending ? t("team.invite.submitting") : t("team.invite.submit")}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
