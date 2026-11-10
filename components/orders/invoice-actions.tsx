"use client";

import { ArrowLeft, Download, Printer } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The controls above an invoice. Hidden from the printed sheet.
 *
 * Two separate actions, because they are two different intentions:
 *
 *   Save  — a real file, generated server-side by lib/orders/invoice-pdf.ts and
 *           returned with Content-Disposition: attachment. A plain link rather
 *           than a fetch-and-blob dance, so the browser's own download manager
 *           handles it and a slow connection shows real progress.
 *
 *   Print — the browser's print pipeline against the document on screen.
 *
 * They deliberately produce slightly different-looking documents: the printed
 * sheet is this page's HTML, the saved file is drawn by pdfkit. Both read the
 * same Invoice object, so no figure can differ between them — which is the part
 * that matters on something filed for a warranty claim.
 */
export function InvoiceActions({
  backHref,
  backLabel,
  pdfHref,
}: {
  backHref: string;
  backLabel: string;
  pdfHref: string;
}) {
  return (
    <div className="print:hidden mx-auto flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-0">
      <Button variant="ghost" size="sm" render={<Link href={backHref} />}>
        <ArrowLeft aria-hidden className="size-4" />
        {backLabel}
      </Button>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          // A real navigation, not next/link: the response is an attachment, so
          // the browser downloads it and stays put. Routing through the client
          // router would try to render a PDF as a page.
          render={<a href={pdfHref} />}
        >
          <Download aria-hidden className="size-4" />
          Save as PDF
        </Button>

        <Button size="sm" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          Print
        </Button>
      </div>
    </div>
  );
}
