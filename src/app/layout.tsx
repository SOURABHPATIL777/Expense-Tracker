import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/frontend/components/Providers/Providers";
import "@/frontend/styles/globals.css";

const brandFont = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-brand", display: "swap" });

export const metadata: Metadata = {
  title: { default: "UPI Spend Tracker", template: "%s · UPI Spend Tracker" },
  description: "Know what you actually spent, what others owe you, and which refunds are still missing.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f14" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={brandFont.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
