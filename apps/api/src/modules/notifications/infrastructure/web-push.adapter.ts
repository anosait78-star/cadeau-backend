import { Inject, Injectable } from "@nestjs/common";
import webpush from "web-push";
import { APP_CONFIG, type InjectedAppConfig } from "../../../shared/config/config.tokens";
import {
  PushSubscriptionGoneError,
  type PushSenderPort,
  type PushSubscriptionTarget,
} from "../domain/push-sender.port";

/**
 * Sends one Web Push message via the `web-push` npm package (EPIC-15,
 * decision D4) — VAPID-authenticated (RFC 8292), RFC 8291-encrypted. The
 * VAPID key pair is self-generated server key material (`@cadeau/config`
 * `notifications.vapid`), never a third-party account credential.
 */
@Injectable()
export class WebPushAdapter implements PushSenderPort {
  constructor(@Inject(APP_CONFIG) private readonly config: InjectedAppConfig) {}

  async send(target: PushSubscriptionTarget, payload: unknown): Promise<void> {
    const { publicKey, privateKey, subject } = this.config.notifications.vapid;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(payload),
      );
    } catch (error) {
      const statusCode = this.extractStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        throw new PushSubscriptionGoneError();
      }
      throw error;
    }
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (error !== null && typeof error === "object" && "statusCode" in error) {
      const value = (error as { statusCode: unknown }).statusCode;
      return typeof value === "number" ? value : undefined;
    }
    return undefined;
  }
}
