import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";

/** 404 route: reuses the standard empty state with a link home. */
export function NotFoundPage(): ReactNode {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t("notFound.title")}
      description={t("notFound.description")}
      action={<Button onClick={() => void navigate("/")}>{t("notFound.back")}</Button>}
    />
  );
}
