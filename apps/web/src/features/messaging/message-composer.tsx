import { Paperclip, Send, ShoppingBag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { useToast } from "@/components/toast/toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { TranslationKey } from "@/i18n/dictionaries";
import { useI18n } from "@/i18n/i18n-provider";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useMentionableOrders } from "./use-mentionable-orders";
import {
  uploadAttachment,
  type Attachment,
  type MentionableOrder,
  type SendMessageInput,
} from "./messaging-api";

interface PendingAttachment {
  readonly localId: string;
  readonly previewUrl: string;
  readonly status: "uploading" | "ready" | "error";
  readonly attachment: Attachment | null;
}

/**
 * The message box: text, `@` order mentions and image attachments (EPIC-17
 * M17.6). `@` typed inside the textarea opens a debounced popover
 * (`useMentionableOrders`); picking a result **removes the typed `@query`
 * text and adds a chip instead** — chips travel to the server as `orderIds`,
 * never parsed back out of the body, so a forged `@` in the text can never
 * become a mention (handoff §M17.6).
 */
export function MessageComposer({
  threadId,
  disabled,
  onSend,
  onSent,
}: {
  readonly threadId: string;
  readonly disabled: boolean;
  readonly onSend: (input: SendMessageInput) => Promise<unknown>;
  readonly onSent?: () => void;
}): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentions, setMentions] = useState<readonly MentionableOrder[]>([]);
  const [attachments, setAttachments] = useState<readonly PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);

  const { results: mentionResults, loading: mentionLoading } = useMentionableOrders(
    threadId,
    mentionQuery,
  );

  // Revoke every preview URL on unmount only — reading `attachments` here via a
  // ref keeps this a mount-once effect; depending on `attachments` directly
  // would revoke URLs still in use by the thumbnails currently on screen.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl);
    };
  }, []);

  const closeMention = (): void => {
    setMentionStart(null);
    setMentionQuery(null);
  };

  const onBodyChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value;
    const cursor = event.target.selectionStart;
    setBody(value);

    const atIndex = value.lastIndexOf("@", cursor - 1);
    if (atIndex === -1) {
      closeMention();
      return;
    }
    const between = value.slice(atIndex + 1, cursor);
    if (/\s/.test(between)) {
      closeMention();
      return;
    }
    setMentionStart(atIndex);
    setMentionQuery(between);
  };

  const selectMention = (order: MentionableOrder): void => {
    const textarea = textareaRef.current;
    if (mentionStart !== null && textarea !== null) {
      const cursor = textarea.selectionStart;
      setBody((current) => current.slice(0, mentionStart) + current.slice(cursor));
    }
    setMentions((current) =>
      current.some((m) => m.orderId === order.orderId) ? current : [...current, order],
    );
    closeMention();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const removeMention = (orderId: string): void => {
    setMentions((current) => current.filter((m) => m.orderId !== orderId));
  };

  const addFiles = (files: FileList | null): void => {
    if (files === null) return;
    for (const file of files) {
      const localId = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      setAttachments((current) => [
        ...current,
        { localId, previewUrl, status: "uploading", attachment: null },
      ]);
      uploadAttachment(file)
        .then((attachment) => {
          setAttachments((current) =>
            current.map((a) => (a.localId === localId ? { ...a, status: "ready", attachment } : a)),
          );
        })
        .catch((error: unknown) => {
          setAttachments((current) =>
            current.map((a) => (a.localId === localId ? { ...a, status: "error" } : a)),
          );
          toast.show(
            error instanceof ApiError && error.code === "SERVICE_UNAVAILABLE"
              ? t("messaging.composer.attachmentsUnavailable")
              : t("messaging.composer.attachFailed"),
            { variant: "error" },
          );
        });
    }
  };

  const removeAttachment = (localId: string): void => {
    setAttachments((current) => {
      const target = current.find((a) => a.localId === localId);
      if (target !== undefined) URL.revokeObjectURL(target.previewUrl);
      return current.filter((a) => a.localId !== localId);
    });
  };

  const uploading = attachments.some((a) => a.status === "uploading");
  const readyAttachmentIds = attachments
    .filter((a): a is PendingAttachment & { attachment: Attachment } => a.status === "ready")
    .map((a) => a.attachment.id);
  const canSend =
    !disabled &&
    !sending &&
    !uploading &&
    (body.trim().length > 0 || readyAttachmentIds.length > 0);

  const send = async (): Promise<void> => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend({
        body: body.trim(),
        attachmentIds: readyAttachmentIds,
        orderIds: mentions.map((m) => m.orderId),
      });
      setBody("");
      setMentions([]);
      setAttachments([]);
      onSent?.();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : t("messaging.composer.sendFailed"), {
        variant: "error",
      });
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && mentionQuery === null) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
      {mentions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {mentions.map((m) => (
            <span
              key={m.orderId}
              className="flex items-center gap-1 rounded-full bg-primary/10 py-1 ps-2.5 pe-1.5 text-xs font-medium text-primary"
            >
              <ShoppingBag className="h-3 w-3" aria-hidden="true" />
              <span dir="ltr">#{m.orderNumber}</span>
              <button
                type="button"
                onClick={() => removeMention(m.orderId)}
                aria-label={t("messaging.composer.removeMention")}
                className="rounded-full p-0.5 hover:bg-primary/20"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.localId} className="relative h-14 w-14 shrink-0">
              <img
                src={a.previewUrl}
                alt=""
                className={cn(
                  "h-full w-full rounded-md border border-border object-cover",
                  a.status === "uploading" && "opacity-50",
                  a.status === "error" && "border-destructive opacity-50",
                )}
              />
              {a.status === "uploading" ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner className="h-4 w-4" />
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => removeAttachment(a.localId)}
                aria-label={t("messaging.composer.removeAttachment")}
                className="absolute -end-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label={t("messaging.composer.attach")}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </Button>

        <Popover open={mentionQuery !== null} onOpenChange={(open) => !open && closeMention()}>
          <PopoverAnchor asChild>
            <textarea
              ref={textareaRef}
              value={body}
              disabled={disabled}
              onChange={onBodyChange}
              onKeyDown={onKeyDown}
              placeholder={t("messaging.composer.placeholder")}
              rows={1}
              className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </PopoverAnchor>
          <PopoverContent align="start" className="max-w-72 p-1">
            {mentionLoading ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t("states.loading")}
              </p>
            ) : mentionResults.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t("messaging.mention.empty")}
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto">
                {mentionResults.map((order) => (
                  <li key={order.orderId}>
                    <button
                      type="button"
                      onClick={() => selectMention(order)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-muted"
                    >
                      <ShoppingBag
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span dir="ltr" className="font-medium">
                        #{order.orderNumber}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t(`orders.status.${order.status}` as TranslationKey)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          size="icon"
          disabled={!canSend}
          aria-label={t("messaging.composer.send")}
          onClick={() => void send()}
        >
          {sending ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
