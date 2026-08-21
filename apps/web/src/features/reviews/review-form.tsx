import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StarRatingInput } from "@/components/ui/star-rating";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import {
  createOrderReview,
  PRODUCT_TYPES,
  type OrderReview,
  type ProductType,
} from "./reviews-api";

/** A rating of 1-2 requires its own reason (mirrors the server's review-rules.ts). */
function requiresLowReason(rating: number): boolean {
  return rating > 0 && rating <= 2;
}

/**
 * The add-review form, opened from {@link ReviewSection}'s "Add review"
 * button. A review is create-only — this dialog never opens for an existing
 * one; `ReviewSection` shows a read-only display instead.
 */
export function ReviewFormDialog({
  open,
  onOpenChange,
  orderId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  onCreated: (review: OrderReview) => void;
}): ReactNode {
  const { t } = useI18n();
  const [productType, setProductType] = useState<ProductType>("clothes");
  const [giftRecipientName, setGiftRecipientName] = useState("");
  const [giftRecipientRelation, setGiftRecipientRelation] = useState("");
  const [giftOccasion, setGiftOccasion] = useState("");
  const [qualityRating, setQualityRating] = useState(0);
  const [qualityLowReason, setQualityLowReason] = useState("");
  const [packagingRating, setPackagingRating] = useState(0);
  const [packagingLowReason, setPackagingLowReason] = useState("");
  const [shippingRating, setShippingRating] = useState(0);
  const [shippingLowReason, setShippingLowReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProductType("clothes");
    setGiftRecipientName("");
    setGiftRecipientRelation("");
    setGiftOccasion("");
    setQualityRating(0);
    setQualityLowReason("");
    setPackagingRating(0);
    setPackagingLowReason("");
    setShippingRating(0);
    setShippingLowReason("");
    setError(null);
  }, [open]);

  const isGift = productType === "gifts";
  const average =
    qualityRating > 0 && packagingRating > 0 && shippingRating > 0
      ? Math.round(((qualityRating + packagingRating + shippingRating) / 3) * 10) / 10
      : null;

  const canSubmit =
    qualityRating > 0 &&
    packagingRating > 0 &&
    shippingRating > 0 &&
    (!requiresLowReason(qualityRating) || qualityLowReason.trim().length > 0) &&
    (!requiresLowReason(packagingRating) || packagingLowReason.trim().length > 0) &&
    (!requiresLowReason(shippingRating) || shippingLowReason.trim().length > 0) &&
    (!isGift ||
      (giftRecipientName.trim().length > 0 &&
        giftRecipientRelation.trim().length > 0 &&
        giftOccasion.trim().length > 0));

  const onSubmit = async (): Promise<void> => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const review = await createOrderReview(orderId, {
        productType,
        ...(isGift
          ? {
              giftRecipientName: giftRecipientName.trim(),
              giftRecipientRelation: giftRecipientRelation.trim(),
              giftOccasion: giftOccasion.trim(),
            }
          : {}),
        qualityRating,
        ...(requiresLowReason(qualityRating) ? { qualityLowReason: qualityLowReason.trim() } : {}),
        packagingRating,
        ...(requiresLowReason(packagingRating)
          ? { packagingLowReason: packagingLowReason.trim() }
          : {}),
        shippingRating,
        ...(requiresLowReason(shippingRating)
          ? { shippingLowReason: shippingLowReason.trim() }
          : {}),
      });
      onCreated(review);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message.length > 0 ? err.message : t("review.saveFailed"),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("review.actions.add")} size="md">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <FormField label={t("review.field.productType")} htmlFor="review-product-type" required>
          <Combobox
            id="review-product-type"
            value={productType}
            onChange={(v) => setProductType(v as ProductType)}
            options={PRODUCT_TYPES.map((key) => ({
              value: key,
              label: t(`review.productType.${key}` as TranslationKey),
            }))}
            ariaLabel={t("review.field.productType")}
          />
        </FormField>

        {isGift ? (
          <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
            <FormField
              label={t("review.field.giftRecipientName")}
              htmlFor="review-gift-name"
              required
            >
              <Input
                id="review-gift-name"
                value={giftRecipientName}
                onChange={(e) => setGiftRecipientName(e.target.value)}
                maxLength={200}
              />
            </FormField>
            <FormField
              label={t("review.field.giftRecipientRelation")}
              htmlFor="review-gift-relation"
              required
            >
              <Input
                id="review-gift-relation"
                value={giftRecipientRelation}
                onChange={(e) => setGiftRecipientRelation(e.target.value)}
                maxLength={200}
              />
            </FormField>
            <FormField
              label={t("review.field.giftOccasion")}
              htmlFor="review-gift-occasion"
              required
            >
              <Input
                id="review-gift-occasion"
                value={giftOccasion}
                onChange={(e) => setGiftOccasion(e.target.value)}
                maxLength={200}
              />
            </FormField>
          </div>
        ) : null}

        <RatingField
          label={t("review.field.quality")}
          rating={qualityRating}
          onRatingChange={setQualityRating}
          lowReason={qualityLowReason}
          onLowReasonChange={setQualityLowReason}
        />
        <RatingField
          label={t("review.field.packaging")}
          rating={packagingRating}
          onRatingChange={setPackagingRating}
          lowReason={packagingLowReason}
          onLowReasonChange={setPackagingLowReason}
        />
        <RatingField
          label={t("review.field.shipping")}
          rating={shippingRating}
          onRatingChange={setShippingRating}
          lowReason={shippingLowReason}
          onLowReasonChange={setShippingLowReason}
        />

        {average !== null ? (
          <p className="text-sm text-muted-foreground">
            {t("review.field.average")}: {average.toFixed(1)}
          </p>
        ) : null}

        {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-4">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          {t("review.actions.cancel")}
        </Button>
        <Button onClick={() => void onSubmit()} disabled={!canSubmit || pending}>
          {t("review.actions.save")}
        </Button>
      </div>
    </Modal>
  );
}

function RatingField({
  label,
  rating,
  onRatingChange,
  lowReason,
  onLowReasonChange,
}: {
  label: string;
  rating: number;
  onRatingChange: (value: number) => void;
  lowReason: string;
  onLowReasonChange: (value: string) => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <StarRatingInput value={rating} onChange={onRatingChange} ariaLabel={label} />
      </div>
      {requiresLowReason(rating) ? (
        <FormField label={t("review.field.lowReason")} required>
          <textarea
            className="min-h-16 rounded border border-input bg-background px-2 py-1.5 text-sm"
            value={lowReason}
            onChange={(e) => onLowReasonChange(e.target.value)}
            maxLength={1000}
            aria-label={t("review.field.lowReason")}
          />
        </FormField>
      ) : null}
    </div>
  );
}
