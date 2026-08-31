import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageTitle } from "@/components/layout/page-title";
import {
  createItem,
  deactivateItem,
  listItems,
  updateItem,
  type MasterDataItem,
} from "@/features/master-data/master-data-api";
import { MD_RESOURCES, type MdField, type MdResource } from "@/features/master-data/resources";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { buildMdColumns } from "./master-data-columns";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly items: MasterDataItem[];
      readonly nextCursor: string | null;
    };

/**
 * Master Data — the shared reference tables every module builds on. The three
 * system reference resources (currencies, country configs, governorates) are
 * read-only; the rest are tenant-editable. The whole screen is behind the
 * `master-data` feature; create/edit/deactivate are behind `master-data.manage`
 * (the API enforces both again — ADR-003). One responsive card list serves both
 * shells (the card alternative required by ADR-002).
 */
export function MasterDataPage(): ReactNode {
  const { t } = useI18n();
  const [resource, setResource] = useState<MdResource>(MD_RESOURCES[0] as MdResource);

  return (
    <FeatureGate
      feature="master-data"
      fallback={
        <div className="mx-auto w-full max-w-5xl lg:p-6">
          <EmptyState title={t("md.forbidden")} />
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:p-6">
        <PageTitle title={t("md.title")} description={t("md.subtitle")} />

        <nav aria-label={t("md.resources")} className="flex flex-wrap gap-2">
          {MD_RESOURCES.map((r) => (
            <Button
              key={r.name}
              size="sm"
              variant={r.name === resource.name ? "primary" : "outline"}
              aria-current={r.name === resource.name}
              onClick={() => setResource(r)}
            >
              {t(r.labelKey)}
            </Button>
          ))}
        </nav>

        <ResourcePanel key={resource.name} resource={resource} />
      </div>
    </FeatureGate>
  );
}

/** The list + editing surface for one selected resource. */
function ResourcePanel({ resource }: { resource: MdResource }): ReactNode {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MasterDataItem | null>(null);

  const flash = useCallback((text: string): void => toast.show(text), [toast]);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listItems(resource.name, { active: "all" });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [resource.name]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listItems(resource.name, { active: "all", cursor: state.nextCursor });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const onCreate = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const created = await createItem(resource.name, body);
      setState((s) => (s.kind === "ready" ? { ...s, items: [created, ...s.items] } : s));
      setCreating(false);
      flash(t("md.saved"));
      return true;
    } catch {
      flash(t("md.saveFailed"));
      return false;
    }
  };

  const onUpdate = async (id: string, body: Record<string, unknown>): Promise<boolean> => {
    try {
      const updated = await updateItem(resource.name, id, body);
      setState((s) =>
        s.kind === "ready" ? { ...s, items: s.items.map((i) => (i.id === id ? updated : i)) } : s,
      );
      setEditingId(null);
      setSelectedItem((it) => (it !== null && it.id === id ? updated : it));
      flash(t("md.saved"));
      return true;
    } catch {
      flash(t("md.saveFailed"));
      return false;
    }
  };

  const onDeactivate = async (id: string): Promise<void> => {
    try {
      await deactivateItem(resource.name, id);
      setState((s) =>
        s.kind === "ready"
          ? { ...s, items: s.items.map((i) => (i.id === id ? { ...i, active: false } : i)) }
          : s,
      );
      setSelectedItem((it) => (it !== null && it.id === id ? { ...it, active: false } : it));
      flash(t("md.saved"));
    } catch {
      flash(t("md.saveFailed"));
    }
  };

  const columns = useMemo(() => buildMdColumns({ t, resource }), [t, resource]);

  /** The card-or-edit-form for one item — shared by the mobile list and the desktop detail panel. */
  const renderItemDetail = (item: MasterDataItem): ReactNode =>
    editingId === item.id ? (
      <ItemForm
        resource={resource}
        item={item}
        onSubmit={(body) => onUpdate(item.id, body)}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <ItemCard
        resource={resource}
        item={item}
        onEdit={() => setEditingId(item.id)}
        onDeactivate={() => void onDeactivate(item.id)}
      />
    );

  return (
    <section className="flex flex-col gap-4">
      {resource.editable ? (
        <PermissionGate permission="master-data.manage">
          <div>
            {creating ? (
              <ItemForm
                resource={resource}
                onSubmit={onCreate}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <Button size="sm" onClick={() => setCreating(true)}>
                {t("md.actions.create")}
              </Button>
            )}
          </div>
        </PermissionGate>
      ) : (
        <p className="text-sm text-muted-foreground">{t("md.readOnly")}</p>
      )}

      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<MasterDataItem>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={setSelectedItem}
            emptyState={<EmptyState title={t("md.empty")} />}
          />
        ) : (
          <MobileCardList<MasterDataItem>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderItemDetail}
            emptyTitle={t("md.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("md.loadMore")}
          />
        )
      ) : null}

      <DetailPanel
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItem(null);
            setEditingId(null);
          }
        }}
        title={selectedItem === null ? "" : fieldText(selectedItem, "name")}
        sections={
          selectedItem === null
            ? []
            : [
                {
                  key: "details",
                  label: t(resource.labelKey),
                  content: renderItemDetail(selectedItem),
                },
              ]
        }
      />
    </section>
  );
}

