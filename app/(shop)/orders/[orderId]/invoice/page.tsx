import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceActions } from "@/components/orders/invoice-actions";
import { InvoiceDocument } from "@/components/orders/invoice-document";
import { getSession } from "@/lib/auth/guards";
import { withAccessToken } from "@/lib/orders/access";
import { getInvoiceForBuyer } from "@/lib/orders/invoice";
import { claimantFrom } from "@/lib/orders/ownership";

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
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const session = await getSession();

  // Same authorisation as the order page itself: by account, by the contact the
  // order was placed with, or by the signed token a guest arrives holding.
  // Not found rather than forbidden — confirming an order exists but is not
  // yours is a small leak with no upside.
  const invoice = await getInvoiceForBuyer({
    orderId,
    ...claimantFrom(session, query.t),
  });

  if (!invoice) notFound();

  return (
    <div className="pb-16">
      {/*
        Both links carry the token onward. A guest's authorisation is the URL
        and nothing else, so a bare `/orders/{id}` sent them to a 404 on the
        order they had open a moment earlier, and "Save as PDF" refused the
        document already rendered on screen.
      */}
      <InvoiceActions
        backHref={withAccessToken(`/orders/${orderId}`, query.t)}
        backLabel="Back to order"
        pdfHref={withAccessToken(`/orders/${orderId}/invoice/pdf`, query.t)}
      />
      <InvoiceDocument invoice={invoice} />
    </div>
  );
}
