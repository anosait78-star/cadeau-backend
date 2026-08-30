import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DetailPanelSection } from "@/components/detail-panel/detail-panel";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/access/permission-gate";
import { StatusBadge } from "@/components/status-badge/status-badge";
import { ProgressRing } from "@/components/ui/progress-ring";
import { StatusStepper } from "@/components/ui/status-stepper";
import {
  Check,
  CheckCircle2,
  Circle,
  ImageOff,
  Loader,
  Mail,
  Package,
  Phone,
  User,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { getCustomer } from "@/features/customers/customers-api";
import { VENDOR_GROUP_STATUS_TONE } from "@/features/vendor/vendor-group-status-tones";
import { VENDOR_GROUP_STATUSES, type VendorGroupStatus } from "@/features/vendor/vendor-api";
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
import { ReviewSection } from "@/features/reviews/review-section";
import { ShipmentSection } from "@/features/shipping/shipment-section";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format-money";
import { ORDER_STATUS_TONE } from "./orders-status-tones";

const DASH = "—";

function formatDate(iso: string | null, locale: string): string {
  if (iso === null) return DASH;
  // The Arabic pattern embeds LRM/RLM marks between the parts; inside an
  // LTR-isolated cell they reorder the date into nonsense ("282026/8/"), so
  // drop them and let the cell's own direction lay the parts out.
  return new Date(iso).toLocaleDateString(locale).replace(/[\u200e\u200f]/g, "");
}

/**
 * "28 أغسطس 2026" — the spelled-out form, for the header and summary.
 * Unlike {@link formatDate} nothing is stripped here: this form renders in
 * the paragraph's own direction, where the locale's marks keep it correct.
 */
function formatLongDate(iso: string | null, locale: string): string {
  if (iso === null) return DASH;
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(iso: string, locale: string): string {
  return new Date(iso)
    .toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
    .replace(/[\u200e\u200f]/g, "");
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

/** Payment-status tone, mirroring the grid's own map so a chip reads the same everywhere. */
const PAYMENT_TONE = {
  paid: "success",
  partial: "warning",
  unpaid: "destructive",
} as const;

/**
 * One label→value line. The workhorse of the drawer: a quiet label on one
 * side, the value on the other, no card chrome — so a group of them reads as
 * a record, not as a form.
 */
function DetailRow({
  label,
  value,
  ltr = false,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  ltr?: boolean;
  /** The line that matters most in its group (a total). */
  emphasis?: boolean;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span
        className={cn(
          "shrink-0 text-[0.8125rem]",
          emphasis ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 text-end",
          emphasis
            ? "text-lg font-bold leading-tight tabular-nums text-foreground"
            : "text-[0.8125rem] font-medium tabular-nums text-foreground",
        )}
        {...(ltr ? { dir: "ltr" } : {})}
      >
        {value}
      </span>
    </div>
  );
}

/** A group of rows, hairline-separated — the drawer's one structural motif. */
function DetailGroup({ children }: { children: ReactNode }): ReactNode {
  return <div className="divide-y divide-border/70">{children}</div>;
}

/** The customer's monogram — a stand-in avatar; customers carry no image. */
function CustomerMonogram({ name, size = "md" }: { name: string; size?: "sm" | "md" }): ReactNode {
  const initial = name.trim().charAt(0);
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary",
        size === "md" ? "h-11 w-11 text-base" : "h-6 w-6 text-[0.6875rem]",
      )}
    >
      {initial.length > 0 ? initial : <User className="h-4 w-4" aria-hidden />}
    </span>
  );
}

/** Monogram + name on one line, for the drawer's pinned header. */
function CustomerIdentity({ name }: { name: string }): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <CustomerMonogram name={name} size="sm" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * The drawer's pinned header decoration for one order: status chip, customer
 * + date line, and the order total as the headline figure. Pure presentation
 * over the already-fetched {@link OrderDetail}.
 */
