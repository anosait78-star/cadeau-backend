import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PermissionGate } from "@/components/access/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { Button } from "@/components/ui/button";
import { StarRatingDisplay } from "@/components/ui/star-rating";
import type { OrderStatus } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ReviewFormDialog } from "./review-form";
import { getOrderReview, type OrderReview } from "./reviews-api";

/** Order statuses a review may be attached to. */
const REVIEWABLE_ORDER_STATUSES = new Set<OrderStatus>(["delivered", "completed"]);

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly review: OrderReview };

/**
 * The customer-review section of an order's detail panel. A review is
 * create-only and entirely optional — an order sitting in delivered/completed
 * forever with no review is a normal state, not something flagged here.
 */
export function ReviewSection({
  orderId,
  orderStatus,
  onNotify,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  onNotify: (text: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [formOpen, setFormOpen] = useState(false);
  const isReviewable = REVIEWABLE_ORDER_STATUSES.has(orderStatus);

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const review = await getOrderReview(orderId);
      setState(review === null ? { kind: "none" } : { kind: "ready", review });
    } catch {
      setState({ kind: "error" });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">{t("review.section.title")}</h3>

      {state.kind === "loading" ? <LoadingState className="p-4" /> : null}
      {state.kind === "error" ? <ErrorState onRetry={() => void load()} className="p-4" /> : null}

      {state.kind === "none" ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{t("review.none")}</p>
          {isReviewable ? (
            <PermissionGate permission="orders.manage">
              <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
                {t("review.actions.add")}
              </Button>
            </PermissionGate>
          ) : null}
        </div>
      ) : null}

      {state.kind === "ready" ? <ReviewDisplay review={state.review} /> : null}

      <ReviewFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        orderId={orderId}
        onCreated={(review) => {
          setState({ kind: "ready", review });
          setFormOpen(false);
          onNotify(t("review.saved"));
        }}
      />
    </div>
  );
}

/** A saved review, read-only — immutable, so no edit action is ever offered. */
function ReviewDisplay({ review }: { review: OrderReview }): ReactNode {
  const { t } = useI18n();
  const rows: readonly [string, number, string | null][] = [
    [t("review.field.quality"), review.qualityRating, review.qualityLowReason],
    [t("review.field.packaging"), review.packagingRating, review.packagingLowReason],
    [t("review.field.shipping"), review.shippingRating, review.shippingLowReason],
  ];
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">
          {t(`review.productType.${review.productType}` as TranslationKey)}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-muted-foreground">{t("review.field.average")}</span>
          <StarRatingDisplay value={review.averageRating} size="md" />
        </div>
      </div>

      {review.productType === "gifts" ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
          <div className="flex flex-col">
            <dt className="text-caption text-muted-foreground">
              {t("review.field.giftRecipientName")}
            </dt>
            <dd>{review.giftRecipientName}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-caption text-muted-foreground">
              {t("review.field.giftRecipientRelation")}
            </dt>
            <dd>{review.giftRecipientRelation}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-caption text-muted-foreground">{t("review.field.giftOccasion")}</dt>
            <dd>{review.giftOccasion}</dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-col gap-2">
        {rows.map(([label, rating, lowReason]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{label}</span>
              <StarRatingDisplay value={rating} />
            </div>
            {lowReason !== null ? (
              <p className="text-caption text-muted-foreground">{lowReason}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
