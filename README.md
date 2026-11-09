<p align="center"><img src="https://raw.githubusercontent.com/SendX-hq/reeds-node/main/assets/reeds-logo.png" alt="Reeds" width="240"></p>

# Reeds Node.js library

The official Node.js library for the Reeds APIs. It covers the [Shipping API](https://developer.getreeds.co/docs/shipping/overview): quotes, deliveries, labels, the wallet, invoices, the sandbox and webhooks.

- Gets and refreshes your access token for you.
- Sends an `Idempotency-Key` with every `POST`, and reuses it when it retries, so a retry never books or charges twice.
- Retries rate limits, overload and dropped connections, honouring `Retry-After`.
- Has types for every request, response and webhook event, generated from the API's OpenAPI spec.
- Pages through lists with `for await`.
- Verifies webhook signatures.

Requires Node.js 18 or later. No runtime dependencies.

## Install

```sh
npm install reeds-sdk
```

## Quickstart

Get your client id and secret from **Dashboard → Developers**. Test credentials (`rci_test_...`, `rcs_test_...`) use Test mode: nothing real moves and no real money is spent.

```ts
import Reeds from "reeds-sdk";

const reeds = new Reeds({
  clientId: process.env.REEDS_CLIENT_ID,
  clientSecret: process.env.REEDS_CLIENT_SECRET,
});

// 1. Price the delivery.
const quote = await reeds.shipping.quotes.create({
  pickup: { name: "Tola Fabrics", phone: "08051234567", address: "23 Allen Avenue", area: "Ikeja", lga: "Ikeja", state: "Lagos" },
  dropoff: { name: "Chinedu Eze", phone: "08098765432", address: "14 Admiralty Way", area: "Lekki Phase 1", lga: "Eti-Osa", state: "Lagos" },
  package: { description: "2 pairs of sneakers", quantity: 1, weight_kg: 1.5 },
});

if (!quote.available) {
  // Not an error: Reeds doesn't serve this route. Show quote.reason.message.
  throw new Error(quote.reason.message);
}

// 2. Book it. The wallet is charged and the delivery gets its tracking code.
const delivery = await reeds.shipping.deliveries.create({
  quote_id: quote.id,
  reference: "ORDER-10045",
});

console.log(delivery.tracking_code, delivery.schedule);
```

`clientId` and `clientSecret` default to the `REEDS_CLIENT_ID` and `REEDS_CLIENT_SECRET` environment variables, so `new Reeds()` is enough when they're set.

CommonJS works too:

```js
const { Reeds } = require("reeds-sdk");
```

Fields keep the API's names (`quote_id`, `tracking_code`), so the [API reference](https://developer.getreeds.co/api) reads the same as your code. Amounts are integers in kobo: `280000` is ₦2,800.

## What's available

| | |
|---|---|
| `reeds.shipping.coverage` | `get()` |
| `reeds.shipping.quotes` | `create(params)` |
| `reeds.shipping.deliveries` | `create(params)`, `list(params)`, `get(id)`, `update(id, params)`, `book(id)`, `markReady(id)`, `cancel(id, { reason })`, `label(id)` |
| `reeds.shipping.wallet` | `get()`, `fund(params)` (Live mode), `listTransactions(params)` |
| `reeds.shipping.invoices` | `list(params)`, `get(id)`, `pdf(id)` |
| `reeds.shipping.sandbox` | `fundWallet({ amount })`, `advanceDelivery(id, { status })` (Test mode) |
| `reeds.webhooks` | `constructEvent(...)`, `verifySignature(...)`, `sendTest({ type })` |

Every method takes an optional last argument for that request: `{ idempotencyKey, timeout, maxRetries, signal, headers }`.

## Items not packed yet

Book with `ready: false` and the delivery waits with a `MARK_READY` action. When the parcel is packed:

```ts
const delivery = await reeds.shipping.deliveries.create({ quote_id: quote.id, ready: false });
// ... later
await reeds.shipping.deliveries.markReady(delivery.id); // now "scheduled", with its pickup and delivery times
```

A booked delivery that isn't marked ready within 7 days is cancelled and refunded in full.

## Lists

A list call returns one page when you `await` it, and every item when you iterate it:

```ts
const page = await reeds.shipping.deliveries.list({ status: "delivered", limit: 50 });
page.data;      // up to 50 deliveries, newest first
page.has_more;  // true when another page follows
await page.nextPage();

for await (const delivery of reeds.shipping.deliveries.list({ status: "delivered" })) {
  // every delivered delivery, fetching pages as it goes
}
```

## Labels and invoice PDFs

```ts
import { writeFile } from "node:fs/promises";

const label = await reeds.shipping.deliveries.label(delivery.id);
await writeFile(label.filename ?? "label.pdf", label.data);
```

## Errors

Every failure throws a `ReedsError` subclass. Branch on the class or on `error.code`, never on `error.message`, which Reeds can reword.

```ts
import { InvalidRequestError, PaymentRequiredError, RateLimitError, ReedsError } from "reeds-sdk";

try {
  await reeds.shipping.deliveries.create({ quote_id: quote.id });
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    // INSUFFICIENT_BALANCE: fund the wallet, then retry with the same idempotencyKey.
  } else if (error instanceof InvalidRequestError) {
    console.log(error.fields); // [{ field: "dropoff.lga", message: "..." }]
  } else if (error instanceof ReedsError) {
    console.error(error.code, error.message, error.requestId, error.docUrl);
  }
  throw error;
}
```

| Class | When |
|---|---|
| `AuthenticationError` | 401, or the credentials are wrong (`invalid_client`) or missing |
| `PermissionDeniedError` | 403: a missing scope, an IP not on your allowlist, a sandbox call with live credentials |
| `NotFoundError` | 404 |
| `ConflictError` | 409: the delivery's state doesn't allow it, a quote already used |
| `InvalidRequestError` | 400 or 422: `fields` says what to fix |
| `PaymentRequiredError` | 402: `INSUFFICIENT_BALANCE` or `CREDIT_LIMIT_REACHED` |
| `RateLimitError` | 429, with `retryAfter` |
| `ServiceUnavailableError` | 503, with `retryAfter` |
| `ApiError` | any other failure status |
| `ConnectionError`, `ConnectionTimeoutError` | no response |

Every error has `status`, `code`, `message`, `fields`, `docUrl` (the code's page on the developer hub), `requestId` and `raw` (the API's error object, with fields some codes add, such as `delivery_id` on `QUOTE_ALREADY_USED`). Quote the `requestId` when you contact support@getreeds.co.

## Retries and idempotency

The library retries a request up to 2 times (`maxRetries`) when it's safe to:

- no response (a dropped connection or a timeout);
- `429`, `502`, `503` and `504`, waiting the `Retry-After` seconds when Reeds sends them (at most 30);
- `500` on a `GET`;
- `409 REQUEST_IN_PROGRESS` (the same key is still being processed).

Other failures are never retried. Waits back off from about half a second, up to 8 seconds.

Every `POST` carries an `Idempotency-Key`, and a retry sends the same one, so Reeds answers it once. To make your own retries safe too (after a crash, or a deploy), pass a key tied to your order:

```ts
await reeds.shipping.deliveries.create({ quote_id: quote.id, reference: "ORDER-10045" }, { idempotencyKey: "order-10045-delivery" });
```

## Webhooks

Verify every event before you trust it. Pass the **raw** request body: a body that was parsed and serialised again never matches the signature. The signing secret (`whsec_test_...` or `whsec_live_...`) is next to your endpoint in Dashboard → Developers. It isn't your client secret.

Express:

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
      console.log("Wallet low:", event.data.balance);
      break;
    default:
      // Reeds adds event types over time: ignore the ones you don't use.
      break;
  }
  res.sendStatus(200);
});
```

Next.js (App Router):

```ts
import { webhooks } from "reeds-sdk";

