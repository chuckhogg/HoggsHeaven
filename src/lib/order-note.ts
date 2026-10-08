/**
 * Read an order note for the farm desk's order view (pure; browser + tests).
 *
 * Imported GoDaddy/eBay orders keep the details the orders table has no column
 * for in the note, one "Label: value" per line, e.g.
 *
 *   Imported from GoDaddy order history. Sales channel: Online Store. Original order #R123.
 *   Original statuses: fulfillment Fulfilled, payment Paid.
 *   Payment method: Credit/Debit Card - GoDaddy Payments
 *   Tracking #: 9400...
 *
 * `parseOrderNote` turns that into labelled fields plus any free-text lines, so
 * the view can show channel / payment / tracking / coupon readably. Anything
 * it doesn't recognize stays as plain text; the raw note is never changed.
 *
 * No path aliases: node's --experimental-strip-types test runner imports this directly.
 */

export type NoteField = { key: string; label: string; value: string };

export type ParsedNote = {
  /** True when the note came from the historical GoDaddy/eBay import. */
  imported: boolean;
  fields: NoteField[];
  /** Lines that aren't "Label: value" pairs, in order. */
  text: string[];
  /** Discount in dollars when the note records one (imported orders), else null. */
  discount: number | null;
};

const KNOWN: Record<string, string> = {
  "sales channel": "Sales channel",
  "original order #": "Original order #",
  "original statuses": "Original statuses",
  "payment method": "Payment method",
  "shipping method": "Shipping method",
  "tracking #": "Tracking #",
  "tracking": "Tracking #",
  "coupon": "Coupon",
  "discount": "Discount",
  "tax method": "Tax method",
  "gift cards": "Gift cards",
  "special instructions": "Special instructions",
  "billing": "Billing",
};

function keyOf(label: string) {
  return label.toLowerCase().replace(/[^a-z#]+/g, "-").replace(/^-|-$/g, "");
}

function pushField(fields: NoteField[], label: string, value: string) {
  const clean = value.trim().replace(/\.$/, "");
  if (!clean) return;
  const known = KNOWN[label.trim().toLowerCase()];
  const shown = known ?? label.trim();
  fields.push({ key: keyOf(shown), label: shown, value: clean });
}

/** "Label: value" with a short, letter-led label (avoids splitting URLs or times like 10:30). */
const PAIR = /^([A-Za-z][A-Za-z #/()-]{1,40}?):\s+(.+)$/;

export function parseOrderNote(note: string): ParsedNote {
  const fields: NoteField[] = [];
  const text: string[] = [];
  let imported = false;
  for (const rawLine of String(note ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = /^Imported from (GoDaddy|eBay)[^.]*\.\s*(.*)$/i.exec(line);
    if (head) {
      imported = true;
      // "Sales channel: Online Store. Original order #R123."
      const rest = head[2] ?? "";
      const channel = /Sales channel:\s*([^.]+)\./i.exec(rest + (rest.endsWith(".") ? "" : "."));
      if (channel) pushField(fields, "Sales channel", channel[1] ?? "");
      const original = /Original order #\s*([^\s.]+)/i.exec(rest);
      if (original) pushField(fields, "Original order #", original[1] ?? "");
      continue;
    }
    const pair = PAIR.exec(line);
    if (pair && !/^https?$/i.test(pair[1] ?? "")) {
      pushField(fields, pair[1] ?? "", pair[2] ?? "");
      continue;
    }
    text.push(line);
  }
  const discountField = fields.find((field) => field.key === "discount");
  let discount: number | null = null;
  if (discountField) {
    const n = Number(discountField.value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) discount = Math.round(n * 100) / 100;
  }
  return { imported, fields, text, discount };
}

/** A carrier tracking page for a tracking number, when the format is recognizable. */
export function trackingUrl(value: string): string | null {
  const n = value.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`;
  if (/^(9[2-5]\d{18,24}|[A-Z]{2}\d{9}US|\d{20,22})$/.test(n)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`;
  }
  return null;
}
