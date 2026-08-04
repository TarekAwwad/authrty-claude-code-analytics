import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveAlerts } from "./useLiveAlerts";

const CURSOR_KEY = "ccfr_limit_hits_since";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function mockHitsResponse(hits: Array<{ ts: string }>) {
  vi.spyOn(global, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          checked_at: new Date().toISOString(),
          hits: hits.map((h) => ({
            ts: h.ts,
            kind: "session",
            reset_at: null,
            blocked_minutes: null,
            usage_at_hit: null,
            usage_at_hit_tokens: null,
            occurrence_count: 1,
            window_index: null,
            session_ids: [],
            session_titles: [],
          })),
        }),
        { status: 200 },
      ),
    ),
  );
}

describe("useLiveAlerts", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("does not count pre-existing hits as unseen on first load", async () => {
    mockHitsResponse([{ ts: "2020-01-01T00:00:00Z" }]);
    const { result } = renderHook(() => useLiveAlerts(), { wrapper: createWrapper() });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // First load has no stored cursor, so it baselines to "now" rather than
    // flagging whatever the backend's default recent window already had.
    await waitFor(() => expect(result.current.unseenCount).toBe(0));
    expect(localStorage.getItem(CURSOR_KEY)).not.toBeNull();
  });

  it("counts hits newer than a stored cursor as unseen", async () => {
    localStorage.setItem(CURSOR_KEY, "2020-01-01T00:00:00.000Z");
    mockHitsResponse([{ ts: "2020-06-01T00:00:00Z" }, { ts: "2020-06-02T00:00:00Z" }]);

    const { result } = renderHook(() => useLiveAlerts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.unseenCount).toBe(2));
  });

  it("markSeen advances the cursor and clears the unseen count", async () => {
    localStorage.setItem(CURSOR_KEY, "2020-01-01T00:00:00.000Z");
    mockHitsResponse([{ ts: "2020-06-01T00:00:00Z" }]);
    const { result } = renderHook(() => useLiveAlerts(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.unseenCount).toBe(1));

    act(() => result.current.markSeen());

    await waitFor(() => expect(result.current.unseenCount).toBe(0));
    expect(localStorage.getItem(CURSOR_KEY)).not.toBe("2020-01-01T00:00:00.000Z");
  });
});
