import { type ExecutionContext } from "@nestjs/common";
import { signWebhookPayload } from "@cadeau/crypto";
import { describe, expect, it } from "vitest";
import { AppException } from "../../../shared/errors/app-exception";
import { WebhookSignatureGuard } from "./webhook-signature.guard";

const SECRET = "000000000000000000000000000000000000000000000000000000000000cccc";
const BODY = '{"eventId":"evt_1"}';

function makeContext(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function configWith(secret: string): { shipping: { webhookSigningSecret: string } } {
  return { shipping: { webhookSigningSecret: secret } };
}

describe("WebhookSignatureGuard", () => {
  it("accepts a correctly signed request", () => {
    const guard = new WebhookSignatureGuard(configWith(SECRET) as never);
    const signature = signWebhookPayload(BODY, SECRET);
    const ctx = makeContext({
      headers: { "x-webhook-signature": signature },
      rawBody: Buffer.from(BODY, "utf8"),
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects a missing signature header", () => {
    const guard = new WebhookSignatureGuard(configWith(SECRET) as never);
    const ctx = makeContext({ headers: {}, rawBody: Buffer.from(BODY, "utf8") });
    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it("rejects when the raw body is unavailable", () => {
    const guard = new WebhookSignatureGuard(configWith(SECRET) as never);
    const signature = signWebhookPayload(BODY, SECRET);
    const ctx = makeContext({ headers: { "x-webhook-signature": signature } });
    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it("rejects a tampered body", () => {
    const guard = new WebhookSignatureGuard(configWith(SECRET) as never);
    const signature = signWebhookPayload(BODY, SECRET);
    const ctx = makeContext({
      headers: { "x-webhook-signature": signature },
      rawBody: Buffer.from(BODY + "tampered", "utf8"),
    });
    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });

  it("rejects a signature computed under a different secret", () => {
    const guard = new WebhookSignatureGuard(configWith(SECRET) as never);
    const wrongSecret = "1".repeat(64);
    const signature = signWebhookPayload(BODY, wrongSecret);
    const ctx = makeContext({
      headers: { "x-webhook-signature": signature },
      rawBody: Buffer.from(BODY, "utf8"),
    });
    expect(() => guard.canActivate(ctx)).toThrow(AppException);
  });
});
