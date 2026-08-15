import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { authErrorKey, onboardingErrorKey } from "@/auth/auth-error";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { AuthLayout } from "./auth-layout";

/** "Create a company" (default, unchanged flow) vs. "join one" by warehouse code. */
type AccountType = "create" | "join";

/**
 * Registration screen. Creates an account (email + password, optional name /
 * phone), which opens a session immediately. "نوع الحساب" picks what happens
 * next: create a company (unchanged — lands on the dashboard to create it), or
 * join one as a vendor via a warehouse join code (Vendor Accounts, Phase 1) —
 * `register()` itself is untouched either way; joining is a second call right
 * after, mirroring `joinCompany`'s existing accept-then-switch shape.
 */
export function RegisterPage(): ReactNode {
  const { t } = useI18n();
  const { status, register, joinWarehouse } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("create");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({
        email,
        password,
        fullName: fullName.trim() === "" ? undefined : fullName,
        phone: phone.trim() === "" ? undefined : phone,
      });
      if (accountType === "join") {
        try {
          await joinWarehouse(joinCode);
        } catch (err) {
          // The account exists and is signed in even though the join failed —
          // send them to onboarding so they can retry, instead of stranding
          // them on a form that would try (and fail) to register again.
          setError(t(onboardingErrorKey(err, "warehouseCode")));
          void navigate("/onboarding/join", { replace: true });
          return;
        }
      }
      void navigate("/", { replace: true });
    } catch (err) {
      setError(t(authErrorKey(err, "register")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={t("auth.register.title")}
      subtitle={t("auth.register.subtitle")}
      footer={
        <>
          {t("auth.register.haveAccount")}{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            {t("auth.register.toLogin")}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("auth.field.email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t("auth.field.password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">
            {t("auth.field.fullName")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({t("auth.field.optional")})
            </span>
          </Label>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">
            {t("auth.field.phone")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({t("auth.field.optional")})
            </span>
          </Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t("auth.register.accountType.label")}</Label>
          <div
            role="radiogroup"
            aria-label={t("auth.register.accountType.label")}
            className="inline-flex w-fit rounded-md border border-input p-0.5"
          >
            {(["create", "join"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={accountType === option}
                onClick={() => setAccountType(option)}
                className={cn(
                  "rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                  accountType === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "create"
                  ? t("auth.register.accountType.create")
                  : t("auth.register.accountType.join")}
              </button>
            ))}
          </div>
        </div>

        {accountType === "join" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="joinCode">{t("auth.register.field.warehouseCode")}</Label>
            <Input
              id="joinCode"
              name="joinCode"
              required
              minLength={10}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
          </div>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={submitting || (accountType === "join" && joinCode.trim().length < 10)}
        >
          {submitting ? t("auth.submitting") : t("auth.register.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
