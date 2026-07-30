import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { authErrorKey } from "@/auth/auth-error";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useI18n } from "@/i18n/i18n-provider";
import { AuthLayout } from "./auth-layout";

interface FromState {
  from?: { pathname: string };
}

/**
 * Sign-in screen. Submits email + password; if the account has 2FA enabled the
 * BFF answers `401` with `twoFactorRequired`, and this switches to a code step
 * that re-submits the same credentials plus the TOTP code. On success it returns
 * the caller to the location they were redirected from (or the dashboard).
 */
export function LoginPage(): ReactNode {
  const { t } = useI18n();
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") {
    const from = (location.state as FromState | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({
        email,
        password,
        totpCode: needsTotp ? totpCode : undefined,
      });
      const from = (location.state as FromState | null)?.from?.pathname ?? "/";
      void navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.twoFactorRequired) {
        setNeedsTotp(true);
        setError(null);
      } else {
        setError(t(authErrorKey(err, needsTotp ? "twoFactor" : "login")));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={needsTotp ? t("auth.twoFactor.title") : t("auth.login.title")}
      subtitle={needsTotp ? t("auth.twoFactor.subtitle") : t("auth.login.subtitle")}
      footer={
        needsTotp ? undefined : (
          <>
            {t("auth.login.noAccount")}{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              {t("auth.login.toRegister")}
            </Link>
          </>
        )
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {needsTotp ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="totpCode">{t("auth.field.totp")}</Label>
            <Input
              id="totpCode"
              name="totpCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
          </div>
        ) : (
          <>
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
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}

        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting}>
          {submitting
            ? t("auth.submitting")
            : needsTotp
              ? t("auth.twoFactor.submit")
              : t("auth.login.submit")}
        </Button>

        {needsTotp ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => {
              setNeedsTotp(false);
              setTotpCode("");
              setError(null);
            }}
          >
            {t("auth.twoFactor.back")}
          </Button>
        ) : null}
      </form>
    </AuthLayout>
  );
}
