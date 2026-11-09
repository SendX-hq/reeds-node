import type { components } from "../../generated/shipping";

type S = components["schemas"];

/** Every webhook event type the Shipping API sends (a test checks this against the spec). */
export const SHIPPING_EVENT_TYPES = [
  "delivery.created",
  "delivery.requires_action",
  "delivery.booked",
  "delivery.status_changed",
  "delivery.schedule_changed",
  "delivery.expiring",
  "delivery.cancelled",
  "wallet.funded",
  "wallet.low_balance",
  "invoice.issued",
  "invoice.paid",
  "invoice.overdue",
] as const;

export type ShippingEventType = (typeof SHIPPING_EVENT_TYPES)[number];

type DataOf<E extends { data?: unknown }> = NonNullable<E["data"]>;
/** The fields Reeds always sends with an event (the spec doesn't mark them required yet). */
type WithRequired<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };

type EventOf<T extends ShippingEventType, D> = {
  /** `evt_...`. Events can arrive more than once: skip ids you have processed. */
  id: string;
  type: T;
  created_at: string;
  livemode: boolean;
  data: D;
};

export type DeliveryCreatedEvent = EventOf<"delivery.created", WithRequired<DataOf<S["DeliveryCreatedEvent"]>, "delivery">>;
export type DeliveryRequiresActionEvent = EventOf<"delivery.requires_action", WithRequired<DataOf<S["DeliveryRequiresActionEvent"]>, "delivery" | "required_action">>;
export type DeliveryBookedEvent = EventOf<"delivery.booked", WithRequired<DataOf<S["DeliveryBookedEvent"]>, "delivery">>;
export type DeliveryStatusChangedEvent = EventOf<"delivery.status_changed", WithRequired<DataOf<S["DeliveryStatusChangedEvent"]>, "delivery" | "previous_status">>;
export type DeliveryScheduleChangedEvent = EventOf<"delivery.schedule_changed", WithRequired<DataOf<S["DeliveryScheduleChangedEvent"]>, "delivery" | "previous_schedule">>;
export type DeliveryExpiringEvent = EventOf<"delivery.expiring", WithRequired<DataOf<S["DeliveryExpiringEvent"]>, "delivery" | "expires_at">>;
export type DeliveryCancelledEvent = EventOf<"delivery.cancelled", WithRequired<DataOf<S["DeliveryCancelledEvent"]>, "delivery" | "cancellation">>;
export type WalletFundedEvent = EventOf<"wallet.funded", WithRequired<DataOf<S["WalletFundedEvent"]>, "amount" | "currency" | "balance" | "transaction">>;
export type WalletLowBalanceEvent = EventOf<"wallet.low_balance", WithRequired<DataOf<S["WalletLowBalanceEvent"]>, "balance" | "low_balance_threshold" | "currency">>;
export type InvoiceIssuedEvent = EventOf<"invoice.issued", WithRequired<DataOf<S["InvoiceIssuedEvent"]>, "invoice">>;
export type InvoicePaidEvent = EventOf<"invoice.paid", WithRequired<DataOf<S["InvoicePaidEvent"]>, "invoice">>;
export type InvoiceOverdueEvent = EventOf<"invoice.overdue", WithRequired<DataOf<S["InvoiceOverdueEvent"]>, "invoice">>;

/**
 * Every Shipping API event. Reeds adds event types inside v1: give a switch on
 * `event.type` a default branch that answers 200 and ignores the rest.
 */
export type ShippingEvent =
  | DeliveryCreatedEvent
  | DeliveryRequiresActionEvent
  | DeliveryBookedEvent
  | DeliveryStatusChangedEvent
  | DeliveryScheduleChangedEvent
  | DeliveryExpiringEvent
  | DeliveryCancelledEvent
  | WalletFundedEvent
  | WalletLowBalanceEvent
  | InvoiceIssuedEvent
  | InvoicePaidEvent
  | InvoiceOverdueEvent;
