import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { changePasswordErrorKey } from "@/auth/auth-error";
import { changePassword, requestAccountDeletion } from "@/auth/auth-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * Security settings tab: change password and request account deletion
 * (`POST /v1/auth/change-password`, `POST /v1/auth/account-deletion-request`).
 * A deletion request only flags the account for review — it does not itself
 * erase any data (matches the "no destructive self-service action" rule).
 */
export function SecurityPanel(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <ChangePasswordCard />
      <DeleteAccountCard />
    </div>
  );
}

function ChangePasswordCard(): ReactNode {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ kind: "error", text: t("settings.security.mismatch") });
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ kind: "success", text: t("settings.security.changeSuccess") });
    } catch (err) {
      setMessage({ kind: "error", text: t(changePasswordErrorKey(err)) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.security.changePasswordTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">{t("settings.security.currentPassword")}</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">{t("settings.security.newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">{t("settings.security.confirmPassword")}</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting}>
              {t("settings.security.updatePassword")}
            </Button>
            {message !== null ? (
              <span
                role={message.kind === "error" ? "alert" : "status"}
                className={
                  message.kind === "error" ? "text-sm text-destructive" : "text-sm text-primary"
                }
              >
                {message.text}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DeleteAccountCard(): ReactNode {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"idle" | "requested" | "error">("idle");

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await requestAccountDeletion();
      setState("requested");
      setConfirming(false);
    } catch {
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive">{t("settings.security.deleteTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("settings.security.deleteSubtitle")}</p>

        {state === "requested" ? (
          <p role="status" className="text-sm text-primary">
            {t("settings.security.deleteRequested")}
          </p>
        ) : null}
        {state === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {t("settings.security.deleteFailed")}
          </p>
        ) : null}

        {confirming ? (
          <div className="flex items-center gap-3">
            <p className="text-sm">{t("settings.security.deleteConfirm")}</p>
            <Button variant="destructive" disabled={submitting} onClick={() => void submit()}>
              {t("settings.security.deleteConfirmYes")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("md.actions.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            variant="destructive"
            className="self-start"
            disabled={state === "requested"}
            onClick={() => setConfirming(true)}
          >
            {t("settings.security.deleteAction")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
