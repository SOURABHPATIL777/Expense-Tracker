// HTTP header policies. Imported by next.config.ts (all responses) and the API layer (guest endpoints).

export type HeaderPair = { key: string; value: string };

export const SECURITY_HEADERS: HeaderPair[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/** Guest invitation pages/APIs: tokens must not leak through referrers, shared caches or search engines. */
export const GUEST_HEADERS: HeaderPair[] = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
