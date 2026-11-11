<p align="center"><img src="https://raw.githubusercontent.com/SendX-hq/reeds-node/main/assets/reeds-logo.png" alt="Reeds" width="240"></p>

<h1 align="center">Reeds Node.js library</h1>

<p align="center">
  The official Node.js library for the Reeds APIs: one client for every Reeds service.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/reeds-sdk"><img src="https://img.shields.io/npm/v/reeds-sdk?color=0066F5&label=npm" alt="npm version"></a>
  <a href="https://github.com/SendX-hq/reeds-node/actions/workflows/ci.yml"><img src="https://github.com/SendX-hq/reeds-node/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/node/v/reeds-sdk?color=0066F5" alt="Node.js version">
  <img src="https://img.shields.io/npm/types/reeds-sdk?color=0066F5" alt="TypeScript types included">
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/reeds-sdk?color=0066F5" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://developer.getreeds.co">Developer docs</a> ·
  <a href="https://developer.getreeds.co/api">API reference</a> ·
  <a href="https://developer.getreeds.co/changelog">API changelog</a> ·
  <a href="CHANGELOG.md">Library changelog</a>
</p>

---

```ts
import Reeds from "reeds-sdk";

const reeds = new Reeds(); // reads REEDS_CLIENT_ID and REEDS_CLIENT_SECRET

const quote = await reeds.shipping.quotes.create({ pickup, dropoff, package: { description: "Sneakers", quantity: 1, weight_kg: 1.5 } });
if (quote.available) {
  const delivery = await reeds.shipping.deliveries.create({ quote_id: quote.id, reference: "ORDER-10045" });
  console.log(delivery.tracking_code); // HQ3W5F2
}
```

## Contents

