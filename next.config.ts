import type { NextConfig } from "next";
import { GUEST_HEADERS, SECURITY_HEADERS } from "./src/shared/constants/headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  serverExternalPackages: ["pino", "unpdf", "xlsx"],
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/s/:path*", headers: GUEST_HEADERS },
      { source: "/api/v1/guest/:path*", headers: GUEST_HEADERS },
    ];
  },
};

export default nextConfig;
