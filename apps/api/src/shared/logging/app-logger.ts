import { Inject, Injectable, type LoggerService } from "@nestjs/common";
import type { LoggingConfig } from "@cadeau/config";
import { APP_CONFIG, type InjectedAppConfig } from "../config/config.tokens";
import { getRequestId } from "./request-context";

/** Canonical log levels, lowest → highest severity. */
type Level = LoggingConfig["level"];

const SEVERITY: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** One structured log record, serialized as a single JSON line. */
interface LogRecord {
  readonly time: string;
  readonly level: Level;
  readonly message: string;
  readonly context?: string;
  readonly requestId?: string;
  readonly err?: { readonly message: string; readonly stack?: string };
}

/**
 * Structured JSON logger implementing Nest's {@link LoggerService}. Emits one
 * JSON object per line, filtered by the configured level, and automatically
 * attaches the current request's correlation id. Errors/fatals go to stderr,
 * everything else to stdout. It never uses `console` (ESLint-forbidden) and
 * carries no sensitive data by construction — callers pass only messages and
 * a context label.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly threshold: number;

  constructor(@Inject(APP_CONFIG) config: InjectedAppConfig) {
    this.threshold = SEVERITY[config.logging.level];
  }

  log(message: unknown, context?: string): void {
    this.write("info", message, context);
  }

  error(message: unknown, stackOrContext?: string, context?: string): void {
    // Nest calls error(message, stack?, context?), and the two optional
    // arguments are ambiguous by position: a caller passing two arguments
    // means a context label, one passing three means the middle is a stack.
    // A `Logger` instance built with a context always forwards all three, so
    // that is the signal used here.
    //
    // Before this (found live 2026-09-13): the stack was only ever read as a
    // context fallback and `err` was derived from the MESSAGE alone, so the
    // standard `logger.error("text", err.stack)` idiom logged the text with
    // no cause at all. Both retry workers and the notification dispatcher use
    // exactly that idiom, which is why a production failure in any of them
    // said only that it "failed unexpectedly".
    const stack = context !== undefined ? stackOrContext : undefined;
    this.write("error", message, context ?? stackOrContext, this.toError(message, stack));
  }

  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write("trace", message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write("fatal", message, context, this.toError(message));
  }

  private toError(message: unknown, stack?: string): LogRecord["err"] {
    if (message instanceof Error) {
      return message.stack !== undefined
        ? { message: message.message, stack: message.stack }
        : { message: message.message };
    }
    // A caller-supplied stack: its first line already carries the real
    // error's message, which the log's own `message` (a human summary like
    // "Delivery retry tick failed unexpectedly.") does not.
    if (stack !== undefined) {
      const [first] = stack.split("\n");
      return {
        message: first !== undefined && first.length > 0 ? first : this.toMessage(message),
        stack,
      };
    }
    return undefined;
  }

  private write(level: Level, message: unknown, context?: string, err?: LogRecord["err"]): void {
    if (SEVERITY[level] < this.threshold) return;

    const requestId = getRequestId();
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      message: this.toMessage(message),
      ...(context !== undefined ? { context } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
      ...(err !== undefined ? { err } : {}),
    };

    const line = `${JSON.stringify(record)}\n`;
    if (SEVERITY[level] >= SEVERITY.error) {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  private toMessage(message: unknown): string {
    if (typeof message === "string") return message;
    if (message instanceof Error) return message.message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
