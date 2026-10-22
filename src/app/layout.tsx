import type { Metadata, Viewport } from "next";
import { Providers } from "@/frontend/components/Providers/Providers";
import "@/frontend/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "UPI Spend Tracker", template: "%s · UPI Spend Tracker" },
  description: "Know what you actually spent, what others owe you, and which refunds are still missing.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
