import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DetailPanelSection } from "@/components/detail-panel/detail-panel";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/access/permission-gate";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { getCustomer } from "@/features/customers/customers-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import type { VendorGroupStatus } from "@/features/vendor/vendor-api";
import {
  assignOrder,
  getOrder,
  listOrderActivity,
  listOrderVendorGroups,
  updateOrder,
  type OrderActivity,
  type OrderDetail,
  type OrderVendorGroup,
} from "@/features/orders/orders-api";
import { listMembers, type TeamMember } from "@/features/team/team-api";
import { ShipmentSection } from "@/features/shipping/shipment-section";
import type { TranslationKey } from "@/i18n/dictionaries";

const DASH = "—";

function formatMoney(minorUnits: number, locale: string): string {
  return (minorUnits / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null, locale: string): string {
  return iso === null ? DASH : new Date(iso).toLocaleDateString(locale);
}

function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Lazily fetches an order's detail + activity + vendor groups once, keyed by orderId. */
export function useOrderDetailData(orderId: string | null): {
  readonly detail: OrderDetail | null;
  readonly activity: OrderActivity[];
  readonly vendorGroups: OrderVendorGroup[];
  readonly vendorAggregateStatus: VendorGroupStatus | null;
  readonly loading: boolean;
  readonly error: boolean;
  readonly reload: () => void;
  readonly setDetail: (detail: OrderDetail) => void;
} {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [activity, setActivity] = useState<OrderActivity[]>([]);
  const [vendorGroups, setVendorGroups] = useState<OrderVendorGroup[]>([]);
  const [vendorAggregateStatus, setVendorAggregateStatus] = useState<VendorGroupStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (orderId === null) return;
    setLoading(true);
    setError(false);
    try {
      const [d, a, v] = await Promise.all([
        getOrder(orderId),
        listOrderActivity(orderId),
        // Vendor tracking is additive and never blocks the rest of the panel
        // — a caller without visibility into vendor identities (unlikely for
        // anyone who can already open this order) just sees no tab.
        listOrderVendorGroups(orderId).catch(() => ({ data: [], aggregateStatus: null })),
      ]);
      setDetail(d);
      setActivity(a.data);
      setVendorGroups(v.data);
      setVendorAggregateStatus(v.aggregateStatus);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    setDetail(null);
    setActivity([]);
    setVendorGroups([]);
    setVendorAggregateStatus(null);
    void load();
  }, [load]);

  return {
    detail,
    activity,
    vendorGroups,
    vendorAggregateStatus,
    loading,
    error,
    reload: () => void load(),
    setDetail,
  };
}

function SummarySection({
  detail,
  locale,
  t,
}: {
  detail: OrderDetail;
  locale: string;
  t: (k: TranslationKey) => string;
}): ReactNode {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">{t("orders.field.orderNumber")}</dt>
        <dd>#{detail.orderNumber}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("orders.status.title")}</dt>
        <dd>{t(`orders.status.${detail.status}` as TranslationKey)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("orders.field.total")}</dt>
        <dd dir="ltr">{formatMoney(detail.total, locale)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("orders.field.collected")}</dt>
        <dd dir="ltr">{formatMoney(detail.collectedAmount, locale)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("orders.field.payment")}</dt>
        <dd>{t(`orders.payment.${detail.paymentStatus}` as TranslationKey)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("orders.field.createdAt")}</dt>
        <dd dir="ltr">{formatDate(detail.createdAt, locale)}</dd>
      </div>
    </dl>
  );
}

