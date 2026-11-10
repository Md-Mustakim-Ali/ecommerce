import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceActions } from "@/components/orders/invoice-actions";
import { InvoiceDocument } from "@/components/orders/invoice-document";
import { requireStorePermission } from "@/lib/auth/access";
import { getInvoiceForStore } from "@/lib/orders/invoice";

export const metadata: Metadata = { title: "Invoice" };

/**
 * A seller's invoice for their part of an order.
 *
 * Two separate guards, and both are needed. `requireStorePermission` decides
 * whether this person may see this store's orders at all; `getInvoiceForStore`
 * scopes the query by store id so a sub-order belonging to a different shop
 * resolves to null rather than being fetched and then filtered. A marketplace
 * where one seller can read another's shipments by changing a uuid is a
 * marketplace with no sellers.
 */
export default async function SellerInvoicePage({
  params,
}: {
  params: Promise<{ storeId: string; subOrderId: string }>;
}) {
  const { storeId, subOrderId } = await params;

  await requireStorePermission(storeId, "order.view");

  const invoice = await getInvoiceForStore({ subOrderId, storeId });
  if (!invoice) notFound();

  return (
    <div className="pb-16">
      <InvoiceActions
        backHref={`/dashboard/${storeId}/orders`}
        backLabel="Back to orders"
      />
      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
