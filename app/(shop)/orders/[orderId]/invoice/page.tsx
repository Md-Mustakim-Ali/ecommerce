import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceActions } from "@/components/orders/invoice-actions";
import { InvoiceDocument } from "@/components/orders/invoice-document";
import { getSession } from "@/lib/auth/guards";
import { getInvoiceForBuyer } from "@/lib/orders/invoice";

export const metadata: Metadata = { title: "Invoice" };

/**
 * The buyer's invoice for a whole order.
 *
 * Available in every state, not only when paid. An unpaid invoice is the
 * normal thing to hand somebody who is about to pay by transfer, and the
 * document says plainly which it is — see PAYMENT_COPY in invoice-document.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const session = await getSession();

  // Same authorisation as the order page itself: by account, or by the email
  // the order was placed with so a guest can reach theirs. Not found rather
  // than forbidden — confirming an order exists but is not yours is a small
  // leak with no upside.
  const invoice = await getInvoiceForBuyer({
    orderId,
    userId: session?.user.id ?? null,
    email: session?.user.email,
  });

  if (!invoice) notFound();

  return (
    <div className="pb-16">
      <InvoiceActions
        backHref={`/orders/${orderId}`}
        backLabel="Back to order"
        pdfHref={`/orders/${orderId}/invoice/pdf`}
      />
      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
