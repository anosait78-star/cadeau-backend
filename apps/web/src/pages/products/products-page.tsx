import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FeatureGate } from "@/components/access/feature-gate";
import { PermissionGate } from "@/components/access/permission-gate";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { DetailPanel } from "@/components/detail-panel/detail-panel";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { TableToolbar } from "@/components/table-toolbar/table-toolbar";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listItems, type MasterDataItem } from "@/features/master-data/master-data-api";
import {
  archiveProduct,
  createProduct,
  createVariant,
  listProducts,
  listVariants,
  updateProduct,
  updateVariant,
  type Product,
  type ProductInput,
  type ProductVariant,
  type VariantInput,
} from "@/features/products/products-api";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/i18n-provider";
import { buildProductColumns } from "./products-columns";

/** A `{ id → name }` lookup for a reference collection (categories, units). */
type NameMap = ReadonlyMap<string, string>;

/** A reference option for a select control. */
interface RefOption {
  readonly id: string;
  readonly name: string;
}

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly items: Product[]; readonly nextCursor: string | null };

/**
 * Products — the catalog screen. The whole page is behind the `products`
 * feature; create/edit/archive and variant management are behind
 * `products.manage` (the API re-checks both — ADR-003). One responsive card list
 * serves both shells (the card alternative required by ADR-002). Categories and
 * units come from the EPIC-7 master data.
 */
export function ProductsPage(): ReactNode {
  const { t } = useI18n();
  return (
    <FeatureGate
      feature="products"
      fallback={
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
          <EmptyState title={t("products.forbidden")} />
        </div>
      }
    >
      <ProductsScreen />
    </FeatureGate>
  );
}

function ProductsScreen(): ReactNode {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const [categories, setCategories] = useState<RefOption[]>([]);
  const [units, setUnits] = useState<RefOption[]>([]);

  const flash = useCallback((text: string): void => toast.show(text), [toast]);

  const load = useCallback(async (q: string): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const page = await listProducts({ active: "all", ...(q.length > 0 ? { q } : {}) });
      setState({ kind: "ready", items: page.data, nextCursor: page.page.nextCursor });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  // Load the category/unit reference sets once (best-effort — selects still work empty).
  useEffect(() => {
    const toOptions = (rows: MasterDataItem[]): RefOption[] =>
      rows.map((r) => ({ id: r.id, name: String(r["name"] ?? "") }));
    void listItems("product-categories", { active: true })
      .then((p) => setCategories(toOptions(p.data)))
      .catch(() => setCategories([]));
    void listItems("units", { active: true })
      .then((p) => setUnits(toOptions(p.data)))
      .catch(() => setUnits([]));
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const categoryNames: NameMap = new Map(categories.map((c) => [c.id, c.name]));
  const unitNames: NameMap = new Map(units.map((u) => [u.id, u.name]));

  const onSearch = (): void => {
    void load(search.trim());
  };

  const loadMore = async (): Promise<void> => {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    const q = search.trim();
    const page = await listProducts({
      active: "all",
      cursor: state.nextCursor,
      ...(q.length > 0 ? { q } : {}),
    });
    setState({
      kind: "ready",
      items: [...state.items, ...page.data],
      nextCursor: page.page.nextCursor,
    });
  };

  const onCreate = async (body: ProductInput): Promise<void> => {
    try {
      const created = await createProduct(body);
      setState((s) => (s.kind === "ready" ? { ...s, items: [created, ...s.items] } : s));
      setCreating(false);
      flash(t("products.saved"));
    } catch {
      flash(t("products.saveFailed"));
    }
  };

  const onUpdate = async (id: string, body: ProductInput): Promise<void> => {
    try {
      const updated = await updateProduct(id, body);
      setState((s) =>
        s.kind === "ready" ? { ...s, items: s.items.map((i) => (i.id === id ? updated : i)) } : s,
      );
      setEditingId(null);
      setSelectedProduct((p) => (p !== null && p.id === id ? updated : p));
      flash(t("products.saved"));
    } catch {
      flash(t("products.saveFailed"));
    }
  };

  const onArchive = async (id: string): Promise<void> => {
    try {
      await archiveProduct(id);
      setState((s) =>
        s.kind === "ready"
          ? { ...s, items: s.items.map((i) => (i.id === id ? { ...i, active: false } : i)) }
          : s,
      );
      setSelectedProduct((p) => (p !== null && p.id === id ? { ...p, active: false } : p));
      flash(t("products.saved"));
    } catch {
      flash(t("products.saveFailed"));
    }
  };

  const columns = useMemo(
    () => buildProductColumns({ t, categoryNames, unitNames }),
    [t, categoryNames, unitNames],
  );

  /** The card-or-edit-form for one product — shared by the mobile list and the desktop detail panel. */
  const renderProductDetail = (product: Product): ReactNode =>
    editingId === product.id ? (
      <ProductForm
        product={product}
        categories={categories}
        units={units}
        onSubmit={(body) => onUpdate(product.id, body)}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <ProductCard
        product={product}
        categoryNames={categoryNames}
        unitNames={unitNames}
        onEdit={() => setEditingId(product.id)}
        onArchive={() => void onArchive(product.id)}
        onNotify={flash}
      />
    );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("products.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("products.subtitle")}</p>
      </header>

      <TableToolbar
        search={{
          value: search,
          onChange: setSearch,
          onSubmit: onSearch,
          placeholder: t("products.search.placeholder"),
          label: t("products.search.label"),
        }}
        secondaryActions={
          <Button variant="outline" onClick={onSearch}>
            {t("products.search.submit")}
          </Button>
        }
        primaryActions={
          <PermissionGate permission="products.manage">
            {creating ? null : (
              <Button onClick={() => setCreating(true)}>{t("products.actions.create")}</Button>
            )}
          </PermissionGate>
        }
      />

      {creating ? (
        <PermissionGate permission="products.manage">
          <ProductForm
            categories={categories}
            units={units}
            onSubmit={onCreate}
            onCancel={() => setCreating(false)}
          />
        </PermissionGate>
      ) : null}

      {state.kind === "error" ? <ErrorState onRetry={() => void load(search.trim())} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<Product>
            columns={columns}
            rows={state.kind === "ready" ? state.items : []}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            onRowClick={setSelectedProduct}
            emptyState={<EmptyState title={t("products.empty")} />}
          />
        ) : (
          <MobileCardList<Product>
            items={state.kind === "ready" ? state.items : []}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={renderProductDetail}
            emptyTitle={t("products.empty")}
            hasMore={state.kind === "ready" && state.nextCursor !== null}
            onLoadMore={loadMore}
            loadMoreLabel={t("products.loadMore")}
          />
        )
      ) : null}

      <DetailPanel
        open={selectedProduct !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedProduct(null);
            setEditingId(null);
          }
        }}
        title={selectedProduct?.name ?? ""}
        sections={
          selectedProduct === null
            ? []
            : [
                {
                  key: "details",
                  label: t("products.title"),
                  content: renderProductDetail(selectedProduct),
                },
              ]
        }
      />
    </div>
  );
}

