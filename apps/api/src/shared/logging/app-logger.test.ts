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
