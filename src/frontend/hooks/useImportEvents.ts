"use client";

import { useEffect, useRef, useState } from "react";
import { importEvents, type ImportChange, type RealtimeStatus } from "@/frontend/lib/realtime";

/** While the socket is down, check this often instead (so progress never silently stops). */
const FALLBACK_POLL_MS = 20_000;

/**
 * Calls `onChange` whenever one of the user's imports changes (optionally only `importId`),
 * pushed over the Realtime socket. Falls back to a slow periodic refresh if the socket is down.
 */
export function useImportEvents(onChange: (change: ImportChange | null) => void, opts: { importId?: string; enabled?: boolean } = {}): RealtimeStatus {
  const { importId, enabled = true } = opts;
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });

  useEffect(() => {
    if (!enabled) return;
    return importEvents.subscribe((change) => {
      if (!importId || change.id === importId) handler.current(change);
    }, setStatus);
  }, [importId, enabled]);

  useEffect(() => {
    if (!enabled || status !== "offline") return;
    const id = setInterval(() => handler.current(null), FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, status]);

  return status;
}
