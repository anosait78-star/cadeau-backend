import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AppException } from "../errors/app-exception";
import { CLOCK, type Clock } from "../time/clock";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./rate-limit.decorator";
import { RateLimiter } from "./rate-limiter";

/**
 * Enforces {@link RateLimit} on annotated handlers. A limiter is kept per
 * `(handler, limit, windowMs)` signature; the per-client key is the client IP,
 * so one abusive source is throttled without affecting others. Unannotated
 * handlers pass through untouched.
 *
 * On block it returns the unified `429 TOO_MANY_REQUESTS` envelope and sets
 * `Retry-After`. Only the count of *attempts* is tracked — never credentials.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiters = new Map<string, RateLimiter>();

  constructor(
    private readonly reflector: Reflector,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (options === undefined) return true;

    const handlerId = `${context.getClass().name}.${context.getHandler().name}`;
    const limiter = this.limiterFor(handlerId, options);

    const request = context.switchToHttp().getRequest<Request>();
    const result = limiter.hit(`${handlerId}:${this.clientKey(request)}`, this.clock.now());
    if (result.allowed) return true;

    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader("Retry-After", String(result.retryAfterSeconds));
    throw new AppException(
      HttpStatus.TOO_MANY_REQUESTS,
      "TOO_MANY_REQUESTS",
      "Too many requests. Please retry later.",
    );
  }

  private limiterFor(handlerId: string, options: RateLimitOptions): RateLimiter {
    const signature = `${handlerId}:${options.limit}:${options.windowMs}`;
    let limiter = this.limiters.get(signature);
    if (limiter === undefined) {
      limiter = new RateLimiter(options.limit, options.windowMs);
      this.limiters.set(signature, limiter);
    }
    return limiter;
  }

  private clientKey(request: Request): string {
    return request.ip ?? request.socket.remoteAddress ?? "unknown";
  }
}
