import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

// Typeface is a Phase 1 decision (AGENTS.md open decision #4). Geist is the
// shadcn preset default and a placeholder, not a choice.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "Marketplace",
    template: "%s · Marketplace",
  },
  description: "A multi-vendor marketplace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning is for the Phase 1 theme script, which sets the
    // light/dark class on <html> before paint.
    <html lang="en" suppressHydrationWarning className={cn(geist.variable)}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
