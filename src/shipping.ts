// `reeds/shipping`: the Shipping API module's classes, types and event types.
export { Shipping, Coverages, Addresses, Quotes, Deliveries, WalletResource, Invoices, Sandbox, SHIPPING_PATH } from "./apis/shipping/resources";
export * from "./apis/shipping/types";
export * from "./apis/shipping/events";
export type { components as ShippingComponents, operations as ShippingOperations } from "./generated/shipping";
