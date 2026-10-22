"use client";

import { useEffect } from "react";

/** Calls `tick` every `intervalMs` while `active` (e.g. while an import is still processing). */
export function usePolling(tick: () => void, active: boolean, intervalMs = 2000): void {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [tick, active, intervalMs]);
}
