"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "@/frontend/components/Toast/Toast";

/** Client-side context providers mounted once in the root layout. */
export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
