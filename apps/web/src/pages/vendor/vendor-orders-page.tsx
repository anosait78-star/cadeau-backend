import { ArrowDownUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { DataGrid } from "@/components/data-grid/data-grid";
import { MobileCardList } from "@/components/data-grid/mobile-card-list";
import { ErrorState } from "@/components/states/error-state";
import { EmptyState } from "@/components/states/empty-state";
import { ProductThumb } from "@/components/product-thumb/product-thumb";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMyVendorGroups } from "@/features/vendor/use-my-vendor-groups";
import {
  VENDOR_GROUP_STATUSES,
  type VendorGroup,
  type VendorGroupStatus,
} from "@/features/vendor/vendor-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import { useIsDesktop } from "@/hooks/use-media-query";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";
import { VendorLayout } from "./vendor-layout";
import { buildVendorOrderColumns, vendorGroupTotal } from "./vendor-orders-columns";

/**
 * Full orders list for the vendor (Vendor Accounts, Phase 7) — search /
 * status filter / sort / desktop grid + mobile cards, matching the Company
 * Orders screen's experience as closely as makes sense at this data scale.
 * There is no server-side keyset pagination on `/v1/vendor/order-groups`
 * (deliberately: a vendor's own order volume is bounded to one warehouse),
 * so search/filter/sort all run client-side over the one already-scoped
 * fetch — nothing here does the actual isolation; that's the API's job
 * (Phase 3), and is the same call the dashboard and detail screens use.
 */
export function VendorOrdersPage(): ReactNode {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { state, reload } = useMyVendorGroups();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VendorGroupStatus | "all">("all");
  const [newestFirst, setNewestFirst] = useState(true);

  const counts = useMemo(() => {
    const base: Record<VendorGroupStatus, number> = {
      new: 0,
      processing: 0,
      ready: 0,
      delivered: 0,
    };
    if (state.kind !== "ready") return base;
    for (const group of state.groups) base[group.status] += 1;
    return base;
  }, [state]);

  const rows = useMemo(() => {
    if (state.kind !== "ready") return [];
    const term = search.trim();
    return state.groups
      .filter((g) => status === "all" || g.status === status)
      .filter((g) => term.length === 0 || String(g.orderNumber).includes(term))
      .sort((a, b) =>
        newestFirst
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.updatedAt.localeCompare(b.updatedAt),
      );
  }, [state, search, status, newestFirst]);

  const columns = useMemo(() => buildVendorOrderColumns({ t, locale }), [t, locale]);

  const openDetail = (group: VendorGroup): void => {
    void navigate(`/vendor/orders/${group.id}`);
  };

  return (
    <VendorLayout>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("vendor.dashboard.myOrders")}</h1>
        <p className="text-sm text-muted-foreground">{t("vendor.dashboard.subtitle")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("vendor.orders.search.placeholder")}
          className="max-w-64"
          dir="ltr"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNewestFirst((v) => !v)}
          className="gap-1.5"
        >
          <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
          {newestFirst ? t("vendor.orders.sort.newestFirst") : t("vendor.orders.sort.oldestFirst")}
        </Button>
      </div>

      <div
        className="flex flex-wrap gap-1.5 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-xs"
        role="tablist"
        aria-label={t("vendor.dashboard.myOrders")}
      >
        <StatusTab
          label={t("vendor.orders.tabs.all")}
          active={status === "all"}
          count={state.kind === "ready" ? state.groups.length : 0}
          onClick={() => setStatus("all")}
        />
        {VENDOR_GROUP_STATUSES.map((s) => (
          <StatusTab
            key={s}
            label={t(`vendor.group.status.${s}` as TranslationKey)}
            active={status === s}
            count={counts[s]}
            onClick={() => setStatus(s)}
          />
        ))}
      </div>

      {state.kind === "error" ? <ErrorState onRetry={reload} /> : null}

      {state.kind !== "error" ? (
        isDesktop ? (
          <DataGrid<VendorGroup>
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            loading={state.kind === "loading"}
            hasMore={false}
            onLoadMore={() => {}}
            onRowClick={openDetail}
            emptyState={<EmptyState title={t("vendor.dashboard.empty")} />}
          />
        ) : (
          <MobileCardList<VendorGroup>
            items={rows}
            loading={state.kind === "loading"}
            getRowId={(row) => row.id}
            renderCard={(group) => (
              <VendorOrderCard
                group={group}
                t={t}
                locale={locale}
                onOpen={() => openDetail(group)}
              />
            )}
            emptyTitle={t("vendor.dashboard.empty")}
            hasMore={false}
            onLoadMore={() => {}}
            loadMoreLabel=""
          />
        )
      ) : null}
    </VendorLayout>
  );
}

function StatusTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
        )}
        dir="ltr"
      >
        {count}
      </span>
    </button>
  );
}

/** Mobile card row — tapping opens the Vendor Order Detail page. */
function VendorOrderCard({
  group,
  t,
  locale,
  onOpen,
}: {
  group: VendorGroup;
  t: (k: TranslationKey) => string;
  locale: string;
  onOpen: () => void;
}): ReactNode {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="cursor-pointer"
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span dir="ltr">#{group.orderNumber}</span>
          <StatusBadge
            tone={VENDOR_GROUP_STATUS_TONE[group.status]}
            label={t(`vendor.group.status.${group.status}` as TranslationKey)}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <ProductThumb imageUrl={group.items[0]?.imageUrl ?? null} />
        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("orders.field.items")}</dt>
            <dd>{group.items.length}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t("orders.field.total")}</dt>
            <dd dir="ltr">{formatMoney(vendorGroupTotal(group), locale)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
