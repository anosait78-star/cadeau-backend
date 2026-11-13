import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";

// Shared form pieces for the inventory and vendor-warehouses screens.

export function Field({
  id,
  label,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`flex flex-col gap-1${wide ? " sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function FormActions({
  disabled,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={disabled} onClick={onSubmit}>
        {t("inventory.actions.save")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t("inventory.actions.cancel")}
      </Button>
    </div>
  );
}
