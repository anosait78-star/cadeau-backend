import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { onboardingErrorKey } from "@/auth/auth-error";
import { MONTHLY_ORDERS_RANGES, type MonthlyOrdersRange } from "@/auth/auth-api";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { OnboardingLayout } from "./onboarding-layout";

const COUNTRY_KEYS: TranslationKey[] = [
  "onboarding.country.eg",
  "onboarding.country.sa",
  "onboarding.country.ae",
  "onboarding.country.kw",
  "onboarding.country.qa",
  "onboarding.country.bh",
  "onboarding.country.om",
  "onboarding.country.jo",
  "onboarding.country.iq",
  "onboarding.country.other",
];

/** `/onboarding/create` — the caller's first company profile. */
export function CreateCompanyPage(): ReactNode {
  const { t } = useI18n();
  const { createCompany } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [monthlyOrdersRange, setMonthlyOrdersRange] = useState<MonthlyOrdersRange | "">("");

  const [hasFacebook, setHasFacebook] = useState(false);
  const [facebookHandle, setFacebookHandle] = useState("");
  const [hasInstagram, setHasInstagram] = useState(false);
  const [instagramHandle, setInstagramHandle] = useState("");
  const [hasWebsite, setHasWebsite] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [shippingCarrier, setShippingCarrier] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (monthlyOrdersRange === "") return;
    setSubmitting(true);
    setError(null);
    try {
      await createCompany({
        name,
        phone,
        monthlyOrdersRange,
        country: country.trim() === "" ? undefined : country,
        facebookHandle: hasFacebook && facebookHandle.trim() !== "" ? facebookHandle : undefined,
        instagramHandle:
          hasInstagram && instagramHandle.trim() !== "" ? instagramHandle : undefined,
        websiteUrl: hasWebsite && websiteUrl.trim() !== "" ? websiteUrl : undefined,
        shippingCarrier: shippingCarrier.trim() === "" ? undefined : shippingCarrier,
      });
      void navigate("/", { replace: true });
    } catch (err) {
      setError(t(onboardingErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingLayout title={t("onboarding.start.title")} subtitle={t("onboarding.start.subtitle")}>
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-6 p-6">
          <h2 className="text-lg font-semibold text-foreground">{t("onboarding.create.title")}</h2>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="companyName">{t("onboarding.create.field.name")}</Label>
              <Input
                id="companyName"
                name="companyName"
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="companyCountry">
                {t("onboarding.create.field.country")}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({t("auth.field.optional")})
                </span>
              </Label>
              <select
                id="companyCountry"
                name="companyCountry"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t("onboarding.create.field.countryPlaceholder")}</option>
                {COUNTRY_KEYS.map((key) => (
                  <option key={key} value={t(key)}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="companyPhone">{t("onboarding.create.field.phone")}</Label>
              <Input
                id="companyPhone"
                name="companyPhone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="monthlyOrdersRange">
                {t("onboarding.create.field.monthlyOrdersRange")}
              </Label>
              <select
                id="monthlyOrdersRange"
                name="monthlyOrdersRange"
                required
                value={monthlyOrdersRange}
                onChange={(e) => setMonthlyOrdersRange(e.target.value as MonthlyOrdersRange)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  {t("onboarding.create.field.monthlyOrdersRangePlaceholder")}
                </option>
                {MONTHLY_ORDERS_RANGES.map((range) => (
                  <option key={range} value={range}>
                    {t(`onboarding.monthlyOrders.${range}` as TranslationKey)}
                  </option>
                ))}
              </select>
            </div>

            <SocialField
              checkboxId="hasFacebook"
              checkboxLabel={t("onboarding.create.field.hasFacebook")}
              checked={hasFacebook}
              onCheckedChange={setHasFacebook}
              inputLabel={t("onboarding.create.field.facebookHandle")}
              value={facebookHandle}
              onValueChange={setFacebookHandle}
            />

            <SocialField
              checkboxId="hasInstagram"
              checkboxLabel={t("onboarding.create.field.hasInstagram")}
              checked={hasInstagram}
              onCheckedChange={setHasInstagram}
              inputLabel={t("onboarding.create.field.instagramHandle")}
              value={instagramHandle}
              onValueChange={setInstagramHandle}
            />

            <SocialField
              checkboxId="hasWebsite"
              checkboxLabel={t("onboarding.create.field.hasWebsite")}
              checked={hasWebsite}
              onCheckedChange={setHasWebsite}
              inputLabel={t("onboarding.create.field.websiteUrl")}
              value={websiteUrl}
              onValueChange={setWebsiteUrl}
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shippingCarrier">
                {t("onboarding.create.field.shippingCarrier")}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({t("auth.field.optional")})
                </span>
              </Label>
              <Input
                id="shippingCarrier"
                name="shippingCarrier"
                placeholder={t("onboarding.create.field.shippingCarrierPlaceholder")}
                value={shippingCarrier}
                onChange={(e) => setShippingCarrier(e.target.value)}
              />
            </div>

            {error !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={submitting}>
              {submitting ? t("auth.submitting") : t("onboarding.create.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </OnboardingLayout>
  );
}

/** A yes/no checkbox that reveals a conditional text field when checked. */
function SocialField({
  checkboxId,
  checkboxLabel,
  checked,
  onCheckedChange,
  inputLabel,
  value,
  onValueChange,
}: {
  checkboxId: string;
  checkboxLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  inputLabel: string;
  value: string;
  onValueChange: (value: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        <Label htmlFor={checkboxId} className="font-normal">
          {checkboxLabel}
        </Label>
      </div>
      {checked ? (
        <Input
          aria-label={inputLabel}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
