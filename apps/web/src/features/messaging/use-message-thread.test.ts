import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "./messaging-api";
import { useMessageThread } from "./use-message-thread";

const { listMessagesMock, sendMessageMock, markThreadReadMock } = vi.hoisted(() => ({
  listMessagesMock: vi.fn(),
  sendMessageMock: vi.fn(),
  markThreadReadMock: vi.fn().mockResolvedValue({ lastReadAt: "2026-01-01T00:00:00.000Z" }),
}));

vi.mock("./messaging-api", () => ({
  listMessages: listMessagesMock,
  sendMessage: sendMessageMock,
  markThreadRead: markThreadReadMock,
}));

const THREAD = "thread-1";

function message(id: string, createdAt: string): Message {
  return {
    id,
    threadId: THREAD,
    senderProfileId: "u1",
    senderName: "Sara",
    senderKind: "staff",
    body: `body-${id}`,
    attachments: [],
    orderRefs: [],
    deletedAt: null,
    createdAt,
  };
}

const M1 = message("m1", "2026-01-01T00:00:01.000Z");
const M2 = message("m2", "2026-01-01T00:00:02.000Z");
const M3 = message("m3", "2026-01-01T00:00:03.000Z");

function pageOf(data: Message[], nextCursor: string | null) {
  return { data, page: { limit: 50, nextCursor, hasMore: nextCursor !== null } };
}

describe("useMessageThread", () => {
  it("orders messages oldest-first from the API's newest-first page", async () => {
    listMessagesMock.mockResolvedValueOnce(pageOf([M3, M2, M1], null));

    const { result } = renderHook(() => useMessageThread(THREAD));

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    const state = result.current.state;
    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(state.hasOlder).toBe(false);
  });

  it("prepends an older page without disturbing what's already loaded", async () => {
    listMessagesMock.mockResolvedValueOnce(pageOf([M3, M2], "cursor-1"));
    const { result } = renderHook(() => useMessageThread(THREAD));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    listMessagesMock.mockResolvedValueOnce(pageOf([M1], null));
    await result.current.loadOlder();

    await waitFor(() => {
      const state = result.current.state;
      if (state.kind !== "ready") throw new Error("expected ready");
      expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
      expect(state.hasOlder).toBe(false);
    });
  });

  it("appends the message the server returns after sending", async () => {
    listMessagesMock.mockResolvedValueOnce(pageOf([M1], null));
    const { result } = renderHook(() => useMessageThread(THREAD));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    const sent = message("m2", "2026-01-01T00:00:05.000Z");
    sendMessageMock.mockResolvedValueOnce(sent);
    await result.current.send({ body: "hi" });

    await waitFor(() => {
      const state = result.current.state;
      if (state.kind !== "ready") throw new Error("expected ready");
      expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    });
  });
});
