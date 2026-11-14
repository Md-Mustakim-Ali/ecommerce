import { formatMoney } from "@/lib/money/format";
import type { Invoice, PaymentState } from "@/lib/orders/invoice";
import { cn } from "@/lib/utils";

/**
 * The invoice, as it prints.
 *
 * Designed for A4 first and the screen second, which is the opposite of every
 * other surface here. The thing people actually keep is the sheet of paper, so
 * the layout is fixed-width, black on white, and free of anything that only
 * makes sense with a cursor.
 *
 * A server component with no interactivity. The buttons that print it live in
 * invoice-actions.tsx, and are hidden from the printed page by `print:hidden`.
 */

/**
 * What each payment state means on a document somebody may be holding a year
 * from now.
 *
 * Every state gets its own words rather than collapsing into paid/unpaid,
 * because the difference between "we refunded you" and "the payment was
 * withdrawn" is exactly what a dispute turns on. `payment_reversed` in
 * particular has to be unmistakable: it means money we were told arrived did
 * not, which is not the same as a refund and must never read like one.
 */
const PAYMENT_COPY: Record<
  PaymentState,
  { label: string; note: string; tone: "paid" | "unpaid" | "void" }
> = {
  pending: {
    label: "Unpaid",
    note: "This invoice has not been paid. It is not proof of payment.",
    tone: "unpaid",
  },
  paid: {
    label: "Paid",
    note: "Payment received in full.",
    tone: "paid",
  },
  partially_fulfilled: {
    label: "Paid",
    note: "Payment received in full. Part of this order has shipped.",
    tone: "paid",
  },
  fulfilled: {
    label: "Paid",
    note: "Payment received in full. This order has been delivered.",
    tone: "paid",
  },
  cancelled: {
    label: "Cancelled",
    note: "This order was cancelled and nothing is owed.",
    tone: "void",
  },
  refunded: {
    label: "Refunded",
    note: "This order was paid and has since been refunded.",
    tone: "void",
  },
  payment_reversed: {
    label: "Payment reversed",
    note: "A payment recorded against this order was later withdrawn. This is not a refund and this document is not proof of payment.",
    tone: "void",
  },
};

