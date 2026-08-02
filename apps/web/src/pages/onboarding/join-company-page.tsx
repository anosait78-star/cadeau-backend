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
import { OnboardingLayout } from "./onboarding-layout";

/** `/onboarding/join` — join an existing company by invite code. */
export function JoinCompanyPage(): ReactNode {
  const { t } = useI18n();
  const { joinCompany } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await joinCompany(code);
      void navigate("/", { replace: true });
    } catch (err) {
      setError(t(onboardingErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingLayout title={t("onboarding.start.title")} subtitle={t("onboarding.start.subtitle")}>
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-6 p-6">
          <h2 className="text-lg font-semibold text-foreground">{t("onboarding.join.title")}</h2>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invitationCode">{t("onboarding.join.field.code")}</Label>
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