export function buildOrderDetailHeader({
  detail,
  locale,
  t,
}: {
  detail: OrderDetail;
  locale: string;
  t: (k: TranslationKey) => string;
}): { titleBadge: ReactNode; subtitle: ReactNode; headerExtra: ReactNode } {
  return {
    titleBadge: (
      <StatusBadge
        tone={ORDER_STATUS_TONE[detail.status]}
        label={t(`orders.status.${detail.status}` as TranslationKey)}
        testId="detail-status"
      />
    ),
    subtitle: (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <CustomerIdentity name={detail.customerName} />
        <span aria-hidden className="text-muted-foreground/50">
          ·
        </span>
        <span className="whitespace-nowrap">{formatLongDate(detail.createdAt, locale)}</span>
      </span>
    ),
    headerExtra: (
      <div className="flex items-end justify-between gap-4 rounded-xl bg-muted/50 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {t("orders.field.total")}
          </span>
          <span
            dir="ltr"
            className="truncate text-2xl font-bold leading-none tabular-nums text-foreground"
          >
            {formatMoney(detail.total, locale)}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge
            tone={PAYMENT_TONE[detail.paymentStatus]}
            label={t(`orders.payment.${detail.paymentStatus}` as TranslationKey)}
            testId="detail-payment"
          />
          <span className="text-xs text-muted-foreground">
            {t("orders.field.collected")}{" "}
            <span dir="ltr" className="font-medium tabular-nums text-foreground">
              {formatMoney(detail.collectedAmount, locale)}
            </span>
          </span>
        </div>
      </div>
    ),
  };
}

/** Small caps heading that opens each block of the summary. */
function SectionHeading({ label, trailing }: { label: string; trailing?: ReactNode }): ReactNode {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {trailing}
    </div>
  );
}

/**
 * Customer profile card: identity, the contact details the customer read
 * returns, and the call/WhatsApp actions. The fetch, the phone value and both
 * link targets are exactly what the standalone customer section used — only
 * where they are rendered changed.
 */
