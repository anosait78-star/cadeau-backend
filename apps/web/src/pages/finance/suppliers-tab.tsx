import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  archiveSupplier,
  createSupplier,
  listSuppliers,
  updateSupplier,
  type Supplier,
  type SupplierInput,
} from "@/features/finance/finance-api";
import { useI18n } from "@/i18n/i18n-provider";
import { DASH, Field } from "./finance-shared";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: Supplier[]; readonly nextCursor: string | null };

/** Suppliers — simple reference entity CRUD with keyset pagination (EPIC-13). */
export function SuppliersTab({ onNotify }: { onNotify: (text: string) => void }): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listSuppliers({
        active: activeOnly ? true : "all",
        ...(search.trim().length > 0 ? { q: search.trim() } : {}),
      });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, [activeOnly, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const page = await listSuppliers({
      cursor: state.nextCursor,
      active: activeOnly ? true : "all",
      ...(search.trim().length > 0 ? { q: search.trim() } : {}),
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const save = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      setCreating(false);
      setEditingId(null);
      onNotify(t("finance.saved"));
      await load();
    } catch {
      onNotify(t("finance.saveFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Input
            aria-label={t("finance.suppliers.search.placeholder")}
            placeholder={t("finance.suppliers.search.placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          {t("finance.suppliers.filter.activeOnly")}
        </label>
        <PermissionGate permission="finance.manage">
          {creating ? null : (
            <Button onClick={() => setCreating(true)}>{t("finance.actions.create")}</Button>
          )}
        </PermissionGate>
      </div>

      {creating ? (
        <PermissionGate permission="finance.manage">
          <SupplierForm
            onSubmit={(body) => save(() => createSupplier(body))}
            onCancel={() => setCreating(false)}
          />
        </PermissionGate>
      ) : null}

      {state.kind === "loading" ? <LoadingState /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} /> : null}
      {state.kind === "ready" && state.items.length === 0 ? (
        <EmptyState title={t("finance.suppliers.empty")} />
      ) : null}

      {state.kind === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {state.items.map((item) => (
            <li key={item.id}>
              {editingId === item.id ? (
                <SupplierForm
                  supplier={item}
                  onSubmit={(body) => save(() => updateSupplier(item.id, body))}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <SupplierCard
                  supplier={item}
                  onEdit={() => setEditingId(item.id)}
                  onArchive={() => void save(() => archiveSupplier(item.id))}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {state.kind === "ready" && state.nextCursor !== null ? (
        <Button variant="outline" onClick={() => void loadMore()} className="self-center">
          {t("finance.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

function SupplierCard({
  supplier,
  onEdit,
  onArchive,
}: {
  supplier: Supplier;
  onEdit: () => void;
  onArchive: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{supplier.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {supplier.active ? t("finance.status.active") : t("finance.status.inactive")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.suppliers.field.phone")}</dt>
            <dd>{supplier.phone ?? DASH}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.suppliers.field.email")}</dt>
            <dd>{supplier.email ?? DASH}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">
              {t("finance.suppliers.field.address")}
            </dt>
            <dd>{supplier.address ?? DASH}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("finance.suppliers.field.taxId")}</dt>
            <dd>{supplier.taxId ?? DASH}</dd>
          </div>
        </dl>
        <PermissionGate permission="finance.manage">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t("finance.actions.edit")}
            </Button>
            {supplier.active ? (
              <Button size="sm" variant="ghost" onClick={onArchive}>
                {t("finance.actions.archive")}
              </Button>
            ) : null}
          </div>
        </PermissionGate>
      </CardContent>
    </Card>
  );
}

function SupplierForm({
  supplier,
  onSubmit,
  onCancel,
}: {
  supplier?: Supplier;
  onSubmit: (body: SupplierInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [taxId, setTaxId] = useState(supplier?.taxId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const editing = supplier !== undefined;

  const submit = async (): Promise<void> => {
    const body: SupplierInput = {
      name: name.trim(),
      ...(phone.trim().length > 0 ? { phone: phone.trim() } : editing ? { phone: null } : {}),
      ...(email.trim().length > 0 ? { email: email.trim() } : editing ? { email: null } : {}),
      ...(address.trim().length > 0
        ? { address: address.trim() }
        : editing
          ? { address: null }
          : {}),
      ...(taxId.trim().length > 0 ? { taxId: taxId.trim() } : editing ? { taxId: null } : {}),
    };
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="supplier-name" label={`${t("finance.suppliers.field.name")} *`}>
            <Input
              id="supplier-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("finance.suppliers.field.name")}
            />
          </Field>
          <Field id="supplier-phone" label={t("finance.suppliers.field.phone")}>
            <Input
              id="supplier-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-label={t("finance.suppliers.field.phone")}
            />
          </Field>
          <Field id="supplier-email" label={t("finance.suppliers.field.email")}>
            <Input
              id="supplier-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label={t("finance.suppliers.field.email")}
            />
          </Field>
          <Field id="supplier-taxid" label={t("finance.suppliers.field.taxId")}>
            <Input
              id="supplier-taxid"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              aria-label={t("finance.suppliers.field.taxId")}
            />
          </Field>
          <Field id="supplier-address" label={t("finance.suppliers.field.address")} wide>
            <Input
              id="supplier-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-label={t("finance.suppliers.field.address")}
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={submitting || name.trim().length === 0}
            onClick={() => void submit()}
          >
            {t("finance.actions.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("finance.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
