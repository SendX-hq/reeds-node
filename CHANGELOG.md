# Changelog

## 0.1.0 (2026-11-09)

The first release, for the Shipping API.

- `reeds.shipping`: coverage, quotes, deliveries (create, list, get, update, book, mark ready, cancel, label), the wallet (get, fund, transactions), invoices (list, get, PDF) and the sandbox.
- `reeds.webhooks`: signature verification, typed events, test events.
- Access tokens fetched and refreshed automatically; an `Idempotency-Key` on every `POST`; safe retries with `Retry-After`; cursor pagination with `for await`; one error class per kind of failure.
- Types generated from the Shipping API's OpenAPI spec as of 2026-11-09.