function CustomerSection({
  customerId,
  t,
}: {
  customerId: string;
  t: (k: TranslationKey) => string;
}): ReactNode {
  const [phone, setPhone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPhone(null);
    setName(null);
    setFailed(false);
    void getCustomer(customerId)
      .then((c) => {
        setPhone(c.phone);
        setName(c.name);
      })
      .catch(() => setFailed(true));
  }, [customerId]);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">{t("orders.form.customer")}</p>
        <p>{name ?? DASH}</p>
      </div>
      {failed ? (
        <p className="text-xs text-muted-foreground">{DASH}</p>
      ) : phone === null ? (
        <p className="text-xs text-muted-foreground">{t("orders.detail.loadingPhone")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2" dir="ltr">
          <span>{phone}</span>
          <a
            className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
            href={`tel:${phone}`}
          >
            {t("orders.detail.call")}
          </a>
          <a
            className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
            href={`https://wa.me/${phone.replace(/[^0-9]/g, "")}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("orders.detail.whatsapp")}
          </a>
        </div>
      )}
    </div>
  );
}

const UNASSIGNED = "__unassigned__";

/** Who the order is assigned to, with a member picker for `orders.assign` holders. */
function AssigneeSection({
  detail,
  companyId,
  t,
  onNotify,
  onPatch,
}: {
  detail: OrderDetail;
  companyId: string | null;
  t: (k: TranslationKey) => string;
  onNotify: (text: string) => void;
  onPatch: (order: OrderDetail) => void;
}): ReactNode {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (companyId === null) return;
    listMembers(companyId)
      .then(({ data }) => setMembers(data))
      .catch(() => setMembers([]));
  }, [companyId]);

  const assignee = members.find((m) => m.id === detail.assigneeId) ?? null;

  const onAssign = async (value: string): Promise<void> => {
    setPending(true);
    try {
      const updated = await assignOrder(detail.id, value === UNASSIGNED ? null : value);
      onPatch(updated);
      onNotify(t("orders.saved"));
    } catch {
      onNotify(t("orders.saveFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">{t("orders.field.assigned")}</p>
        <p>
          {assignee !== null
            ? (assignee.name ?? assignee.email)
            : t("orders.detail.assignee.unassigned")}
        </p>
      </div>
      <PermissionGate permission="orders.assign">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`assignee-${detail.id}`}>{t("orders.detail.assignee.change")}</Label>
          <Combobox
            id={`assignee-${detail.id}`}
            ariaLabel={t("orders.detail.assignee.change")}
            value={detail.assigneeId ?? UNASSIGNED}
            onChange={(value) => void onAssign(value)}
            disabled={pending}
            options={[
              { value: UNASSIGNED, label: t("orders.detail.assignee.unassigned") },
              ...members.map((m) => ({ value: m.id, label: m.name ?? m.email })),
            ]}
          />
        </div>
      </PermissionGate>
    </div>
  );
}

function ItemsSection({ detail, locale }: { detail: OrderDetail; locale: string }): ReactNode {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {detail.items.map((item) => (
        <li key={item.id} className="flex justify-between gap-2">
          <span>
            {item.nameSnapshot} × {item.quantity}
          </span>
          <span dir="ltr">{formatMoney(item.price * item.quantity, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "تتبع الطلب" (Vendor Accounts, Phase 4): per-vendor breakdown of a
 * multi-vendor order, read from the same endpoint the vendor's own status
 * changes land in — nothing here is computed client-side. Only ever rendered
 * when the order actually has vendor groups (see {@link buildOrderDetailSections}),
 * so a normal single-warehouse order shows no trace of this tab.
 */
function VendorTrackingSection({
  groups,
  aggregateStatus,
  locale,
  t,
}: {
  groups: OrderVendorGroup[];
  aggregateStatus: VendorGroupStatus | null;
  locale: string;
  t: (k: TranslationKey) => string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {aggregateStatus !== null ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <span className="font-medium">{t("orders.detail.vendorTracking.overallStatus")}</span>
          <StatusBadge
            tone={VENDOR_GROUP_STATUS_TONE[aggregateStatus]}
            label={t(`vendor.group.status.${aggregateStatus}` as TranslationKey)}
          />
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.id} className="rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{group.warehouseName}</span>
            <StatusBadge
              tone={VENDOR_GROUP_STATUS_TONE[group.status as VendorGroupStatus] ?? "neutral"}
              label={t(`vendor.group.status.${group.status}` as TranslationKey)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{group.vendorName ?? t("orders.detail.vendorTracking.noVendor")}</span>
            <span dir="ltr">
              {t("orders.detail.vendorTracking.updatedAt")}{" "}
              {formatDateTime(group.updatedAt, locale)}
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {group.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-2">
                <span>
                  {item.nameSnapshot} × {item.quantity}
                </span>
                <span dir="ltr">{formatMoney(item.price * item.quantity, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PaymentsSection({
  detail,
  locale,
  t,
  onNotify,
  onPatch,
}: {
  detail: OrderDetail;
  locale: string;
  t: (k: TranslationKey) => string;
  onNotify: (text: string) => void;
  onPatch: (order: OrderDetail) => void;
}): ReactNode {
  const [collect, setCollect] = useState("");

  const onCollect = async (): Promise<void> => {
    const minor = Math.round(Number(collect) * 100);
    if (!Number.isFinite(minor) || minor < 0) return;
    try {
      const updated = await updateOrder(detail.id, { collectedAmount: minor });
      onPatch(updated);
      setCollect("");
      onNotify(t("orders.saved"));
    } catch {
      onNotify(t("orders.saveFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("orders.field.total")}</dt>
          <dd dir="ltr">{formatMoney(detail.total, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("orders.field.collected")}</dt>
          <dd dir="ltr">{formatMoney(detail.collectedAmount, locale)}</dd>
        </div>
      </dl>
      <PermissionGate permission="orders.manage">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`collect-${detail.id}`}>{t("orders.detail.collect")}</Label>
            <Input
              id={`collect-${detail.id}`}
              value={collect}
              inputMode="decimal"
              onChange={(e) => setCollect(e.target.value)}
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void onCollect()}>
            {t("orders.actions.save")}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

function ActivitySection({
  activity,
  locale,
}: {
  activity: OrderActivity[];
  locale: string;
}): ReactNode {
  if (activity.length === 0) return <p className="text-sm text-muted-foreground">{DASH}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {activity.map((a) => (
        <li key={a.id} className="flex justify-between gap-2 text-muted-foreground">
          <span>
            {a.kind}
            {a.fromValue !== null && a.toValue !== null
              ? `: ${a.fromValue} → ${a.toValue}`
              : a.toValue !== null
                ? `: ${a.toValue}`
                : ""}
          </span>
          <span dir="ltr">{formatDate(a.createdAt, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

function NotesSection({ detail }: { detail: OrderDetail }): ReactNode {
  return <p className="text-sm">{detail.notes ?? DASH}</p>;
}

/** Builds the 8 Orders-specific DetailPanel sections around one shared fetch. */
export function buildOrderDetailSections({
  detail,
  activity,
  vendorGroups,
  vendorAggregateStatus = null,
  t,
  locale,
  companyId,
  onNotify,
  onPatch,
}: {
  detail: OrderDetail;
  activity: OrderActivity[];
  vendorGroups: OrderVendorGroup[];
  vendorAggregateStatus?: VendorGroupStatus | null;
  t: (k: TranslationKey) => string;
  locale: string;
  companyId: string | null;
  onNotify: (text: string) => void;
  onPatch: (order: OrderDetail) => void;
}): DetailPanelSection[] {
  return [
    {
      key: "summary",
      label: t("orders.detail.tabs.summary"),
      content: <SummarySection detail={detail} locale={locale} t={t} />,
    },
    {
      key: "assignee",
      label: t("orders.detail.tabs.assignee"),
      content: (
        <AssigneeSection
          detail={detail}
          companyId={companyId}
          t={t}
          onNotify={onNotify}
          onPatch={onPatch}
        />
      ),
    },
    {
      key: "customer",
      label: t("orders.detail.tabs.customer"),
      content: <CustomerSection customerId={detail.customerId} t={t} />,
    },
    {
      key: "items",
      label: t("orders.detail.tabs.items"),
      content: <ItemsSection detail={detail} locale={locale} />,
    },
    // Vendor Accounts, Phase 4: only present when this order actually has
    // vendor groups — invisible for every single-warehouse/manual order.
    ...(vendorGroups.length > 0
      ? [
          {
            key: "vendorTracking",
            label: t("orders.detail.tabs.vendorTracking"),
            content: (
              <VendorTrackingSection
                groups={vendorGroups}
                aggregateStatus={vendorAggregateStatus}
                locale={locale}
                t={t}
              />
            ),
          },
        ]
      : []),
    {
      key: "shipping",
      label: t("orders.detail.tabs.shipping"),
      content: (
        <ShipmentSection
          orderId={detail.id}
          customerId={detail.customerId}
          orderStatus={detail.status}
          onNotify={onNotify}
          onOrderPatch={onPatch}
        />
      ),
    },
    {
      key: "payments",
      label: t("orders.detail.tabs.payments"),
      content: (
        <PaymentsSection
          detail={detail}
          locale={locale}
          t={t}
          onNotify={onNotify}
          onPatch={onPatch}
        />
      ),
    },
    {
      key: "activities",
      label: t("orders.detail.tabs.activities"),
      content: <ActivitySection activity={activity} locale={locale} />,
    },
    {
      key: "timeline",
      label: t("orders.detail.tabs.timeline"),
      content: <ActivitySection activity={activity} locale={locale} />,
    },
    {
      key: "notes",
      label: t("orders.detail.tabs.notes"),
      content: <NotesSection detail={detail} />,
    },
  ];
}
