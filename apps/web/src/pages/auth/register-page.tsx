import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { authErrorKey, authFieldErrors } from "@/auth/auth-error";
import { useAuth } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { AuthLayout } from "./auth-layout";

/**
 * Registration screen. Creates an account (email + password, optional name /
 * phone), which opens a session immediately. What to do next — create a
 * company or join one — is decided on the `/onboarding` two-card chooser, not
 * here: navigating to `/` and letting `RequireAuth` redirect a freshly
 * registered user (0 companies) there avoids racing this component's own
 * "already authenticated" guard below against an explicit `/onboarding`
 * navigation.
 */
export function RegisterPage(): ReactNode {
  const { t } = useI18n();
  const { status, register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which inputs the API named, so the message sits under the field it is
  // about rather than as one line at the foot of the form.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, TranslationKey>>>({});
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await register({
        email,
        password,
        fullName: fullName.trim() === "" ? undefined : fullName,
        phone: phone.trim() === "" ? undefined : phone,
      });
      void navigate("/", { replace: true });
    } catch (err) {
      const fields = authFieldErrors(err);
      setFieldErrors(fields);
      // The summary would only repeat "check the highlighted fields" over
      // messages that already say what is wrong, so it steps aside for them.
      setError(Object.keys(fields).length > 0 ? null : t(authErrorKey(err, "register")));
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
            aria-invalid={fieldErrors["email"] !== undefined}
            aria-describedby={fieldErrors["email"] !== undefined ? "email-error" : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldError id="email-error" messageKey={fieldErrors["email"]} />
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
            aria-invalid={fieldErrors["password"] !== undefined}
            aria-describedby={fieldErrors["password"] !== undefined ? "password-error" : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldError id="password-error" messageKey={fieldErrors["password"]} />
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
            aria-invalid={fieldErrors["fullName"] !== undefined}
            aria-describedby={fieldErrors["fullName"] !== undefined ? "fullName-error" : undefined}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <FieldError id="fullName-error" messageKey={fieldErrors["fullName"]} />
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
            aria-invalid={fieldErrors["phone"] !== undefined}
            aria-describedby={fieldErrors["phone"] !== undefined ? "phone-error" : undefined}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <FieldError id="phone-error" messageKey={fieldErrors["phone"]} />
        </div>

        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? t("auth.submitting") : t("auth.register.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** The API's complaint about one field, under that field. Renders nothing when it is happy. */
function FieldError({
  id,
  messageKey,
}: {
  id: string;
  messageKey: TranslationKey | undefined;
}): ReactNode {
  const { t } = useI18n();
  if (messageKey === undefined) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {t(messageKey)}
    </p>
  );
}
