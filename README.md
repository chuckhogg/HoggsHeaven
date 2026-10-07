# Hogg's Heaven Farm

Online store for Hogg's Heaven Farm in Shelbyville, Kentucky. Hatching eggs, chicks, cart, checkout, and order tracking.

Catalog and photos come from the live farm listings. Card checkout on this build records a sandbox payment (last four digits only) until Stripe is connected. Orders are saved in the browser. The farm desk code starts as `heaven`.

## Importing historical orders

`scripts/import-orders.mjs` is a one-time import of the old GoDaddy Online Store and eBay order export (CSV) into the `orders` and `order_items` tables. It writes rows directly, so each order keeps its original date, subtotal, shipping, tax, total, status and line items. Nothing is recalculated.

The export holds customer names, emails, phones and addresses, so it is **not** in this repo (`*.csv` is gitignored). Keep it outside the project and pass its path:

```sh
# 1. Preview: runs every insert in a transaction, prints a summary and flagged orders, then rolls back.
DATABASE_URL=postgres://... npm run import:orders -- /path/to/orders.csv --dry-run

# 2. Import for real (one transaction; re-running skips orders already imported).
DATABASE_URL=postgres://... npm run import:orders -- /path/to/orders.csv
```

Run it after the deploy has applied migrations (`npm run build` runs `db:migrate`). Options: `--owner <userId>` sets `owner_user_id` (default: the claimed desk owner, or `pending`, which claiming the desk takes over), `--skip R123,R456` leaves orders out, and `--json` prints the summary as JSON. Without `DATABASE_URL` only `--dry-run` works, against a throwaway in-memory database.

- **Order id** is the original order number (for example `R123456789`), so customers can still look an order up with it and their email.
- **Status:** Cancelled → `cancelled`. Payment Refunded → `cancelled` with "Refunded" in the note and history. Fulfilled → `completed`. Awaiting Pickup → `ready-for-pickup` if Paid, else `awaiting-payment`. Unfulfilled → `paid` if Paid, else `awaiting-payment`. The CSV's payment status is the record; no payment is invented.
- **Method:** `pickup` for "In-Person Scheduled Pickup", otherwise `ship`. The address comes from the shipping fields, then billing. Pickup orders with neither get the farm pickup address.
- **Note** holds what has no column: sales channel, original statuses, payment method text, shipping method, tracking #, coupon, discount, tax method, special instructions, and billing details when they differ.
- **History** records the original order, payment and fulfillment timestamps and ends on the mapped status.
- **Line items:** label comes from the item options and price from the sale price. Kind is `eggs` for hatching eggs (SKU contains `HEGGS` or the name or option says "Hatching Eggs"), otherwise `birds`. Slug and variant are matched to the store listings by SKU, then name, then by the closest listing name. Anything unmatched gets a slug made from its name.
- Card data is never imported. The script refuses a file with card-number, expiry or security-code columns.

Editing an imported order in the farm desk saves it through the normal order form, which recalculates shipping and tax at today's rates and trims notes to 500 characters. Change historical orders there only if that's acceptable.
