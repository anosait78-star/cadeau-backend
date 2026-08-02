import { Building2, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/use-auth";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";

/**
 * Active-tenant switcher. Lists the companies the caller belongs to and switches
 * the active one (the BFF re-issues tenant-scoped tokens; ADR-003). Rendered in
 * both shells. When the user has no company yet it shows a disabled placeholder.
 */
export function CompanySwitcher(): ReactNode {
  const { t } = useI18n();
  const { user, switchCompany } = useAuth();
  const [switching, setSwitching] = useState(false);

  if (user === null) return null;

  const companies = user.companies;
  const active = companies.find((c) => c.id === user.activeCompanyId) ?? null;

  if (companies.length === 0) {
    return (
      <Link to="/onboarding" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        <Building2 className="h-4 w-4" aria-hidden="true" />
        <span className="max-w-40 truncate">{t("company.switcher.none")}</span>
      </Link>
    );
  }

  const onSelect = async (companyId: string): Promise<void> => {
    if (companyId === user.activeCompanyId || switching) return;
    setSwitching(true);
    try {
      await switchCompany(companyId);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={switching}>
          <Building2 className="h-4 w-4" aria-hidden="true" />
          <span className="max-w-40 truncate">{active?.name ?? t("company.switcher.switch")}</span>
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("company.switcher.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => {
          const isActive = company.id === user.activeCompanyId;
          return (
            <DropdownMenuItem
              key={company.id}
              onSelect={() => void onSelect(company.id)}
              className={cn(isActive && "font-medium")}
            >
              <Check
                className={cn("h-4 w-4", isActive ? "opacity-100" : "opacity-0")}
                aria-hidden="true"
              />
              <span className="truncate">{company.name}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
