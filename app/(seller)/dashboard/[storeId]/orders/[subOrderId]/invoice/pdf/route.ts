import { requireStorePermission } from "@/lib/auth/access";
import { getInvoiceForStore } from "@/lib/orders/invoice";
import { invoiceFilename, renderInvoicePdf } from "@/lib/orders/invoice-pdf";

/**
 * A seller's invoice as a downloaded file.
 *
 * Both guards are repeated from the page, because a route handler is reachable
 * directly and inherits nothing from the page above it. `requireStorePermission`
 * decides whether this person may see the store's orders; the store id inside
 * getInvoiceForStore's WHERE means a sub-order from another shop resolves to
 * null rather than being fetched and then filtered.
 */

/** Node, not Edge: pdfkit reads its font files from disk. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storeId: string; subOrderId: string }> },
) {
  const { storeId, subOrderId } = await params;

  await requireStorePermission(storeId, "order.view");

  const invoice = await getInvoiceForStore({ subOrderId, storeId });
  if (!invoice) return new Response("Not found", { status: 404 });

  const pdf = await renderInvoicePdf(invoice);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${invoiceFilename(invoice)}"`,
      "cache-control": "no-store",
    },
  });
}
