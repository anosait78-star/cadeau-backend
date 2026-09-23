import { ImageOff, ShoppingBag } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusBadge } from "@/components/status-badge/status-badge";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/cn";
import { ImageLightbox } from "./image-lightbox";
import type { Attachment, Message, OrderReference } from "./messaging-api";
import { orderRefStatusTone } from "./order-ref-status-tones";

function AttachmentThumb({
  attachment,
  onOpen,
}: {
  readonly attachment: Attachment;
  readonly onOpen: () => void;
}): ReactNode {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span
        className="flex aspect-square items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="aspect-square overflow-hidden rounded-md border border-border"
    >
      <img
        src={attachment.url}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
    </button>
  );
}

/** `orderRefs` entries carry no `imageUrl` — a card with the number and status, not a thumbnail. */
function OrderRefCard({
  reference,
  href,
  locale,
}: {
  readonly reference: OrderReference;
  /** `undefined` renders the card without a link (no id mapping available on this side). */
  readonly href: string | undefined;
  readonly locale: string;
}): ReactNode {
  const { t } = useI18n();
  const content = (
    <>
      <ShoppingBag className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="ltr">
        #{reference.orderNumber}
      </span>
      {reference.status !== null ? (
        <StatusBadge
          tone={orderRefStatusTone(reference.status)}
          label={t(`orders.status.${reference.status}` as TranslationKey)}
        />
      ) : null}
    </>
  );
  const className =
    "flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5";
  void locale;
  if (href === undefined) {
    return <div className={className}>{content}</div>;
  }
  return (
    <Link to={href} className={cn(className, "hover:bg-muted")}>
      {content}
    </Link>
  );
}

/**
 * One message, as either side of the conversation renders it (EPIC-17
 * M17.6): text, an image grid (opens the lightbox), and an order card per
 * mention. `justify-end`/`justify-start` already flip correctly under RTL —
 * flexbox's main-axis start/end are writing-mode relative, so no
 * `rtl:`-specific class is needed here.
 */
export function MessageBubble({
  message,
  isOwn,
  orderHref,
}: {
  readonly message: Message;
  readonly isOwn: boolean;
  /** Builds the link for one order mention, or `undefined` to render it unlinked. */
  readonly orderHref?: (orderId: string) => string | undefined;
}): ReactNode {
  const { t, locale } = useI18n();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const time = new Date(message.createdAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[85%] flex-col gap-1 sm:max-w-[70%]")}>
        {!isOwn && message.senderName !== null ? (
          <span className="px-1 text-xs font-medium text-muted-foreground">
            {message.senderName}
          </span>
        ) : null}

        <div
          className={cn(
            "flex flex-col gap-2 rounded-2xl px-3 py-2 text-sm",
            isOwn
              ? "rounded-ee-sm bg-primary text-primary-foreground"
              : "rounded-ss-sm bg-muted text-foreground",
          )}
        >
          {message.deletedAt !== null ? (
            <p className="italic opacity-70">{t("messaging.message.deleted")}</p>
          ) : (
            <>
              {message.body !== null ? (
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              ) : null}
              {message.attachments.length > 0 ? (
                <div
                  className={cn(
                    "grid gap-1",
                    message.attachments.length === 1 ? "grid-cols-1" : "grid-cols-2",
                  )}
                  style={{ maxWidth: "16rem" }}
                >
                  {message.attachments.map((attachment, i) => (
                    <AttachmentThumb
                      key={attachment.id}
                      attachment={attachment}
                      onOpen={() => setLightboxIndex(i)}
                    />
                  ))}
                </div>
              ) : null}
              {message.orderRefs.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {message.orderRefs.map((ref) => (
                    <OrderRefCard
                      key={ref.orderId}
                      reference={ref}
                      href={orderHref?.(ref.orderId)}
                      locale={locale}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <span
          className={cn(
            "px-1 text-[0.6875rem] text-muted-foreground",
            isOwn ? "text-end" : "text-start",
          )}
          dir="ltr"
        >
          {time}
        </span>
      </div>

      {lightboxIndex !== null ? (
        <ImageLightbox
          attachments={message.attachments}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          closeLabel={t("messaging.lightbox.close")}
          previousLabel={t("messaging.lightbox.previous")}
          nextLabel={t("messaging.lightbox.next")}
        />
      ) : null}
    </div>
  );
}
