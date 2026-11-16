import { getSession } from "@/lib/auth/guards";
import { getInvoiceForBuyer } from "@/lib/orders/invoice";
import { invoiceFilename, renderInvoicePdf } from "@/lib/orders/invoice-pdf";

/**
 * The buyer's invoice as a downloaded file.
 *
 * Authorisation is the same as the page it sits under, and repeated here
 * rather than assumed: a route handler is reachable directly, so "the page
 * already checked" is not a check.
 */

/** Node, not Edge: pdfkit needs the filesystem to read its font files. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const session = await getSession();

  const invoice = await getInvoiceForBuyer({
    orderId,
    userId: session?.user.id ?? null,
    email: session?.user.email,
    // Carried through from the page's own URL, so a guest can download the
    // invoice they can already see rather than being refused at the last step.
    accessToken: new URL(request.url).searchParams.get("t") ?? undefined,
  });

  // 404 rather than 403, matching the page: confirming an order exists but is
  // not yours is a small leak with no upside.
  if (!invoice) return new Response("Not found", { status: 404 });

  const pdf = await renderInvoicePdf(invoice);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // `attachment` is what makes this a download rather than a tab. The
      // filename is the invoice number, so it is findable later in a downloads
      // folder full of other people's paperwork.
      "content-disposition": `attachment; filename="${invoiceFilename(invoice)}"`,
      // An invoice can change — it gets refunded, reversed, fulfilled — so a
      // cached copy would hand somebody a stale document while showing them a
      // fresh one on screen.
      "cache-control": "no-store",
    },
  });
}