const FULFILMENT_COPY: Record<string, string> = {
  pending: "Awaiting dispatch",
  accepted: "Preparing for dispatch",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

function Address({ address }: { address: Invoice["shippingAddress"] }) {
  return (
    <div className="not-prose text-[11pt] leading-snug">
      <div>{address.recipientName}</div>
      <div>{address.line1}</div>
      {address.line2 ? <div>{address.line2}</div> : null}
      <div>
        {address.city}
        {address.region ? `, ${address.region}` : ""} {address.postalCode}
      </div>
      <div>{address.countryCode}</div>
      {address.phone ? <div className="tabular">{address.phone}</div> : null}
    </div>
  );
}

export function InvoiceDocument({
  invoice,
  platformName = "Marketplace",
}: {
  invoice: Invoice;
  platformName?: string;
}) {
  const money = (cents: number) => formatMoney(cents, invoice.currency);
  const payment = PAYMENT_COPY[invoice.payment];
  const netPaidCents = invoice.totalCents - invoice.refundedCents;

  return (
    <article
      className={cn(
        // Fixed measure so the screen preview matches the sheet. Black on white
        // in both themes: an invoice printed from dark mode either wastes a
        // cartridge or comes out unreadable, and the buyer should see on screen
        // exactly what they will get on paper.
        "mx-auto w-full max-w-[210mm] bg-white p-8 text-[11pt] text-black sm:p-12",
        "print:max-w-none print:p-0",
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-6 border-black/15 border-b pb-6">
        <div>
          <h1 className="font-semibold text-[20pt] leading-none tracking-tight">
            Invoice
          </h1>
          <p className="tabular mt-2 text-[11pt]">{invoice.invoiceNumber}</p>
          <p className="mt-1 text-[10pt] text-black/60">
            Order {invoice.orderNumber}
          </p>
        </div>

        <div className="text-right">
          <div className="font-semibold text-[13pt]">{platformName}</div>
          <div className="mt-1 text-[10pt] text-black/60">
            {invoice.placedAt.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
          {/*
            A status word, not a colour. A red badge is invisible on the
            black-and-white printer this will actually come out of, so the
            state is carried by the text and a border rather than by hue.
          */}
          <div
            className={cn(
              "mt-3 inline-block border px-3 py-1 font-semibold text-[11pt] uppercase tracking-wide",
              payment.tone === "paid" && "border-black bg-black text-white",
              payment.tone === "unpaid" && "border-black border-dashed",
              payment.tone === "void" && "border-black/40 text-black/70",
            )}
          >
            {payment.label}
          </div>
        </div>
      </header>

      <p className="mt-3 text-[10pt] text-black/70">{payment.note}</p>

      {/* ── Parties ────────────────────────────────────────────────────── */}
      <section className="mt-8 grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold text-[9pt] uppercase tracking-widest">
            Billed to
          </h2>
          <Address
            address={invoice.billingAddress ?? invoice.shippingAddress}
          />
          {/* Whichever contact the order carries. Never both blank — the
              orders table has a check constraint saying so. */}
          <div className="mt-1 text-[10pt] text-black/70">
            {invoice.buyerEmail ?? invoice.buyerPhone}
          </div>
        </div>

        <div>
          <h2 className="mb-2 font-semibold text-[9pt] uppercase tracking-widest">
            Delivered to
          </h2>
          <Address address={invoice.shippingAddress} />
        </div>
      </section>

      {/* ── Lines, grouped by supplier ─────────────────────────────────── */}
      {invoice.groups.map((group, index) => (
        <section key={`${group.storeName}-${index}`} className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-black/15 border-b pb-1">
            <h2 className="font-semibold text-[11pt]">
              {/*
                The legal entity where the seller recorded one, because that is
                the party a warranty claim is made against. The trading name is
                shown beside it so the buyer recognises who they bought from.
              */}
              {group.billingName ?? group.storeName}
              {group.billingName && group.billingName !== group.storeName ? (
                <span className="ml-2 font-normal text-[10pt] text-black/60">
                  trading as {group.storeName}
                </span>
              ) : null}
            </h2>
            <span className="text-[10pt] text-black/60">
              {FULFILMENT_COPY[group.fulfilment] ?? group.fulfilment}
            </span>
          </div>

          {group.billingAddress || group.supportEmail || group.supportPhone ? (
            <p className="mt-1 text-[9pt] text-black/60">
              {[group.billingAddress, group.supportEmail, group.supportPhone]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}

          <table className="mt-3 w-full border-collapse text-[10.5pt]">
            <thead>
              <tr className="border-black/15 border-b text-left">
                <th className="py-1.5 font-medium">Description</th>
                <th className="py-1.5 text-right font-medium">Qty</th>
                <th className="py-1.5 text-right font-medium">Unit</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {group.lines.map((line, lineIndex) => (
                <tr
                  key={`${line.sku ?? line.productTitle}-${lineIndex}`}
                  className="border-black/10 border-b align-top"
                >
                  <td className="py-2 pr-3">
                    <div>{line.productTitle}</div>
                    {line.variantLabel ? (
                      <div className="text-[9.5pt] text-black/60">
                        {line.variantLabel}
                      </div>
                    ) : null}
                    {/*
                      Printed because it is what a warranty claim is made
                      against. "The black one" is not a serviceable
                      identification a year later.
                    */}
                    {line.sku ? (
                      <div className="tabular text-[9pt] text-black/50">
                        SKU {line.sku}
                      </div>
                    ) : null}
                  </td>
                  <td className="tabular py-2 text-right">{line.quantity}</td>
                  <td className="tabular py-2 text-right">
                    {money(line.unitPriceCents)}
                  </td>
                  <td className="tabular py-2 text-right">
                    {money(line.lineTotalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Per-seller subtotals only matter when there is more than one. */}
          {invoice.groups.length > 1 ? (
            <div className="tabular mt-2 flex justify-end gap-8 text-[10pt] text-black/70">
              <span>Items {money(group.subtotalCents)}</span>
              <span>Delivery {money(group.shippingCents)}</span>
            </div>
          ) : null}
        </section>
      ))}

      {/* ── Totals ─────────────────────────────────────────────────────── */}
      <section className="mt-8 flex justify-end">
        <dl className="w-full max-w-[80mm] text-[11pt]">
          <div className="flex justify-between py-1">
            <dt>Items</dt>
            <dd className="tabular">{money(invoice.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between py-1">
            <dt>Delivery</dt>
            <dd className="tabular">{money(invoice.shippingCents)}</dd>
          </div>
          {invoice.discountCents > 0 ? (
            <div className="flex justify-between py-1">
              <dt>Discount</dt>
              <dd className="tabular">−{money(invoice.discountCents)}</dd>
            </div>
          ) : null}
          {invoice.taxCents > 0 ? (
            <div className="flex justify-between py-1">
              <dt>Tax</dt>
              <dd className="tabular">{money(invoice.taxCents)}</dd>
            </div>
          ) : null}

          <div className="mt-1 flex justify-between border-black border-t-2 py-2 font-semibold text-[12pt]">
            <dt>{invoice.scope === "seller" ? "Shipment total" : "Total"}</dt>
            <dd className="tabular">{money(invoice.totalCents)}</dd>
          </div>

          {/*
            Refunds are shown as their own line rather than silently reducing
            the total. The original charge and the money returned are two
            separate facts, and a document that quietly nets them cannot be
            reconciled against a bank statement showing both.
          */}
          {invoice.refundedCents > 0 ? (
            <>
              <div className="flex justify-between py-1 text-black/70">
                <dt>Refunded</dt>
                <dd className="tabular">−{money(invoice.refundedCents)}</dd>
              </div>
              <div className="flex justify-between border-black/30 border-t py-2 font-semibold">
                <dt>Net paid</dt>
                <dd className="tabular">{money(netPaidCents)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </section>

      {/* ── Footnotes that keep the document honest ────────────────────── */}
      <footer className="mt-10 border-black/15 border-t pt-4 text-[9pt] text-black/60">
        {invoice.scope === "seller" && invoice.parentOrderHadDiscount ? (
          <p className="mb-2">
            This shipment was part of a larger order that carried a
            marketplace-wide discount. The amount the buyer paid across the
            whole order therefore differs from the shipment total above.
          </p>
        ) : null}

        {invoice.paymentReference ? (
          <p className="tabular mb-2">
            Payment reference: {invoice.paymentReference}
          </p>
        ) : null}

        <p>
          {invoice.scope === "seller"
            ? "Issued by the seller named above. Retain this document for warranty and returns."
            : `Issued by ${platformName} on behalf of the sellers named above. Retain this document for warranty and returns.`}
        </p>
      </footer>
    </article>
  );
}
