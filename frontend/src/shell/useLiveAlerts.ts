import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getRecentLimitHits } from "../api/client";

const CURSOR_KEY = "ccfr_limit_hits_since";
const POLL_INTERVAL_MS = 2000;

function readInitialCursor(): string {
  try {
    const existing = localStorage.getItem(CURSOR_KEY);
    if (existing) return existing;
    const initial = new Date().toISOString();
    localStorage.setItem(CURSOR_KEY, initial);
    return initial;
  } catch {
    return new Date().toISOString();
  }
}

// Live rate-limit-hit alerts for the sidebar badge. Polls (not push) by
// design -- see docs/architecture.md; the backend's ?since= filter is
// day-granular (shared with the Limits page's date range), so "unseen" is
// refined client-side to full-timestamp precision against the stored cursor.
export function useLiveAlerts() {
  const [cursor, setCursor] = React.useState<string>(readInitialCursor);

  const query = useQuery({
    queryKey: ["alerts", "limit-hits", cursor],
    queryFn: () => getRecentLimitHits(cursor),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const cursorMs = new Date(cursor).getTime();
  const unseenCount = (query.data?.hits ?? []).filter(
    (hit) => new Date(hit.ts).getTime() > cursorMs
  ).length;

  const markSeen = React.useCallback(() => {
    const now = new Date().toISOString();
    setCursor(now);
    try {
      localStorage.setItem(CURSOR_KEY, now);
    } catch {
      /* ignore */
    }
  }, []);

  return { unseenCount, markSeen };
}
