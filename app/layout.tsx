import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { themeClass } from "@/lib/theme";
import { getTheme } from "@/lib/theme.server";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

// Prices, SKUs, order numbers, tracking codes. Not for prose.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Marketplace", template: "%s · Marketplace" },
  description: "A multi-vendor marketplace.",
};

export const viewport: Viewport = {
  // Both entries, so the browser chrome matches whichever theme is active.
  // These must equal --surface-0; a literal is unavoidable because the browser
  // paints its chrome before any CSS is parsed. lib/design/tokens.test.ts pins
  // them so they cannot drift.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0f141a" },
  ],
  // No maximum-scale: pinch-zoom is an accessibility requirement, not a bug.
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getTheme();

  return (
    <html
      lang="en"
      className={`${manrope.variable} ${jetbrainsMono.variable} ${themeClass(theme)}`}
    >
      <body className="min-h-dvh bg-surface-0 font-sans text-primary-text">
        {children}
      </body>
    </html>
  );
}