function CustomerCard({
  customerId,
  fallbackName,
  t,
}: {
  customerId: string;
  /** The order's own customer-name snapshot, shown until (or instead of) the read. */
  fallbackName: string;
  t: (k: TranslationKey) => string;
}): ReactNode {
  const [phone, setPhone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPhone(null);
    setName(null);
    setEmail(null);
    setFailed(false);
    void getCustomer(customerId)
      .then((c) => {
        setPhone(c.phone);
        setName(c.name);
        setEmail(c.email);
      })
      .catch(() => setFailed(true));
  }, [customerId]);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-start gap-3 p-3.5">
        <CustomerMonogram name={name ?? fallbackName} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-base font-semibold leading-tight text-foreground">
            {name ?? fallbackName}
          </span>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {phone !== null ? (
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span dir="ltr" className="truncate tabular-nums">
                  {phone}
                </span>
              </span>
            ) : failed ? (
              <span>{DASH}</span>
            ) : (
              <span>{t("orders.detail.loadingPhone")}</span>
            )}
            {email !== null && email.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span dir="ltr" className="truncate">
                  {email}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* The actions stay out until the phone is actually known — there is
          nothing to dial or open a chat with before that. */}
      {phone !== null ? (
        <div className="grid grid-cols-2 gap-2 border-t border-border bg-muted/30 p-2.5">
          <a
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-input bg-card text-sm font-medium transition-colors duration-[var(--motion-hover)] hover:bg-muted"
            href={`tel:${phone}`}
          >
            <Phone className="h-4 w-4" aria-hidden />
            {t("orders.detail.call")}
          </a>
          <a
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-success/30 bg-success/10 text-sm font-medium text-success transition-colors duration-[var(--motion-hover)] hover:bg-success/20"
            href={`https://wa.me/${phone.replace(/[^0-9]/g, "")}`}
            target="_blank"
            rel="noreferrer"
          >
            <WhatsAppIcon className="h-4 w-4" aria-hidden />
            {t("orders.detail.whatsapp")}
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** One compact order line for the summary: image, name, quantity, line total. */
function SummaryItemRow({
  item,
  imageUrl,
  locale,
}: {
  item: OrderDetail["items"][number];
  imageUrl: string | null;
  locale: string;
}): ReactNode {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {imageUrl !== null ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="h-11 w-11 shrink-0 rounded-lg border border-border object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground"
        >
          <ImageOff className="h-4 w-4" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium leading-tight">{item.nameSnapshot}</span>
        <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
          {item.quantity} × {formatMoney(item.price, locale)}
        </span>
      </div>
      <span dir="ltr" className="shrink-0 text-sm font-semibold tabular-nums">
        {formatMoney(item.price * item.quantity, locale)}
      </span>
    </li>
  );
}

/**
 * The drawer's landing tab: who the order is for (and how to reach them),
 * what is in it, what it costs, and the order's own metadata — so the common
 * case needs no tab switch at all.
 */
function SummarySection({
  detail,
  itemImages,
  locale,
  t,
}: {
  detail: OrderDetail;
  /** variantId → product image, taken from the vendor groups already loaded. */
  itemImages: ReadonlyMap<string, string>;
  locale: string;
  t: (k: TranslationKey) => string;
}): ReactNode {
  const paymentBadge = (
    <StatusBadge
      tone={PAYMENT_TONE[detail.paymentStatus]}
      label={t(`orders.payment.${detail.paymentStatus}` as TranslationKey)}
    />
  );
  const notes = detail.notes !== null && detail.notes.trim().length > 0 ? detail.notes : null;

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionHeading label={t("orders.form.customer")} />
        <CustomerCard customerId={detail.customerId} fallbackName={detail.customerName} t={t} />
      </section>

      <section>
        <SectionHeading
          label={t("orders.field.items")}
          trailing={
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {detail.items.length}
            </span>
          }
        />
        <ul className="flex flex-col divide-y divide-border/70">
          {detail.items.map((item) => (
            <SummaryItemRow
              key={item.id}
              item={item}
              imageUrl={itemImages.get(item.variantId) ?? null}
              locale={locale}
            />
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading label={t("orders.detail.section.financial")} trailing={paymentBadge} />
        <DetailGroup>
          <DetailRow
            label={t("orders.form.summary.subtotal")}
            value={formatMoney(detail.subtotal, locale)}
            ltr
          />
          <DetailRow
            label={t("orders.form.shipping")}
            value={formatMoney(detail.shippingFee, locale)}
            ltr
          />
          <DetailRow
            label={t("orders.form.discount")}
            value={formatMoney(detail.discount, locale)}
            ltr
          />
          <DetailRow
            label={t("orders.field.total")}
            value={formatMoney(detail.total, locale)}
            ltr
            emphasis
          />
        </DetailGroup>
      </section>

      <section>
        <SectionHeading label={t("orders.detail.section.orderInfo")} />
        <DetailGroup>
          <DetailRow label={t("orders.field.orderNumber")} value={`#${detail.orderNumber}`} ltr />
          <DetailRow
            label={t("orders.status.title")}
            value={
              <StatusBadge
                tone={ORDER_STATUS_TONE[detail.status]}
                label={t(`orders.status.${detail.status}` as TranslationKey)}
              />
            }
          />
          <DetailRow
            label={t("orders.field.createdAt")}
            value={formatLongDate(detail.createdAt, locale)}
          />
          <DetailRow label={t("orders.field.items")} value={detail.itemCount} ltr />
          <DetailRow label={t("orders.field.payment")} value={paymentBadge} />
        </DetailGroup>
      </section>

      {/* Only when the order actually carries a note — an empty block here
          would be noise on the tab that is meant to be read at a glance. */}
      {notes !== null ? (
        <section>
          <SectionHeading label={t("orders.detail.tabs.notes")} />
          <p className="whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-3.5 text-sm leading-relaxed">
            {notes}
          </p>
        </section>
      ) : null}
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
    <div className="flex flex-col gap-4 text-sm">
      <DetailGroup>
        <DetailRow
          label={t("orders.field.assigned")}
          value={
            assignee !== null
              ? (assignee.name ?? assignee.email)
              : t("orders.detail.assignee.unassigned")
          }
        />
      </DetailGroup>
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
    <ul className="flex flex-col divide-y divide-border/70 text-sm">
      {detail.items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 py-3">
          {/* An order line carries no image of its own (`OrderItem` is a
              name/price snapshot), so the thumbnail slot is a neutral mark
              rather than a broken or invented picture. */}
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <Package className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium leading-tight">
              {item.nameSnapshot} × {item.quantity}
            </span>
            {/* The unit price only earns a line when it differs from the line
                total — for a quantity of one it would just repeat it. */}
            {item.quantity > 1 ? (
              <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                {formatMoney(item.price, locale)}
              </span>
            ) : null}
          </div>
          <span dir="ltr" className="shrink-0 font-semibold tabular-nums">
            {formatMoney(item.price * item.quantity, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Local widening of `t` for the vendor-tracking subtree, which needs `{{vars}}` interpolation. */
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** "All vendors delivered" banner, shown only once every vendor group has reached the last stage. */
function VendorTrackingAllDeliveredBanner({
  deliveredCount,
  total,
  t,
}: {
  deliveredCount: number;
  total: number;
  t: Translate;
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-6 text-center">
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
        <CheckCircle2 className="h-7 w-7 text-success" aria-hidden />
      </span>
      <p className="text-base font-bold text-success">
        {t("orders.detail.vendorTracking.allDelivered.title")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("orders.detail.vendorTracking.allDelivered.description")}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-success">
        {t("orders.detail.vendorTracking.progress", { delivered: deliveredCount, total })}
      </p>
    </div>
  );
}

/** Leading state mark for one vendor row: done / in flight / not started. */
function VendorStatusMark({ status }: { status: string }): ReactNode {
  const index = VENDOR_GROUP_STATUSES.indexOf(status as VendorGroupStatus);
  const last = VENDOR_GROUP_STATUSES.length - 1;

  if (index === last) {
    return (
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
      >
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (index > 0) {
    return (
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning"
      >
        <Loader className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <Circle className="h-3.5 w-3.5" />
    </span>
  );
}

/** Order-wide "N of M vendors delivered" card with a progress ring, plus the overall status badge. */
function VendorTrackingOverallCard({
  deliveredCount,
  total,
  aggregateStatus,
  t,
}: {
  deliveredCount: number;
  total: number;
  aggregateStatus: VendorGroupStatus;
  t: Translate;
}): ReactNode {
  const progress = total > 0 ? (deliveredCount / total) * 100 : 0;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/40 p-4">
      <ProgressRing value={progress} size={64} strokeWidth={6}>
        <span className="text-xs font-bold tabular-nums">{Math.round(progress)}%</span>
      </ProgressRing>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm font-semibold leading-tight">
          {t("orders.detail.vendorTracking.progress", { delivered: deliveredCount, total })}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("orders.detail.vendorTracking.overallStatus")}</span>
          <StatusBadge
            testId="vendor-overall-status"
            tone={VENDOR_GROUP_STATUS_TONE[aggregateStatus]}
            label={t(`vendor.group.status.${aggregateStatus}` as TranslationKey)}
          />
        </div>
      </div>
    </div>
  );
}

/** One vendor's card: identity, current status, and its 4-stage progress stepper. */
function VendorGroupCard({
  group,
  locale,
  t,
}: {
  group: OrderVendorGroup;
  locale: string;
  t: Translate;
}): ReactNode {
  const stageIndex = VENDOR_GROUP_STATUSES.indexOf(group.status as VendorGroupStatus);
  const steps = VENDOR_GROUP_STATUSES.map((status) => ({
    key: status,
    label: t(`vendor.group.status.${status}` as TranslationKey),
  }));
  // Reaching the last stage means the vendor is done, not "currently doing
  // the last stage" — push the marker past the end so every step reads as
  // completed instead of leaving delivery looking still in flight.
  const currentIndex = stageIndex === steps.length - 1 ? steps.length : stageIndex;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3 text-sm">
      <div className="flex items-start gap-3">
        <VendorStatusMark status={group.status} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold leading-tight">{group.warehouseName}</span>
          <span className="truncate text-xs text-muted-foreground">
            {group.vendorName ?? t("orders.detail.vendorTracking.noVendor")}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge
            testId={`vendor-group-status-${group.id}`}
            tone={VENDOR_GROUP_STATUS_TONE[group.status as VendorGroupStatus] ?? "neutral"}
            label={t(`vendor.group.status.${group.status}` as TranslationKey)}
          />
          <span className="text-[0.6875rem] text-muted-foreground">
            {t("orders.detail.vendorTracking.itemsCount", { count: group.items.length })}
          </span>
        </div>
      </div>

      <StatusStepper steps={steps} currentIndex={currentIndex} />

      <ul className="flex flex-col divide-y divide-border/70 border-t border-border/70 pt-1">
        {group.items.map((item) => (
          <li key={item.id} className="flex items-center gap-2.5 py-2">
            {item.imageUrl !== null ? (
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                className="h-9 w-9 shrink-0 rounded-lg border border-border object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              >
                <Package className="h-4 w-4" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">
              {item.nameSnapshot} × {item.quantity}
            </span>
            <span dir="ltr" className="shrink-0 font-medium tabular-nums">
              {formatMoney(item.price * item.quantity, locale)}
            </span>
          </li>
        ))}
      </ul>

      <div className="text-xs text-muted-foreground" dir="ltr">
        {t("orders.detail.vendorTracking.updatedAt")} {formatDateTime(group.updatedAt, locale)}
      </div>
    </div>
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
  t: Translate;
}): ReactNode {
  const deliveredCount = groups.filter((g) => g.status === "delivered").length;

  return (
    <div className="flex flex-col gap-3">
      {aggregateStatus !== null ? (
        aggregateStatus === "delivered" ? (
          <VendorTrackingAllDeliveredBanner
            deliveredCount={deliveredCount}
            total={groups.length}
            t={t}
          />
        ) : (
          <VendorTrackingOverallCard
            deliveredCount={deliveredCount}
            total={groups.length}
            aggregateStatus={aggregateStatus}
            t={t}
          />
        )
      ) : null}
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <VendorGroupCard key={group.id} group={group} locale={locale} t={t} />
        ))}
      </div>
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
    <div className="flex flex-col gap-4 text-sm">
      <DetailGroup>
        <DetailRow
          label={t("orders.form.summary.subtotal")}
          value={formatMoney(detail.subtotal, locale)}
          ltr
        />
        <DetailRow
          label={t("orders.form.shipping")}
          value={formatMoney(detail.shippingFee, locale)}
          ltr
        />
        <DetailRow
          label={t("orders.form.discount")}
          value={formatMoney(detail.discount, locale)}
          ltr
        />
        <DetailRow
          label={t("orders.field.total")}
          value={formatMoney(detail.total, locale)}
          ltr
          emphasis
        />
        <DetailRow
          label={t("orders.field.collected")}
          value={formatMoney(detail.collectedAmount, locale)}
          ltr
        />
        <DetailRow
          label={t("orders.field.payment")}
          value={
            <StatusBadge
              tone={PAYMENT_TONE[detail.paymentStatus]}
              label={t(`orders.payment.${detail.paymentStatus}` as TranslationKey)}
            />
          }
        />
      </DetailGroup>
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
    <ul className="flex flex-col text-sm">
      {activity.map((a, index) => (
        <li key={a.id} className="flex gap-3">
          {/* Timeline rail: a dot per entry, joined by a line that stops at
              the last one so the column doesn't dangle. */}
          <div className="flex flex-col items-center">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border" />
            {index < activity.length - 1 ? (
              <span aria-hidden className="w-px flex-1 bg-border" />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pb-4">
            <span className="min-w-0 truncate font-medium text-foreground">
              {a.kind}
              {a.fromValue !== null && a.toValue !== null
                ? `: ${a.fromValue} → ${a.toValue}`
                : a.toValue !== null
                  ? `: ${a.toValue}`
                  : ""}
            </span>
            <span dir="ltr" className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatDate(a.createdAt, locale)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NotesSection({ detail }: { detail: OrderDetail }): ReactNode {
  return (
    <p className="whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed">
      {detail.notes ?? DASH}
    </p>
  );
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
  // Product images live on the vendor-group items (`OrderVendorGroupItem`),
  // not on the order line itself — so when an order is vendor-routed the
  // summary can show the real picture, keyed by variant, with no extra read.
  const itemImages = new Map<string, string>();
  for (const group of vendorGroups) {
    for (const item of group.items) {
      if (item.imageUrl !== null) itemImages.set(item.variantId, item.imageUrl);
    }
  }

  return [
    {
      key: "summary",
      label: t("orders.detail.tabs.summary"),
      content: <SummarySection detail={detail} itemImages={itemImages} locale={locale} t={t} />,
    },
    {
      key: "items",
      label: t("orders.detail.tabs.items"),
      content: <ItemsSection detail={detail} locale={locale} />,
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
      key: "review",
      label: t("orders.detail.tabs.review"),
      content: (
        <ReviewSection orderId={detail.id} orderStatus={detail.status} onNotify={onNotify} />
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
      key: "notes",
      label: t("orders.detail.tabs.notes"),
      content: <NotesSection detail={detail} />,
    },
  ];
}