/** A product row: attributes, status, actions, and an expandable variants panel. */
function ProductCard({
  product,
  categoryNames,
  unitNames,
  onEdit,
  onArchive,
  onNotify,
}: {
  product: Product;
  categoryNames: NameMap;
  unitNames: NameMap;
  onEdit: () => void;
  onArchive: () => void;
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [showVariants, setShowVariants] = useState(false);
  const dash = "—";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>{product.name}</span>
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
            data-testid="status"
          >
            {product.active ? t("products.status.active") : t("products.status.inactive")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("products.field.category")}</dt>
            <dd>{(product.categoryId && categoryNames.get(product.categoryId)) || dash}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("products.field.unit")}</dt>
            <dd>{(product.unitId && unitNames.get(product.unitId)) || dash}</dd>
          </div>
          <div className="col-span-2 flex flex-col sm:col-span-3">
            <dt className="text-xs text-muted-foreground">{t("products.field.description")}</dt>
            <dd>{product.description ?? dash}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowVariants((v) => !v)}>
            {t("products.variants.toggle")}
          </Button>
          <PermissionGate permission="products.manage">
            <Button size="sm" variant="outline" onClick={onEdit}>
              {t("products.actions.edit")}
            </Button>
            {product.active ? (
              <Button size="sm" variant="ghost" onClick={onArchive}>
                {t("products.actions.archive")}
              </Button>
            ) : null}
          </PermissionGate>
        </div>

        {showVariants ? <VariantsPanel productId={product.id} onNotify={onNotify} /> : null}
      </CardContent>
    </Card>
  );
}