/** A read row: the resource's fields plus a status badge and (if editable) actions. */
function ItemCard({
  resource,
  item,
  onEdit,
  onDeactivate,
}: {
  resource: MdResource;
  item: MasterDataItem;
  onEdit: () => void;
  onDeactivate: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>{fieldText(item, "name")}</span>
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
            data-testid="status"
          >
            {item.active ? t("md.status.active") : t("md.status.inactive")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {resource.fields
            .filter((f) => f.name !== "name")
            .map((f) => (
              <div key={f.name} className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{t(f.labelKey)}</dt>
                <dd>{displayValue(item, f, t) || "—"}</dd>
              </div>
            ))}
        </dl>
        {resource.editable ? (
          <PermissionGate permission="master-data.manage">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onEdit}>
                {t("md.actions.edit")}
              </Button>
              {item.active ? (
                <Button size="sm" variant="ghost" onClick={onDeactivate}>
                  {t("md.actions.deactivate")}
                </Button>
              ) : null}
            </div>
          </PermissionGate>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A create/edit form for one resource, driven by its field list. */
function ItemForm({
  resource,
  item,
  onSubmit,
  onCancel,
}: {
  resource: MdResource;
  item?: MasterDataItem;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(resource.fields.map((f) => [f.name, item ? fieldText(item, f.name) : ""])),
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    const body: Record<string, unknown> = {};
    for (const field of resource.fields) {
      const raw = values[field.name]?.trim() ?? "";
      if (raw.length === 0) {
        // On create, skip empty optional fields; on update, an emptied optional clears it.
        if (item !== undefined && field.required !== true) body[field.name] = null;
        continue;
      }
      body[field.name] = raw;
    }
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {resource.fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1">
              <Label htmlFor={`md-${field.name}`}>
                {t(field.labelKey)}
                {field.required === true ? " *" : ""}
              </Label>
              <FieldInput
                field={field}
                value={values[field.name] ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={submitting} onClick={() => void submit()}>
            {t("md.actions.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("md.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** A single field input — a select for enum fields, a text input otherwise. */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: MdField;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  const { t } = useI18n();
  if (field.type === "select" && field.options !== undefined) {
    return (
      <select
        id={`md-${field.name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">—</option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {optionLabel(field, opt, t)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      id={`md-${field.name}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t(field.labelKey)}
    />
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

/** The raw string value of an attribute on a row. */
function fieldText(item: MasterDataItem, name: string): string {
  const value = item[name];
  return value === null || value === undefined ? "" : String(value);
}

/** The display value of a field, localizing enum options where relevant. */
function displayValue(item: MasterDataItem, field: MdField, t: Translate): string {
  const raw = fieldText(item, field.name);
  if (raw.length === 0) return "";
  if (field.type === "select") return optionLabel(field, raw, t);
  return raw;
}

/** Localize an order-reason kind; other option sets show the raw value. */
function optionLabel(field: MdField, value: string, t: Translate): string {
  if (field.name === "kind") {
    if (value === "cancellation") return t("md.kind.cancellation");
    if (value === "return") return t("md.kind.return");
    if (value === "general") return t("md.kind.general");
  }
  return value;
}
