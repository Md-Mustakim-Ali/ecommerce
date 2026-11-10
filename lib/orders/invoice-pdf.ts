import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatMoney } from "@/lib/money/format";
import type { Invoice, PaymentState } from "./invoice";

/**
 * The invoice as a downloadable PDF.
 *
 * Built from the same `Invoice` object the on-screen document renders, so the
 * two cannot disagree about a number. The layout differs — a print stylesheet
 * and a PDF drawing API are not the same medium — but every figure comes from
 * one source, which is the part that matters on a document somebody files.
 *
 * ── Why pdfkit and not a headless browser ────────────────────────────────
 *
 * Chromium will not run in 512 MB with a tenth of a CPU, which is what this
 * deploys onto. pdfkit is pure JavaScript, draws in a few hundred milliseconds,
 * and produces a PDF with real selectable text rather than a screenshot — the
 * difference between a document somebody can search and copy an order number
 * out of, and a picture of one.
 *
 * ── Fonts, and why there are two ─────────────────────────────────────────
 *
 * PDF's fourteen built-in fonts are Latin-only. On a Bangladeshi marketplace
 * that is not a cosmetic problem: a product named "শার্ট" would print as
 * nothing, on the document its buyer relies on for a warranty claim. And ৳
 * (U+09F3) is absent too, so even the totals would be wrong.
 *
 * Both subsets below come from one family, Noto Sans Bengali, so mixing them
 * mid-line is seamless. The fonts are split by script: the Latin subset carries
 * A–Z, digits and punctuation but not ৳; the Bengali subset carries ৳ and the
 * Bengali letters but no Latin at all. Neither alone can set the string
 * "৳756.04", which is why `drawRuns` exists.
 *
 * They are read from disk rather than imported. Resolving them as modules made
 * Turbopack try to bundle a .woff as JavaScript and fail the download route at
 * runtime with "Unknown module type" — see assets/fonts/README.md.
 */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

/**
 * Read once per process, not per invoice. Four files totalling 137 KB is
 * nothing to hold, and re-reading them on every download would put four
 * synchronous disk reads in the path of a request on a tenth of a CPU.
 */
let fontCache: Record<
  "latin" | "latinBold" | "bengali" | "bengaliBold",
  Buffer
> | null = null;

function fonts() {
  if (fontCache) return fontCache;
  const read = (name: string) =>
    readFileSync(path.join(FONT_DIR, `noto-sans-bengali-${name}.woff`));
  fontCache = {
    latin: read("latin-400"),
    latinBold: read("latin-600"),
    bengali: read("bengali-400"),
    bengaliBold: read("bengali-600"),
  };
  return fontCache;
}

/** The Bengali block, which is also where ৳ lives. */
const BENGALI = /[ঀ-৿]/;

const PAYMENT_LABEL: Record<PaymentState, string> = {
  pending: "UNPAID",
  paid: "PAID",
  partially_fulfilled: "PAID",
  fulfilled: "PAID",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
  payment_reversed: "PAYMENT REVERSED",
};

const PAYMENT_NOTE: Record<PaymentState, string> = {
  pending: "This invoice has not been paid. It is not proof of payment.",
  paid: "Payment received in full.",
  partially_fulfilled:
    "Payment received in full. Part of this order has shipped.",
  fulfilled: "Payment received in full. This order has been delivered.",
  cancelled: "This order was cancelled and nothing is owed.",
  refunded: "This order was paid and has since been refunded.",
  payment_reversed:
    "A payment recorded against this order was later withdrawn. This is not a refund and this document is not proof of payment.",
};