export async function POST(request: Request) {
  const body = await request.text();
  const event = webhooks.constructEvent(body, request.headers.get("reeds-signature"), process.env.REEDS_WEBHOOK_SECRET!);
  // ...
  return new Response(null, { status: 200 });
}
```

`webhooks` (the named export) checks signatures without credentials. While you rotate a secret, pass both: `constructEvent(body, header, [newSecret, oldSecret])`. An event can arrive more than once: skip ids you've already processed.

To try your receiver, `await reeds.webhooks.sendTest({ type: "delivery.booked" })` sends a signed test event to the endpoint saved for the mode.

## Test mode and the sandbox

With test credentials:

```ts
await reeds.shipping.sandbox.fundWallet({ amount: 1_000_000 }); // ₦10,000 in the test wallet
await reeds.shipping.sandbox.advanceDelivery(delivery.id);     // the next status, and its webhook
await reeds.shipping.sandbox.advanceDelivery(delivery.id, { status: "delivered" });
```

Sandbox calls are refused before anything is sent when the client has live credentials. `reeds.mode` says which mode the credentials are for.

## Configuration

```ts
new Reeds({
  clientId: "rci_test_...",
  clientSecret: "rcs_test_...",
  baseUrl: "https://api.getreeds.co", // the default
  timeout: 60_000,                    // ms per attempt
  maxRetries: 2,
  fetch: customFetch,                 // any fetch-compatible function
  defaultHeaders: { "X-Your-Header": "value" },
});
```

`await reeds.scopes()` lists the Reeds APIs your credentials can use, for example `["shipping"]`.

## Versioning

The library follows semantic versioning. Until 1.0.0, a minor version can change something you use; read [CHANGELOG.md](CHANGELOG.md) before you upgrade. Reeds adds fields, statuses and event types to the API without notice, and the types allow unknown values, so give every `switch` a default branch.

## Support

Read the [developer docs](https://developer.getreeds.co), or email support@getreeds.co with the `requestId` of the call.

## License

MIT
