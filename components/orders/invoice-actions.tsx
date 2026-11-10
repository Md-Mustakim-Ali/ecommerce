"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The controls above an invoice. Hidden from the printed sheet.
 *
 * ── Why "Save as PDF" opens the print dialog ─────────────────────────────
 *
 * There is no server-side PDF renderer here, and adding one would be the wrong
 * trade. The two options are a headless browser, which cannot run in 512 MB
 * with a tenth of a CPU, or a PDF library — which means maintaining a second
 * layout that inevitably drifts from this one, so the document somebody files
 * for a warranty claim stops matching the document they were shown.
 *
 * The browser's own print pipeline renders exactly what is on screen and has
 * "Save as PDF" built into it on every desktop platform, and behind the share
 * sheet on iOS and Android. One layout, no dependency, and the PDF is
 * guaranteed to match the preview because it *is* the preview.
 *
 * The button says so rather than pretending a download is about to start.
 */
export function InvoiceActions({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="print:hidden mx-auto flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-0">
      <Button variant="ghost" size="sm" render={<Link href={backHref} />}>
        <ArrowLeft aria-hidden className="size-4" />
        {backLabel}
      </Button>

      <div className="flex items-center gap-2">
        <p className="mr-1 hidden text-tertiary-text text-xs sm:block">
          Choose “Save as PDF” in the print dialog to download.
        </p>
        <Button size="sm" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          Print or save as PDF
        </Button>
      </div>
    </div>
  );
}
