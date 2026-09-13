import { afterEach, describe, expect, it, vi } from "vitest";
import type { InjectedAppConfig } from "../config/config.tokens";
import { AppLogger } from "./app-logger";
import { runWithRequestContext } from "./request-context";

function loggerAt(level: InjectedAppConfig["logging"]["level"]): AppLogger {
  return new AppLogger({ logging: { level } } as InjectedAppConfig);
}

function captureStdout() {
  return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}
function captureStderr() {
  return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

function lastRecord(spy: ReturnType<typeof captureStdout>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(String(call?.[0])) as Record<string, unknown>;
}

describe("AppLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes a structured JSON line for info-level logs", () => {
    const out = captureStdout();
    loggerAt("info").log("hello", "Ctx");
    const record = lastRecord(out);
    expect(record).toMatchObject({ level: "info", message: "hello", context: "Ctx" });
    expect(typeof record["time"]).toBe("string");
  });

  it("filters out messages below the configured level", () => {
    const out = captureStdout();
    loggerAt("warn").log("info-level"); // below warn
    loggerAt("warn").debug("debug-level");
    expect(out).not.toHaveBeenCalled();
  });

  it("emits verbose as trace when level allows", () => {
    const out = captureStdout();
    loggerAt("trace").verbose("v");
    expect(lastRecord(out)["level"]).toBe("trace");
  });

  it("sends errors to stderr with the error message and stack", () => {
    const err = captureStderr();
    loggerAt("info").error(new Error("boom"));
    const record = lastRecord(err);
    expect(record["level"]).toBe("error");
    expect(record["err"]).toMatchObject({ message: "boom" });
    expect(typeof (record["err"] as Record<string, unknown>)["stack"]).toBe("string");
  });

  /**
   * The 2026-09-13 defect: `logger.error("text", err.stack)` — Nest's own
   * idiom, used by both retry workers and the notification dispatcher — threw
   * the stack away, so a production failure logged only "failed
   * unexpectedly" with no cause.
   */
  it("records a stack passed the Nest way, alongside the human message", () => {
    const err = captureStderr();
    const boom = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    // What a `Logger` instance built with a context forwards: all three args.
    loggerAt("info").error("Delivery retry tick failed unexpectedly.", boom.stack, "Worker");
    const record = lastRecord(err);
    expect(record["message"]).toBe("Delivery retry tick failed unexpectedly.");
    expect(record["context"]).toBe("Worker");
    const logged = record["err"] as Record<string, unknown>;
    expect(String(logged["stack"])).toContain("ECONNREFUSED");
    // The summary message alone never said which error it was; the stack's
    // first line does.
    expect(String(logged["message"])).toContain("ECONNREFUSED");
  });

  it("still treats a lone second argument as the context label, not a stack", () => {
    const err = captureStderr();
    loggerAt("info").error("Event handler failed.", "EventBus");
    const record = lastRecord(err);
    expect(record["context"]).toBe("EventBus");
    expect(record["err"]).toBeUndefined();
  });

  it("sends fatal to stderr", () => {
    const err = captureStderr();
    loggerAt("info").fatal("dead");
    expect(lastRecord(err)["level"]).toBe("fatal");
  });

  it("sends warnings to stdout", () => {
    const out = captureStdout();
    loggerAt("info").warn("careful");
    expect(lastRecord(out)["level"]).toBe("warn");
  });

  it("attaches the current requestId", () => {
    const out = captureStdout();
    runWithRequestContext({ requestId: "req-9" }, () => loggerAt("info").log("in-context"));
    expect(lastRecord(out)["requestId"]).toBe("req-9");
  });

  it("serializes non-string messages", () => {
    const out = captureStdout();
    loggerAt("info").log({ a: 1 });
    expect(lastRecord(out)["message"]).toBe(JSON.stringify({ a: 1 }));
  });

  it("falls back to String() for non-serializable messages", () => {
    const out = captureStdout();
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    loggerAt("info").log(circular);
    expect(lastRecord(out)["message"]).toBe(String(circular));
  });
});