- [Services](#services)
- [Why use the library](#why-use-the-library)
- [Install](#install)
- [Credentials and modes](#credentials-and-modes)
- [Shipping](#shipping): [quickstart](#quickstart), [coverage and quotes](#coverage-and-quotes), [address search](#address-search), [deliveries](#deliveries), [statuses](#delivery-statuses), [labels](#labels), [wallet and invoices](#wallet-and-invoices), [sandbox](#test-mode-and-the-sandbox)
- [Webhooks](#webhooks)
- [Lists and pagination](#lists-and-pagination)
- [Errors](#errors)
- [Retries, idempotency and timeouts](#retries-idempotency-and-timeouts)
- [TypeScript](#typescript)
- [Configuration](#configuration)
- [Versioning](#versioning) · [Support](#support) · [License](#license)

## Services

Reeds offers its services as separate APIs. The library gives each one a property on the same client, so one install and one set of credentials cover them all:

| Service | On the client | Status |
|---|---|---|
| **Shipping**: address search, quotes, deliveries, labels, the wallet, invoices, the sandbox | `reeds.shipping` | **Available** |

Webhooks are shared: one endpoint receives every service's events, all verified by `reeds.webhooks`. A new service arrives in a minor version of this library, so upgrading never breaks the services you already use.

## Why use the library

| | |
|---|---|
| **Authentication handled** | It exchanges your client id and secret for an access token, caches it, and refreshes it before it expires. |
| **Safe retries** | Every `POST` carries an `Idempotency-Key`, and a retry reuses it, so a retry never books or charges twice. |
| **Resilient** | It retries rate limits, overload and dropped connections, honouring `Retry-After`. |
| **Typed** | It has TypeScript types for every request, response and webhook event, generated from the API's OpenAPI spec. |
| **Pagination** | `for await` walks every page of a list. |
| **Clear errors** | One class per kind of failure, with the API's `code`, the invalid `fields`, a `docUrl` and the `requestId`. |
| **Webhooks verified** | `constructEvent` checks the signature and returns a typed event. |
| **Lightweight** | No runtime dependencies. ESM and CommonJS. Node.js 18 or later. |

## Install

```sh
npm install reeds-sdk
```

```ts
import Reeds from "reeds-sdk";       // ES modules / TypeScript
const { Reeds } = require("reeds-sdk"); // CommonJS
```

## Credentials and modes

Get your client id and secret from **Dashboard → Developers**. Each mode has its own pair:

| Mode | Client id | Client secret | What happens |
|---|---|---|---|
| Test | `rci_test_...` | `rcs_test_...` | Nothing real moves and no real money is spent. Use it to build and test. |
| Live | `rci_live_...` | `rcs_live_...` | Real pickups, real charges. Available once Reeds approves your business. |

```ts
const reeds = new Reeds({
  clientId: process.env.REEDS_CLIENT_ID,
  clientSecret: process.env.REEDS_CLIENT_SECRET,
});

reeds.mode;            // "test" or "live", from the client id
await reeds.scopes();  // the services your credentials can use, for example ["shipping"]
```

`clientId` and `clientSecret` default to the `REEDS_CLIENT_ID` and `REEDS_CLIENT_SECRET` environment variables. Keep the secret on your server: never ship it to a browser or a mobile app.

## Shipping

The [Shipping API](https://developer.getreeds.co/docs/shipping/overview) books pickups and deliveries: within a state, and between states along the routes Reeds runs.

### Quickstart

```ts
import Reeds from "reeds-sdk";

const reeds = new Reeds();

// 1. Price it.
const quote = await reeds.shipping.quotes.create({
  pickup: { name: "Tola Fabrics", phone: "08051234567", address: "23 Allen Avenue", area: "Ikeja", lga: "Ikeja", state: "Lagos" },
  dropoff: { name: "Chinedu Eze", phone: "08098765432", address: "14 Admiralty Way", area: "Lekki Phase 1", lga: "Eti-Osa", state: "Lagos" },
  package: { description: "2 pairs of sneakers", quantity: 1, weight_kg: 1.5 },
});

if (!quote.available) {
  // Not an error: Reeds doesn't serve this route. Tell your customer why.
  throw new Error(quote.reason.message);
}
console.log(quote.fee.total, quote.schedule); // kobo, and the pickup and delivery promise

// 2. Book it. The wallet is charged and the delivery gets its tracking code.
const delivery = await reeds.shipping.deliveries.create({ quote_id: quote.id, reference: "ORDER-10045" });

// 3. Follow it with webhooks (see below), or read it.
const latest = await reeds.shipping.deliveries.get(delivery.id);
console.log(latest.status, latest.tracking_url);
```

Field names are the API's own (`quote_id`, `tracking_code`), so your code reads like the [API reference](https://developer.getreeds.co/api). **Amounts are integers in kobo:** `280000` is ₦2,800.

### Coverage and quotes

```ts
const coverage = await reeds.shipping.coverage.get(); // the states, zones and inter-state routes Reeds serves
```

A quote holds its price for 24 hours. A route Reeds doesn't serve comes back as `available: false` with a `reason` (`ADDRESS_NOT_SERVICEABLE`, `INTERSTATE_NOT_AVAILABLE`, ...), never as an error. Branch on `reason.code`, not the message.

### Address search

Complete an address as your customer types, or read one from a map pin, and give the quote the `lga` and `state` it needs with a `place_id` that makes the spot exact. Addresses come from Google and are in Nigeria.

```ts
import { randomUUID } from "node:crypto";

// One session token per address being typed: the same on every call while it's typed, and on the details call.
// The whole search then counts as one. Start a new token for the next address.
const session_token = randomUUID();

const { suggestions } = await reeds.shipping.addresses.autocomplete({ query: "23 Allen Avenue", session_token });
// Show suggestions[].main_text and secondary_text (at most 6, best first). Your customer picks one:
const place = await reeds.shipping.addresses.details({ place_id: suggestions[0]!.place_id, session_token });

// Google names no LGA for some places: ask your customer then, because a quote needs it.
if (!place.lga) throw new Error("Ask your customer for the LGA.");

const quote = await reeds.shipping.quotes.create({
  pickup: { name: "Tola Fabrics", phone: "08051234567", address: place.formatted_address, area: place.area ?? undefined, lga: place.lga, state: place.state, place_id: place.place_id },
  dropoff: { name: "Chinedu Eze", phone: "08098765432", address: "14 Admiralty Way", area: "Lekki Phase 1", lga: "Eti-Osa", state: "Lagos" },
  package: { description: "2 pairs of sneakers", quantity: 1, weight_kg: 1.5 },
});

// A map pin: the address Google finds nearest it, the same shape as `place`. Each pin is one search.
const found = await reeds.shipping.addresses.reverse({ latitude: 6.6018, longitude: 3.3515 });
```

| Method | What it does |
|---|---|
| `addresses.autocomplete({ query, session_token })` | Suggestions for what your customer has typed so far: `{ suggestions: [{ place_id, main_text, secondary_text }] }` |
| `addresses.details({ place_id, session_token? })` | The full address of the place they chose: `place_id`, `formatted_address`, `area`, `lga`, `state`, `latitude`, `longitude`, `precise` |
| `addresses.reverse({ latitude, longitude })` | The address at a map pin, the same shape |

- **`precise: false`** means a whole area or road, whose point is only its middle: ask your customer for the street.
- **At a pin:** to deliver to the pin itself, send your pin's `latitude` and `longitude` in the quote with `found.formatted_address` as the text. To deliver to the address found, send its `place_id`.
- **Free, within an allowance.** Test mode has 50 searches in all to start, and Reeds can raise it. Live is unlimited unless Reeds has set a monthly limit for your account. One search is one typed address (one session token), a place looked up without a token, or one pin. Past the allowance the call throws `PermissionDeniedError` with code `ADDRESS_SEARCH_LIMIT_REACHED`; switched off for your account in Live, `ADDRESS_SEARCH_DISABLED`.
- **From your server**, like every call: your page calls your server, and your server calls Reeds.
- **Google's rules apply:** show the Google logo or "Powered by Google" next to suggestions that aren't on a Google map, and show pins on a Google map.

See the [address search guide](https://developer.getreeds.co/docs/shipping/address-search) for more.

### Deliveries

| Method | What it does |
|---|---|
| `deliveries.create({ quote_id, reference?, ready?, ... })` | Books the delivery a quote priced, and charges it |
| `deliveries.list({ status?, reference?, ids?, created_from?, created_to?, limit? })` | Deliveries, newest first (see [pagination](#lists-and-pagination)) |
| `deliveries.get(id)` | One delivery |
| `deliveries.update(id, { reference?, pickup_instructions?, dropoff_instructions?, metadata? })` | Changes what can change |
| `deliveries.markReady(id)` | The parcel is packed: the pickup is scheduled from now |
| `deliveries.cancel(id, { reason })` | Cancels and refunds in full, until the rider sets off |
| `deliveries.book(id)` | Books a priced delivery your team made in the dashboard |
| `deliveries.label(id)` | The shipping label, as a PDF |

**Not packed yet?** Book with `ready: false`. The delivery is charged and gets its tracking code, then waits with a `MARK_READY` action:

```ts
const delivery = await reeds.shipping.deliveries.create({ quote_id: quote.id, ready: false });
// ...when the parcel is packed:
await reeds.shipping.deliveries.markReady(delivery.id); // now "scheduled", with its pickup and delivery times
```

A booked delivery that isn't marked ready within 7 days is cancelled and refunded in full.

### Delivery statuses

| Status | Meaning |
|---|---|
| `requires_action` | Waiting on you: `required_actions` says what (for example `MARK_READY`) |
| `scheduled` | Booked and charged, waiting for its pickup time and a rider |
| `rider_assigned` | A rider has the pickup |
| `picked_up` | Collected from the pickup address |
| `at_hub` | At a Reeds or partner hub |
| `in_transit` | Moving between hubs on an inter-state delivery |
| `out_for_delivery` | With the rider, heading to the receiver |
| `delivered` | Delivered. Final. |
| `failed_attempt` | The rider couldn't deliver. Reeds retries or contacts you. |
| `on_hold` | Paused by Reeds. `hold_reason` says why. |
| `cancelled` | Cancelled. Final. |

Reeds can add statuses: give every `switch` on `status` a `default` branch.

### Labels

```ts
import { writeFile } from "node:fs/promises";

const label = await reeds.shipping.deliveries.label(delivery.id);
await writeFile(label.filename ?? "label.pdf", label.data); // label.contentType is "application/pdf"
```

### Wallet and invoices

```ts
const wallet = await reeds.shipping.wallet.get();
console.log(wallet.balance); // kobo

// Live mode: start a Paystack top-up (₦50,000) and send the payer to the URL.
// wallet.funded carries the same reference when the money lands.
const { payment_url, reference } = await reeds.shipping.wallet.fund({ amount: 5_000_000 });

for await (const entry of reeds.shipping.wallet.listTransactions()) console.log(entry.type, entry.amount, entry.description);

// Accounts billed monthly:
const invoices = await reeds.shipping.invoices.list({ status: "issued" });
const pdf = await reeds.shipping.invoices.pdf(invoices.data[0]!.id!);
```

### Test mode and the sandbox

With test credentials, build the whole flow without real money or riders:

```ts
await reeds.shipping.sandbox.fundWallet({ amount: 1_000_000 });                   // ₦10,000 in the test wallet, at once
await reeds.shipping.sandbox.advanceDelivery(delivery.id);                         // the next status, with its webhook
await reeds.shipping.sandbox.advanceDelivery(delivery.id, { status: "delivered" }); // straight to a status
```

Sandbox calls are refused before anything is sent when the client has live credentials.

## Webhooks

Reeds posts events to your endpoint as things happen. Verify each one before you trust it: pass the **raw** request body, because a body that was parsed and serialised again never matches the signature. The signing secret (`whsec_test_...` or `whsec_live_...`) is next to your endpoint in **Dashboard → Developers**. It isn't your client secret.

**Express**

```ts
import express from "express";
import Reeds, { WebhookSignatureError } from "reeds-sdk";

const reeds = new Reeds();
const app = express();

app.post("/webhooks/reeds", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = reeds.webhooks.constructEvent(req.body, req.get("Reeds-Signature"), process.env.REEDS_WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof WebhookSignatureError) return res.status(400).send(error.message);
    throw error;
  }

  switch (event.type) {
    case "delivery.status_changed":
      console.log(event.data.delivery.id, event.data.previous_status, "->", event.data.delivery.status);
      break;
    case "wallet.low_balance":
      console.log("Top up: the wallet is at", event.data.balance);
      break;
    default:
      break; // Reeds adds event types over time: ignore the ones you don't use
  }
  res.sendStatus(200);
});
```

**Next.js (App Router)**

```ts
import { webhooks } from "reeds-sdk";

export async function POST(request: Request) {
  const event = webhooks.constructEvent(await request.text(), request.headers.get("reeds-signature"), process.env.REEDS_WEBHOOK_SECRET!);
  // handle event.type ...
  return new Response(null, { status: 200 });
}
```

| Event | When |
|---|---|
| `delivery.created` | A delivery was created: booked from a quote, or made in the dashboard |
| `delivery.requires_action` | An action was added to `required_actions` |
| `delivery.booked` | The delivery was priced and charged (or added to the month's invoice) |
| `delivery.status_changed` | Any status change |
| `delivery.schedule_changed` | The pickup day or delivery time moved |
| `delivery.expiring` | A delivery will be cancelled soon if nothing happens |
| `delivery.cancelled` | The delivery was cancelled |
| `wallet.funded` | A top-up landed and the wallet was credited |
| `wallet.low_balance` | The balance fell to or below your low-balance threshold |
| `invoice.issued` | A monthly invoice was issued |
| `invoice.paid` | An invoice was paid in full |
| `invoice.overdue` | An invoice passed its due date unpaid |

Good to know:
- **Duplicates:** an event can arrive more than once. Skip `event.id`s you've already processed.
- **Order:** events can arrive out of order. Compare `data.delivery.updated_at`.
- **Rotating a secret:** pass both while you rotate, as `constructEvent(body, header, [newSecret, oldSecret])`.
- **Without credentials:** `webhooks` (the named export) verifies events without a client.
- **Testing your receiver:** `await reeds.webhooks.sendTest({ type: "delivery.booked" })` sends a signed test event to your endpoint.

## Lists and pagination

Every list returns one page when you `await` it, and every item when you iterate it:

```ts
const page = await reeds.shipping.deliveries.list({ status: "delivered", limit: 50 });
page.data;              // up to 50, newest first
page.has_more;          // true when another page follows
await page.nextPage();  // the next page, or null

for await (const delivery of reeds.shipping.deliveries.list({ status: "delivered" })) {
  // every delivered delivery; pages are fetched as you go
}
```

## Errors

Every failure throws a `ReedsError` subclass. Branch on the class or on `error.code`, never on `error.message`, which Reeds can reword.

```ts
import { InvalidRequestError, PaymentRequiredError, ReedsError } from "reeds-sdk";

try {
  await reeds.shipping.deliveries.create({ quote_id: quote.id });
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    // INSUFFICIENT_BALANCE: top up, then retry with the same idempotencyKey
  } else if (error instanceof InvalidRequestError) {
    console.log(error.fields); // [{ field: "dropoff.lga", message: "Enter the LGA." }]
  } else if (error instanceof ReedsError) {
    console.error(error.code, error.message, error.requestId, error.docUrl);
  }
  throw error;
}
```

| Class | Status | Typical codes |
|---|---|---|
| `AuthenticationError` | 401, or wrong or missing credentials | `TOKEN_EXPIRED`, `invalid_client`, `MISSING_CREDENTIALS` |
| `PermissionDeniedError` | 403 | `INSUFFICIENT_SCOPE`, `IP_NOT_ALLOWED`, `TEST_MODE_ONLY`, `ACCOUNT_ON_HOLD`, `ADDRESS_SEARCH_LIMIT_REACHED`, `ADDRESS_SEARCH_DISABLED` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `ACTION_NOT_ALLOWED`, `QUOTE_ALREADY_USED`, `QUOTE_EXPIRED`, `CANCEL_NOT_ALLOWED` |
| `InvalidRequestError` | 400, 422 | `INVALID_REQUEST` (see `fields`), `IDEMPOTENCY_KEY_REQUIRED` |
| `PaymentRequiredError` | 402 | `INSUFFICIENT_BALANCE`, `CREDIT_LIMIT_REACHED` |
| `RateLimitError` | 429 | `RATE_LIMITED` (`retryAfter` in seconds) |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` (`retryAfter` in seconds) |
| `ApiError` | other 5xx | `INTERNAL_ERROR` |
| `ConnectionError`, `ConnectionTimeoutError` | no response | `CONNECTION_FAILED`, `TIMEOUT`, `ABORTED` |
| `WebhookSignatureError` | a webhook that doesn't verify | `SIGNATURE_MISMATCH`, `TIMESTAMP_OUTSIDE_TOLERANCE`, `RAW_BODY_REQUIRED` |

Every error has:
- `status`, `code` and `message`;
- `fields`: what to fix, on validation errors;
- `docUrl`: the code's page on the developer hub;
- `requestId`: quote it to support;
- `raw`: the API's error object, including fields some codes add, such as `delivery_id` on `QUOTE_ALREADY_USED`.

## Retries, idempotency and timeouts

| Retried (up to `maxRetries`, default 2) | Never retried |
|---|---|
| No response (network error, timeout) | `400`, `401`*, `402`, `403`, `404`, `409`, `422` |
| `429`, `502`, `503`, `504`, waiting for `Retry-After` (at most 30 s) | |
| `500` on a `GET` | |
| `409 REQUEST_IN_PROGRESS` (the same key still running) | |

\* An expired token is refreshed once and the request sent again, automatically.

Waits back off from about half a second, up to 8 seconds. Every `POST` carries an `Idempotency-Key`, and a retry sends the same one, so Reeds acts on it once. To make your own retries safe too (after a crash, or a deploy), pass a key tied to your order:

```ts
await reeds.shipping.deliveries.create({ quote_id: quote.id, reference: "ORDER-10045" }, { idempotencyKey: "order-10045-delivery" });
```

Each request also takes a timeout and an `AbortSignal`:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await reeds.shipping.deliveries.list({ limit: 10 }, { timeout: 10_000, maxRetries: 0, signal: controller.signal });
```

## TypeScript

Types ship with the package and follow the API's OpenAPI spec. Import them from `reeds-sdk/shipping`:

```ts
import type { Delivery, DeliveryStatus, Quote, QuoteRequest, ShippingEvent } from "reeds-sdk/shipping";

function isDone(delivery: Delivery): boolean {
  const final: DeliveryStatus[] = ["delivered", "cancelled"];
  return final.includes(delivery.status);
}
```

The types accept values Reeds adds later (a new status, a new event type), so your code keeps compiling when the API grows.

## Configuration

```ts
new Reeds({
  clientId: "rci_test_...",          // default: REEDS_CLIENT_ID
  clientSecret: "rcs_test_...",      // default: REEDS_CLIENT_SECRET
  baseUrl: "https://api.getreeds.co", // the default
  timeout: 60_000,                    // ms per attempt
  maxRetries: 2,
  fetch: customFetch,                 // any fetch-compatible function, e.g. for a proxy
  defaultHeaders: { "X-Your-Header": "value" },
});
```

The last argument of every method sets options for that request only: `{ idempotencyKey, timeout, maxRetries, signal, headers }`.

## Versioning

The library follows [semantic versioning](https://semver.org). Until 1.0.0, a minor version may change something you use: read the [changelog](CHANGELOG.md) before upgrading.

Within an API version (`v1`), Reeds adds fields, statuses and event types without notice. The library keeps them rather than dropping them, and its types allow them.

Since 0.1.1, every release is built by GitHub Actions and published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can check where it came from with `npm audit signatures`.

## Support

- **Docs and guides:** [developer.getreeds.co](https://developer.getreeds.co).
- **Help with a call:** email support@getreeds.co with the `requestId` from the error (or the `X-Request-Id` header). Every call is also listed in Dashboard → Developers → API requests for 30 days.
- **A bug in the library:** [open an issue](https://github.com/SendX-hq/reeds-node/issues).
- **A security problem:** email support@getreeds.co rather than opening an issue.

## License

[MIT](LICENSE) © Reeds Merchants Technologies Ltd.
