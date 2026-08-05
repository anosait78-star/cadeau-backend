import { type Provider } from "@nestjs/common";

/** A source of the current time — injectable so time-dependent code is testable. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/** DI token for {@link Clock}. */
export const CLOCK = Symbol("CLOCK");

/** The real, wall-clock provider bound in production wiring. */
export const systemClockProvider: Provider = {
  provide: CLOCK,
  useValue: { now: () => Date.now() } satisfies Clock,
};
