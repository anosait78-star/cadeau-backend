import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { onboardingErrorKey } from "@/auth/auth-error";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { OnboardingLayout } from "./onboarding-layout";

/** Which kind of code the caller is joining with. */
type JoinKind = "invitation" | "warehouseCode";

/**
 * `/onboarding/join` — join an existing company, either by a regular company
 * invitation code or, as a vendor, by a warehouse join code scoped to one
 * warehouse (Vendor Accounts, Phase 1).
 */
export function JoinCompanyPage(): ReactNode {
  const { t } = useI18n();
  const { joinCompany, joinWarehouse } = useAuth();
  const navigate = useNavigate();

  const [kind, setKind] = useState<JoinKind>("invitation");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (kind === "warehouseCode") {
        await joinWarehouse(code);
      } else {
        await joinCompany(code);
      }
      void navigate("/", { replace: true });
    } catch (err) {
      setError(t(onboardingErrorKey(err, kind)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingLayout title={t("onboarding.start.title")} subtitle={t("onboarding.start.subtitle")}>
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-6 p-6">
          <h2 className="text-lg font-semibold text-foreground">{t("onboarding.join.title")}</h2>

          <div
            role="radiogroup"
            aria-label={t("onboarding.join.kind.label")}
            className="inline-flex w-fit rounded-md border border-input p-0.5"
          >
            {(["invitation", "warehouseCode"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => {
                  setKind(option);
                  setCode("");
                  setError(null);
                }}
                className={cn(
                  "rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                  kind === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "invitation"
                  ? t("onboarding.join.kind.invitation")
                  : t("onboarding.join.kind.warehouseCode")}
              </button>
            ))}
          </div>

          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invitationCode">
                {kind === "warehouseCode"
                  ? t("onboarding.join.field.warehouseCode")
                  : t("onboarding.join.field.code")}
              </Label>
              <Input
                id="invitationCode"
                name="invitationCode"
                required
                minLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            {error !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={submitting}>
              {submitting ? t("auth.submitting") : t("onboarding.join.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </OnboardingLayout>
  );
}