/** The variants list + add/edit surface for one product (lazy-loaded on expand). */
function VariantsPanel({
  productId,
  onNotify,
}: {
  productId: string;
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [variants, setVariants] = useState<ProductVariant[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      const res = await listVariants(productId);
      setVariants(res.data);
    } catch {
      setFailed(true);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = async (body: VariantInput): Promise<void> => {
    try {
      const created = await createVariant(productId, body);
      setVariants((vs) => [...(vs ?? []), created]);
      setAdding(false);
      onNotify(t("products.saved"));
    } catch {
      onNotify(t("products.saveFailed"));
    }
  };

  const onEdit = async (variantId: string, body: VariantInput): Promise<void> => {
    try {
      const updated = await updateVariant(productId, variantId, body);
      setVariants((vs) => (vs ?? []).map((v) => (v.id === variantId ? updated : v)));
      setEditingId(null);
      onNotify(t("products.saved"));
    } catch {
      onNotify(t("products.saveFailed"));
    }
  };

  return (
    <section
      className="mt-1 flex flex-col gap-2 border-t border-border pt-3"
      aria-label={t("products.variants.title")}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("products.variants.title")}</h3>
        <PermissionGate permission="products.manage">
          {adding ? null : (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              {t("products.variants.add")}
            </Button>
          )}
        </PermissionGate>
      </div>

      {failed ? <ErrorState onRetry={() => void load()} /> : null}

      {adding ? (
        <PermissionGate permission="products.manage">
          <VariantForm onSubmit={onAdd} onCancel={() => setAdding(false)} />
        </PermissionGate>
      ) : null}

      {variants !== null && variants.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{t("products.variants.empty")}</p>
      ) : null}

      {variants !== null && variants.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {variants.map((variant) => (
            <li key={variant.id}>
              {editingId === variant.id ? (
                <VariantForm
                  variant={variant}
                  onSubmit={(body) => onEdit(variant.id, body)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {variant.name}
                      {variant.active ? "" : ` (${t("products.status.inactive")})`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("products.variant.field.sku")}: {variant.sku ?? "—"} ·{" "}
                      {t("products.variant.field.barcode")}: {variant.barcode ?? "—"}
                    </span>
                  </div>
                  <PermissionGate permission="products.manage">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(variant.id)}>
                      {t("products.actions.edit")}
                    </Button>
                  </PermissionGate>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Create/edit form for a product. */
function ProductForm({
  product,
  categories,
  units,
  onSubmit,
  onCancel,
}: {
  product?: Product;
  categories: readonly RefOption[];
  units: readonly RefOption[];
  onSubmit: (body: ProductInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [unitId, setUnitId] = useState(product?.unitId ?? "");
  const [allowOversell, setAllowOversell] = useState(product?.allowOversell ?? false);
  const [submitting, setSubmitting] = useState(false);
  const editing = product !== undefined;

  const submit = async (): Promise<void> => {
    const body: ProductInput = {
      name: name.trim(),
      // On edit an emptied optional clears it (null); on create, omit empties.
      ...(description.trim().length > 0
        ? { description: description.trim() }
        : editing
          ? { description: null }
          : {}),
      ...(categoryId.length > 0 ? { categoryId } : editing ? { categoryId: null } : {}),
      ...(unitId.length > 0 ? { unitId } : editing ? { unitId: null } : {}),
      allowOversell,
    };
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  const nameInvalid = name.trim().length === 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-name">{t("products.field.name")} *</Label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("products.field.name")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-category">{t("products.field.category")}</Label>
            <RefSelect
              id="product-category"
              value={categoryId}
              options={categories}
              onChange={setCategoryId}
              ariaLabel={t("products.field.category")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="product-unit">{t("products.field.unit")}</Label>
            <RefSelect
              id="product-unit"
              value={unitId}
              options={units}
              onChange={setUnitId}
              ariaLabel={t("products.field.unit")}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="product-description">{t("products.field.description")}</Label>
            <Input
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label={t("products.field.description")}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowOversell}
            onChange={(e) => setAllowOversell(e.target.checked)}
          />
          {t("products.field.allowOversell")}
        </label>
        <div className="flex gap-2">
          <Button size="sm" disabled={submitting || nameInvalid} onClick={() => void submit()}>
            {t("products.actions.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("products.actions.cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Create/edit form for a variant. */
function VariantForm({
  variant,
  onSubmit,
  onCancel,
}: {
  variant?: ProductVariant;
  onSubmit: (body: VariantInput) => void | Promise<void>;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [name, setName] = useState(variant?.name ?? "");
  const [sku, setSku] = useState(variant?.sku ?? "");
  const [barcode, setBarcode] = useState(variant?.barcode ?? "");
  const [active, setActive] = useState(variant?.active ?? true);
  const [submitting, setSubmitting] = useState(false);
  const editing = variant !== undefined;

  const submit = async (): Promise<void> => {
    const body: VariantInput = {
      name: name.trim(),
      ...(sku.trim().length > 0 ? { sku: sku.trim() } : editing ? { sku: null } : {}),
      ...(barcode.trim().length > 0
        ? { barcode: barcode.trim() }
        : editing
          ? { barcode: null }
          : {}),
      ...(editing ? { active } : {}),
    };
    setSubmitting(true);
    await onSubmit(body);
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="variant-name">{t("products.variant.field.name")} *</Label>
          <Input
            id="variant-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("products.variant.field.name")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="variant-sku">{t("products.variant.field.sku")}</Label>
          <Input
            id="variant-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            aria-label={t("products.variant.field.sku")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="variant-barcode">{t("products.variant.field.barcode")}</Label>
          <Input
            id="variant-barcode"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            aria-label={t("products.variant.field.barcode")}
          />
        </div>
      </div>
      {editing ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("products.status.active")}
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={submitting || name.trim().length === 0}
          onClick={() => void submit()}
        >
          {t("products.actions.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("products.actions.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** A select over a reference collection, with a blank (“none”) option. */
function RefSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id: string;
  value: string;
  options: readonly RefOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}): ReactNode {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="">—</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}
