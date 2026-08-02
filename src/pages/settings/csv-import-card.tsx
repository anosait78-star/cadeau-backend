import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/i18n-provider";
import type { TranslationKey } from "@/i18n/dictionaries";

/** One column an importer can map — a required id field or an optional one. */
export interface ImportField {
  readonly key: string;
  readonly labelKey: TranslationKey;
  readonly required: boolean;
}

/** A per-row outcome, shared shape between the products and orders importers. */
export interface ImportRowResult {
  readonly row: number;
  readonly ok: boolean;
  readonly error?: { readonly message: string };
}

type Stage =
  | { readonly kind: "idle" }
  | { readonly kind: "mapping"; readonly csv: string; readonly headers: string[] }
  | { readonly kind: "importing"; readonly csv: string; readonly headers: string[] }
  | { readonly kind: "done"; readonly results: ImportRowResult[] }
  | { readonly kind: "error"; readonly message: string };

/** First line of a CSV, split on commas — good enough for a plain header row. */
function detectHeaders(csv: string): string[] {
  const firstLine = csv.split(/\r\n|\r|\n/, 1)[0] ?? "";
  return firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
}

/**
 * A CSV import card: pick a file, map its columns to fields via dropdowns, run
 * the import, and show a per-row result summary. Generic over the mapping
 * shape so Products and Orders reuse the same picker/mapping/results UI.
 */
export function CsvImportCard<TMapping>({
  titleKey,
  descriptionKey,
  fields,
  buildMapping,
  onImport,
}: {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  fields: readonly ImportField[];
  buildMapping: (selected: Record<string, string>) => TMapping;
  onImport: (csv: string, mapping: TMapping) => Promise<{ results: ImportRowResult[] }>;
}): ReactNode {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [selected, setSelected] = useState<Record<string, string>>({});

  const onFileChosen = async (file: File): Promise<void> => {
    const csv = await file.text();
    const headers = detectHeaders(csv);
    setSelected({});
    setStage({ kind: "mapping", csv, headers });
  };

  const requiredReady = fields
    .filter((f) => f.required)
    .every((f) => (selected[f.key] ?? "").length > 0);

  const runImport = async (): Promise<void> => {
    if (stage.kind !== "mapping") return;
    const { csv } = stage;
    setStage({ kind: "importing", csv, headers: stage.headers });
    try {
      const mapping = buildMapping(selected);
      const { results } = await onImport(csv, mapping);
      setStage({ kind: "done", results });
    } catch {
      setStage({ kind: "error", message: t("settings.dataImport.failed") });
    }
  };

  const reset = (): void => {
    setStage({ kind: "idle" });
    setSelected({});
    if (fileInputRef.current !== null) fileInputRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>

        {stage.kind === "idle" || stage.kind === "done" || stage.kind === "error" ? (
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label={t(titleKey)}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) void onFileChosen(file);
              }}
            />
            <p className="text-xs text-muted-foreground">{t("settings.dataImport.csvHint")}</p>
          </div>
        ) : null}

        {(stage.kind === "mapping" || stage.kind === "importing") && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor={`map-${field.key}`}
                  >
                    {t(field.labelKey)}
                    {field.required ? " *" : ""}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                    value={selected[field.key] ?? ""}
                    onChange={(e) =>
                      setSelected((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  >
                    <option value="">{t("settings.dataImport.notMapped")}</option>
                    {stage.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={!requiredReady || stage.kind === "importing"}
                onClick={() => void runImport()}
              >
                {stage.kind === "importing"
                  ? t("settings.dataImport.importing")
                  : t("settings.dataImport.startImport")}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                {t("md.actions.cancel")}
              </Button>
            </div>
          </div>
        )}

        {stage.kind === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {stage.message}
          </p>
        ) : null}

        {stage.kind === "done" ? <ImportSummary results={stage.results} onReset={reset} /> : null}
      </CardContent>
    </Card>
  );
}

function ImportSummary({
  results,
  onReset,
}: {
  results: readonly ImportRowResult[];
  onReset: () => void;
}): ReactNode {
  const { t } = useI18n();
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p role="status" className="text-sm font-medium">
        {t("settings.dataImport.summary", { succeeded, failed: failed.length })}
      </p>
      {failed.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs text-destructive">
          {failed.map((r) => (
            <li key={r.row}>
              {t("settings.dataImport.rowError", {
                row: r.row,
                message: r.error?.message ?? "",
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <Button size="sm" variant="outline" className="self-start" onClick={onReset}>
        {t("settings.dataImport.importAnother")}
      </Button>
    </div>
  );
}
