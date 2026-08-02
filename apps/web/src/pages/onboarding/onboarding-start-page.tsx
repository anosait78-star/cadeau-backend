import { Building2, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n/i18n-provider";
import { OnboardingLayout } from "./onboarding-layout";

/** `/onboarding` — choose to create a new company or join one by invite code. */
export function OnboardingStartPage(): ReactNode {
  const { t } = useI18n();

  return (
    <OnboardingLayout title={t("onboarding.start.title")} subtitle={t("onboarding.start.subtitle")}>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <OnboardingChoiceCard
          to="/onboarding/join"
          icon={<Users className="h-6 w-6" aria-hidden="true" />}
          title={t("onboarding.start.join.title")}
          description={t("onboarding.start.join.description")}
        />
        <OnboardingChoiceCard
          to="/onboarding/create"
          icon={<Building2 className="h-6 w-6" aria-hidden="true" />}
          title={t("onboarding.start.create.title")}
          description={t("onboarding.start.create.description")}
        />
      </div>
    </OnboardingLayout>
  );
}

function OnboardingChoiceCard({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
}): ReactNode {
  return (
    <Link to={to} className="block focus-visible:outline-none">
      <Card className="h-full transition-colors hover:border-primary focus-visible:border-primary">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground">
            {icon}
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
