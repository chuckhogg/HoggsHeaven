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
