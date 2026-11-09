import { Core, type ClientOptions, type Mode, type RequestOptions } from "./core/client";
import { constructEvent, verifySignature, type VerifyOptions, type WebhookPayload } from "./core/webhooks";
import { SHIPPING_PATH, Shipping } from "./apis/shipping/resources";
import type { ShippingEvent } from "./apis/shipping/events";
import type { components } from "./generated/shipping";

/** Every webhook event any Reeds API sends. Each new API adds its events here. */
export type ReedsEvent = ShippingEvent;

export type TestWebhookParams = components["schemas"]["TestWebhookRequest"];
export type TestWebhookResult = NonNullable<components["schemas"]["TestWebhookEnvelope"]["data"]>;

/**
 * Webhooks are account-wide: one endpoint per account and mode gets every
 * Reeds API's events, signed the same way.
 */
export class Webhooks {
  constructor(private readonly core?: Core) {}

  /** Throws WebhookSignatureError unless `header` signs `payload` (the raw body) with `secret`, within 5 minutes. */
  verifySignature(payload: WebhookPayload, header: string | null | undefined, secret: string | readonly string[], options?: VerifyOptions): void {
    verifySignature(payload, header, secret, options);
  }

  /** Verifies the signature, then returns the parsed event. Pass the raw body, not parsed JSON. */
  constructEvent(payload: WebhookPayload, header: string | null | undefined, secret: string | readonly string[], options?: VerifyOptions): ReedsEvent {
    return constructEvent<ReedsEvent>(payload, header, secret, options);
  }

  /** Sends a signed test event to the endpoint saved for this mode (Dashboard → Developers). */
  sendTest(params: TestWebhookParams = {}, options?: RequestOptions): Promise<TestWebhookResult> {
    if (!this.core) throw new Error("reeds: sendTest needs a client: use `new Reeds(...).webhooks.sendTest()`.");
    return this.core.post(`${SHIPPING_PATH}/webhooks/test`, params, options);
  }
}

/**
 * The Reeds API client. One client, one set of credentials, every Reeds API:
 *
 *   const reeds = new Reeds({ clientId, clientSecret });
 *   const quote = await reeds.shipping.quotes.create({ ... });
 */
export class Reeds {
  /** The Shipping API: quotes, deliveries, the wallet, invoices and the sandbox. */
  readonly shipping: Shipping;
  /** Webhook signature checks and test events, for every API. */
  readonly webhooks: Webhooks;
  private readonly core: Core;

  constructor(options: ClientOptions = {}) {
    this.core = new Core(options);
    this.shipping = new Shipping(this.core);
    this.webhooks = new Webhooks(this.core);
  }

  /** "test" or "live", from the client id; null without one. */
  get mode(): Mode | null {
    return this.core.mode;
  }

  /** The scopes your credentials carry: one per Reeds API your account may use (for example `["shipping"]`). */
  scopes(): Promise<string[]> {
    return this.core.scopes();
  }
}

/** Webhook verification without a client, for a receiver that only checks events. */
export const webhooks = new Webhooks();
