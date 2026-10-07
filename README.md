# Hogg's Heaven Farm

Online store for Hogg's Heaven Farm in Shelbyville, Kentucky: hatching eggs, chicks, cart, checkout, and order tracking.

Catalog and photos come from the live farm listings. Live birds are farm pickup only. Hatching eggs can ship.

## Orders and payments

- Orders are saved on the server, in the store database (Postgres when `DATABASE_URL` is set, otherwise an in-memory PGLite database that resets when the dev server restarts). The shopper's browser also keeps a copy of their receipt so they can see it again.
- Checkout never collects card numbers, expiration dates, or security codes. Every new order starts as **Awaiting payment**. Card charges stay on Stripe or Square, and the farm marks an order paid from the desk once the payment has cleared.
- Shoppers track an order with its order number and email. They never need an account.

## Farm desk (admin)

The desk at `/admin` manages listings and orders. Sign in at `/login` with **Continue with Google**.

- **Who can claim the desk:** the first claim must come from a signed-in account with a **verified** email that is on the `FARM_OWNER_EMAILS` list. A Google sign-in counts as verified. Once claimed, the desk belongs to that one account and every other account sees "This farm desk belongs to another account."
- **Deployed store with no `FARM_OWNER_EMAILS`:** nobody can claim the desk. Set the variable first.
- **Local dev and the sandbox preview with no `FARM_OWNER_EMAILS`:** the first signed-in account can claim, like before. That database is throwaway.
- **Google, X, and password accounts are never merged by email unless the existing account's email is verified.** X emails are placeholders, so an X sign-in never joins another account.
- **Email/password sign-up is turned off on a deployed store.** The app has no email sender to verify a new address, so a sign-up could only reserve someone else's email. It still works in local dev for testing.

The rules live in `src/lib/auth/farm-access.ts`. Their tests are in `src/lib/auth/account-linking.test.ts` and `src/lib/desk-access.test.ts`.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `FARM_OWNER_EMAILS` | Deployed (required to open the desk) | Comma-separated emails allowed to claim the desk, e.g. the farm's Google account. Case doesn't matter. |
| `DATABASE_URL` | Deployed | Postgres connection. Its presence also marks the store as deployed. |
| `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GROK_AUTH_ISSUER`, `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET` | Deployed | Sign-in. Injected by the deployer. |

A store counts as deployed when `DATABASE_URL` or `GROK_PROJECT_ID` is set, or `NODE_ENV=production`.

## Development

Requires Node 22.6 or newer (`npm test` uses `--experimental-strip-types`). Use npm 11 for `npm ci` (npm 10 rejects this lockfile).

```sh
npm ci
npm run dev        # http://localhost:8080
npm test
npm run typecheck
npm run lint
npm run build
```

A real Google sign-in through the shared preview sign-in client only works on a `*.grok-sandbox.com` preview host, because that client is registered only for `https://*.grok-sandbox.com/api/auth/oauth2/callback/*` (see `src/lib/auth/preview.ts`). On `localhost`, the Google button still reaches the sign-in broker, but its return address is `http://localhost:8080/...`, which that client doesn't allow. A deployed store uses its own sign-in client and `BETTER_AUTH_URL` instead.

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
