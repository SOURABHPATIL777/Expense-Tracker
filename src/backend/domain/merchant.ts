import "server-only";

const LEGAL_SUFFIXES = /\b(private|pvt|limited|ltd|llp|inc|india|technologies|tech|services|solutions|retail|stores?)\b\.?/gi;

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Human-friendly merchant name: "SWIGGY LIMITED" → "Swiggy", "swiggy.stores@axisbank" → "Swiggy". */
export function displayMerchant(name: string | null, vpa: string | null): string | null {
  const cleanedName = name?.replace(LEGAL_SUFFIXES, " ").replace(/[^a-z0-9&' ]/gi, " ").replace(/\s+/g, " ").trim();
  if (cleanedName && cleanedName.length >= 2) return titleCase(cleanedName);
  const handle = vpa?.split("@")[0]?.split(/[._-]/)[0];
  if (handle && /[a-z]/i.test(handle) && !/^\d+$/.test(handle)) return titleCase(handle);
  return null;
}

/**
 * Stable key for learned merchant → category mappings. VPAs identify merchants precisely;
 * names are the fallback (normalised so "SWIGGY LTD" and "Swiggy" collide).
 */
export function merchantKey(name: string | null, vpa: string | null): string | null {
  if (vpa) return `vpa:${vpa.toLowerCase()}`;
  const n = name?.replace(LEGAL_SUFFIXES, " ").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return n && n.length >= 2 ? `name:${n}` : null;
}