const FULFILMENT_LABEL: Record<string, string> = {
  pending: "Awaiting dispatch",
  accepted: "Preparing for dispatch",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Splits a string into script runs and draws each in a font that can render it.
 *
 * pdfkit has no font fallback: a glyph the current font lacks is dropped
 * silently, so "৳756.04" set in the Latin subset comes out as "756.04" — the
 * kind of error that is invisible in code review and obvious on a printed
 * invoice a customer is holding.
 *
 * Runs are chained with `continued`, so a mixed line still wraps and aligns as
 * one paragraph rather than as several stacked fragments.
 */
function drawRuns(
  doc: Doc,
  text: string,
  options: { bold?: boolean; width?: number; align?: "left" | "right" } = {},
) {
  const runs: { text: string; bengali: boolean }[] = [];

  for (const char of text) {
    const bengali = BENGALI.test(char);
    const last = runs.at(-1);
    if (last && last.bengali === bengali) last.text += char;
    else runs.push({ text: char, bengali });
  }

  runs.forEach((run, index) => {
    const font = run.bengali
      ? options.bold
        ? "bengaliBold"
        : "bengali"
      : options.bold
        ? "latinBold"
        : "latin";

    doc.font(font).text(run.text, {
      continued: index < runs.length - 1,
      width: options.width,
      align: options.align,
    });
  });
}

/** Measures a mixed-script string the same way drawRuns will set it. */
function widthOf(doc: Doc, text: string, size: number, bold = false): number {
  let total = 0;
  for (const char of text) {
    const font = BENGALI.test(char)
      ? bold
        ? "bengaliBold"
        : "bengali"
      : bold
        ? "latinBold"
        : "latin";
    total += doc.font(font).fontSize(size).widthOfString(char);
  }
  return total;
}

/** Right-aligns a mixed-script string at `right`, on the current line. */
function drawRight(
  doc: Doc,
  text: string,
  right: number,
  y: number,
  size: number,
  bold = false,
) {
  let x = right - widthOf(doc, text, size, bold);
  for (const char of text) {
    const font = BENGALI.test(char)
      ? bold
        ? "bengaliBold"
        : "bengali"
      : bold
        ? "latinBold"
        : "latin";
    doc.font(font).fontSize(size).text(char, x, y, { lineBreak: false });
    x += doc.widthOfString(char);
  }
}

export async function renderInvoicePdf(
  invoice: Invoice,
  platformName = "Marketplace",
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: {
      Title: `Invoice ${invoice.invoiceNumber}`,
      Author: platformName,
      Subject: `Order ${invoice.orderNumber}`,
      // Not "now". A reprint is not a new event, and a PDF whose creation date
      // moves every download is weaker evidence than one that does not.
      CreationDate: invoice.placedAt,
    },
  });

  const font = fonts();
  doc.registerFont("latin", font.latin);
  doc.registerFont("latinBold", font.latinBold);
  doc.registerFont("bengali", font.bengali);
  doc.registerFont("bengaliBold", font.bengaliBold);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) =>
    doc.on("end", () => resolve()),
  );

  const money = (cents: number) => formatMoney(cents, invoice.currency);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  // ── Header ───────────────────────────────────────────────────────────────
  doc.font("latinBold").fontSize(20).text("Invoice", left, left);
  doc.font("latin").fontSize(10).fillColor("#000");
  doc.text(invoice.invoiceNumber, left, doc.y + 2);
  doc.fillColor("#555").text(`Order ${invoice.orderNumber}`);
  doc.fillColor("#000");

  const headerTop = left;
  drawRight(doc, platformName, right, headerTop + 2, 12, true);
  drawRight(
    doc,
    invoice.placedAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    right,
    headerTop + 20,
    9,
  );

  // The status, carried by a box and a word rather than by colour — this comes
  // out of a black-and-white printer more often than not.
  const label = PAYMENT_LABEL[invoice.payment];
  const labelWidth = widthOf(doc, label, 10, true) + 16;
  doc.rect(right - labelWidth, headerTop + 36, labelWidth, 20).stroke("#000");
  drawRight(doc, label, right - 8, headerTop + 42, 10, true);

  doc.y = Math.max(doc.y, headerTop + 62);
  doc
    .moveTo(left, doc.y + 6)
    .lineTo(right, doc.y + 6)
    .stroke("#ccc");
  doc.y += 14;

  doc.fillColor("#444").fontSize(9);
  drawRuns(doc, PAYMENT_NOTE[invoice.payment], { width: contentWidth });
  doc.fillColor("#000");

  // ── Parties ──────────────────────────────────────────────────────────────
  const partiesTop = doc.y + 14;
  const colWidth = contentWidth / 2 - 10;

  const address = (a: Invoice["shippingAddress"]) =>
    [
      a.recipientName,
      a.line1,
      a.line2,
      `${a.city}${a.region ? `, ${a.region}` : ""} ${a.postalCode}`,
      a.countryCode,
      a.phone,
    ]
      .filter(Boolean)
      .join("\n");

  doc.font("latinBold").fontSize(8).text("BILLED TO", left, partiesTop);
  doc.y = partiesTop + 12;
  doc.x = left;
  drawRuns(
    doc,
    `${address(invoice.billingAddress ?? invoice.shippingAddress)}\n${invoice.buyerEmail}`,
    { width: colWidth },
  );
  const billedBottom = doc.y;

  doc
    .font("latinBold")
    .fontSize(8)
    .text("DELIVERED TO", left + colWidth + 20, partiesTop);
  doc.y = partiesTop + 12;
  doc.x = left + colWidth + 20;
  drawRuns(doc, address(invoice.shippingAddress), { width: colWidth });

  doc.x = left;
  doc.y = Math.max(billedBottom, doc.y) + 18;

  // ── Lines, grouped by supplier ───────────────────────────────────────────
  const cols = {
    description: left,
    qty: left + contentWidth * 0.58,
    unit: left + contentWidth * 0.7,
    amount: right,
  };

  for (const group of invoice.groups) {
    // Keep a group heading with at least one row rather than orphaning it at
    // the foot of a page.
    if (doc.y > doc.page.height - 160) doc.addPage();

    const supplier = group.billingName ?? group.storeName;
    doc.x = left;
    doc.font("latinBold").fontSize(10);
    drawRuns(doc, supplier, { bold: true, width: contentWidth * 0.7 });
    const supplierY = doc.y;

    drawRight(
      doc,
      FULFILMENT_LABEL[group.fulfilment] ?? group.fulfilment,
      right,
      supplierY - 12,
      9,
    );

    const meta = [group.billingAddress, group.supportEmail, group.supportPhone]
      .filter(Boolean)
      .join(" · ");
    if (meta) {
      doc.x = left;
      doc.fillColor("#666").fontSize(8);
      drawRuns(doc, meta, { width: contentWidth });
      doc.fillColor("#000");
    }

    doc.y += 6;
    const headY = doc.y;
    doc.font("latinBold").fontSize(8.5);
    doc.text("DESCRIPTION", cols.description, headY);
    drawRight(doc, "QTY", cols.unit - 12, headY, 8.5, true);
    drawRight(doc, "UNIT", cols.amount - 70, headY, 8.5, true);
    drawRight(doc, "AMOUNT", cols.amount, headY, 8.5, true);
    doc.y = headY + 12;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke("#ccc");
    doc.y += 6;

    for (const line of group.lines) {
      if (doc.y > doc.page.height - 90) doc.addPage();

      const rowY = doc.y;
      doc.x = cols.description;
      doc.fontSize(9.5).fillColor("#000");
      drawRuns(doc, line.productTitle, { width: contentWidth * 0.55 });

      const detail = [line.variantLabel, line.sku ? `SKU ${line.sku}` : null]
        .filter(Boolean)
        .join(" · ");
      if (detail) {
        doc.x = cols.description;
        doc.fillColor("#666").fontSize(8);
        drawRuns(doc, detail, { width: contentWidth * 0.55 });
        doc.fillColor("#000");
      }

      drawRight(doc, String(line.quantity), cols.unit - 12, rowY, 9.5);
      drawRight(doc, money(line.unitPriceCents), cols.amount - 70, rowY, 9.5);
      drawRight(doc, money(line.lineTotalCents), cols.amount, rowY, 9.5);

      doc.y += 6;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke("#eee");
      doc.y += 6;
    }

    doc.y += 6;
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  if (doc.y > doc.page.height - 180) doc.addPage();

  const totalsLeft = right - 220;
  const row = (name: string, value: string, bold = false, rule?: string) => {
    if (rule) {
      doc.moveTo(totalsLeft, doc.y).lineTo(right, doc.y).stroke(rule);
      doc.y += 6;
    }
    const y = doc.y;
    doc.x = totalsLeft;
    doc.font(bold ? "latinBold" : "latin").fontSize(bold ? 11 : 9.5);
    doc.text(name, totalsLeft, y, { lineBreak: false });
    drawRight(doc, value, right, y, bold ? 11 : 9.5, bold);
    doc.y = y + (bold ? 16 : 14);
  };

  row("Items", money(invoice.subtotalCents));
  row("Delivery", money(invoice.shippingCents));
  if (invoice.discountCents > 0) {
    row("Discount", `-${money(invoice.discountCents)}`);
  }
  if (invoice.taxCents > 0) row("Tax", money(invoice.taxCents));

  row(
    invoice.scope === "seller" ? "Shipment total" : "Total",
    money(invoice.totalCents),
    true,
    "#000",
  );

  if (invoice.refundedCents > 0) {
    row("Refunded", `-${money(invoice.refundedCents)}`);
    row(
      "Net paid",
      money(invoice.totalCents - invoice.refundedCents),
      true,
      "#999",
    );
  }

  // ── Footnotes ────────────────────────────────────────────────────────────
  doc.y += 16;
  if (doc.y > doc.page.height - 90) doc.addPage();

  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke("#ccc");
  doc.y += 10;
  doc.x = left;
  doc.fillColor("#555").fontSize(8);

  if (invoice.scope === "seller" && invoice.parentOrderHadDiscount) {
    drawRuns(
      doc,
      "This shipment was part of a larger order that carried a marketplace-wide discount. The amount the buyer paid across the whole order therefore differs from the shipment total above.",
      { width: contentWidth },
    );
    doc.y += 4;
  }

  if (invoice.paymentReference) {
    doc.x = left;
    drawRuns(doc, `Payment reference: ${invoice.paymentReference}`, {
      width: contentWidth,
    });
    doc.y += 4;
  }

  doc.x = left;
  drawRuns(
    doc,
    invoice.scope === "seller"
      ? "Issued by the seller named above. Retain this document for warranty and returns."
      : `Issued by ${platformName} on behalf of the sellers named above. Retain this document for warranty and returns.`,
    { width: contentWidth },
  );

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

/** A filename somebody can find again in a downloads folder. */
export function invoiceFilename(invoice: Invoice): string {
  return `${invoice.invoiceNumber}.pdf`;
}
