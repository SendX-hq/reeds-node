# Changelog

## 0.1.3 (2026-11-10)

- A fuller README: the services the library covers, every Shipping call, delivery statuses, webhook events, errors, retries and TypeScript use.
- The wallet top-up example takes only `amount`, as the API does, and shows the `reference` that `wallet.funded` carries.

## 0.1.2 (2026-11-10)

- The README shows the Reeds logo.
- Published through npm trusted publishing: CI proves where the package was built without a stored npm token.

## 0.1.1 (2026-11-10)

- An empty `baseUrl` (for example an unset environment variable passed through) now means the default, `https://api.getreeds.co`, instead of failing with "Invalid URL".

## 0.1.0 (2026-11-09)

The first release, for the Shipping API. Install with `npm install reeds-sdk`.

- `reeds.shipping`: coverage, quotes, deliveries (create, list, get, update, book, mark ready, cancel, label), the wallet (get, fund, transactions), invoices (list, get, PDF) and the sandbox.
- `reeds.webhooks`: signature verification, typed events, test events.
- Access tokens fetched and refreshed automatically; an `Idempotency-Key` on every `POST`; safe retries with `Retry-After`; cursor pagination with `for await`; one error class per kind of failure.
- Types generated from the Shipping API's OpenAPI spec as of 2026-11-09.
