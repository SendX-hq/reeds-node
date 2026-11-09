import type { components, operations } from "../../generated/shipping";

/** The Shipping API's objects, from its OpenAPI spec (src/generated/shipping.ts). */
type S = components["schemas"];
type QueryOf<O extends keyof operations> = NonNullable<operations[O]["parameters"]["query"]>;

export type Coverage = S["Coverage"];
export type QuoteRequest = S["QuoteRequest"];
export type Quote = S["Quote"];
export type QuoteUnavailable = S["QuoteUnavailable"];
export type QuoteUnavailableReason = S["QuoteUnavailableReason"];
export type AddressInput = S["AddressInput"];
export type Package = S["Package"];
export type Fee = S["Fee"];
export type Schedule = S["Schedule"];
export type Route = S["Route"];
export type Service = S["Service"];
export type Shipper = S["Shipper"];
export type Metadata = S["Metadata"];

export type Delivery = S["Delivery"];
export type DeliveryStatus = S["DeliveryStatus"];
export type RequiredAction = S["RequiredAction"];
export type RequiredActionType = S["RequiredActionType"];
export type Cancellation = S["Cancellation"];
/** `POST /deliveries`: book the delivery a quote priced. */
export type DeliveryCreateParams = S["BookFromQuote"];
export type DeliveryUpdateParams = S["DeliveryUpdate"];
export type DeliveryCancelParams = S["CancelRequest"];
export type DeliveryListParams = Omit<QueryOf<"listDeliveries">, "ids"> & {
  /** Up to 50 delivery ids, as a list or comma-separated. */
  ids?: string | string[];
};

export type Wallet = S["Wallet"];
export type WalletTransaction = S["WalletTransaction"];
export type WalletFundParams = S["FundWalletRequest"];
export type WalletFundResult = S["FundWalletResponse"];
export type WalletTransactionListParams = QueryOf<"listWalletTransactions">;

export type Invoice = S["Invoice"];
export type InvoiceStatus = S["InvoiceStatus"];
export type InvoiceListParams = QueryOf<"listInvoices">;

export type SandboxFundParams = S["FundWalletRequest"];
export type SandboxAdvanceParams = S["AdvanceRequest"];
