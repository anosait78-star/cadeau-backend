import { Download, Share } from "lucide-react";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { useI18n } from "@/i18n/i18n-provider";

/**
 * "Install the app" — the PWA install affordance in the app chrome.
 *
 * It renders only while the app can actually be installed: it disappears once
 * the app is installed (or is already running as an installed app) and never
 * appears in browsers that cannot install it. On iOS, where no install prompt
 * exists, it opens the Share → Add to Home Screen instructions instead.
 *
 * `compact` drops the label for the cramped Mobile top bar.
 */
export function InstallAppButton({ compact = false }: { compact?: boolean }): ReactNode {
  const { t } = useI18n();
  const { availability, install } = useInstallPrompt();
  const [helpOpen, setHelpOpen] = useState(false);

  const onClick = useCallback(() => {
    if (availability === "manual") {
      setHelpOpen(true);
      return;
    }
    void install();
  }, [availability, install]);

  if (availability === "installed" || availability === "unavailable") return null;

  const label = t("install.action");

  return (
    <>
      {compact ? (
        <Button variant="ghost" size="icon" onClick={onClick} aria-label={label}>
          <Download className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onClick}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {label}
        </Button>
      )}

      <Modal
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title={t("install.help.title")}
        closeLabel={t("install.help.close")}
        size="sm"
      >
        <div className="flex flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">{t("install.help.ios.intro")}</p>
          <ol className="flex flex-col gap-3 text-sm text-foreground">
            <li className="flex items-start gap-2">
              <Share className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t("install.help.ios.step1")}</span>
            </li>
            <li className="flex items-start gap-2">
              <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t("install.help.ios.step2")}</span>
            </li>
            <li className="flex items-start gap-2">
              <span
                className="mt-0.5 h-4 w-4 shrink-0 text-center text-xs font-bold text-primary"
                aria-hidden="true"
              >
                ✓
              </span>
              <span>{t("install.help.ios.step3")}</span>
            </li>
          </ol>
          <Button variant="primary" size="sm" onClick={() => setHelpOpen(false)}>
            {t("install.help.close")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
