import type { Core, FileResponse, RequestOptions } from "../../core/client";
import { PermissionDeniedError } from "../../core/errors";
import type { PagePromise } from "../../core/pagination";
import type {
  AddressAutocompleteParams,
  AddressDetailsParams,
  AddressReverseParams,
  Coverage,
  Delivery,
  DeliveryCancelParams,
  DeliveryCreateParams,
  DeliveryListParams,
  DeliveryUpdateParams,
  Invoice,
  InvoiceListParams,
  Place,
  PlaceSuggestions,
  Quote,
  QuoteRequest,
  QuoteUnavailable,
  SandboxAdvanceParams,
  SandboxFundParams,
  Wallet,
  WalletFundParams,
  WalletFundResult,
  WalletTransaction,
  WalletTransactionListParams,
} from "./types";

/** The Shipping API's base path. */
export const SHIPPING_PATH = "/shipping/v1";

const at = (...parts: string[]) => SHIPPING_PATH + parts.map((part) => `/${encodeURIComponent(part)}`).join("");

export class Coverages {
  constructor(private readonly core: Core) {}

  /** The states, zones and inter-state routes Reeds serves. */
  get(options?: RequestOptions): Promise<Coverage> {
    return this.core.get(at("coverage"), undefined, options);
  }
}

/**
 * Address search: suggestions as a customer types, the address of the one they
 * pick, and the address at a map pin. Free, within the account's allowance
 * (403 ADDRESS_SEARCH_LIMIT_REACHED past it, 403 ADDRESS_SEARCH_DISABLED when
 * Reeds has switched it off).
 */
export class Addresses {
  constructor(private readonly core: Core) {}

  /**
   * Suggests places in Nigeria for what has been typed so far. Send the same
   * `session_token` on every call while one address is typed, and on the
   * `details` call that ends it: the whole search counts once.
   */
  autocomplete(params: AddressAutocompleteParams, options?: RequestOptions): Promise<PlaceSuggestions> {
    return this.core.get(at("addresses", "autocomplete"), params, options);
  }

  /** The full address of a suggestion (or any Google place id in Nigeria). Pass the search's `session_token` to end that search. */
  details(params: AddressDetailsParams, options?: RequestOptions): Promise<Place> {
    return this.core.get(at("addresses", "details"), params, options);
  }

  /** The address nearest a map pin. Each call is one search. */
  reverse(params: AddressReverseParams, options?: RequestOptions): Promise<Place> {
    return this.core.get(at("addresses", "reverse"), params, options);
  }
}

export class Quotes {
  constructor(private readonly core: Core) {}

  /**
   * Prices a delivery. A route Reeds doesn't serve is not an error: the answer
   * has `available: false` and a `reason`.
   */
  create(params: QuoteRequest, options?: RequestOptions): Promise<Quote | QuoteUnavailable> {
    return this.core.post(at("quotes"), params, options);
  }
}

export class Deliveries {
  constructor(private readonly core: Core) {}

  /** Books the delivery a quote priced, and charges it. Sends an Idempotency-Key (yours, or a new one). */
  create(params: DeliveryCreateParams, options?: RequestOptions): Promise<Delivery> {
    return this.core.post(at("deliveries"), params, options);
  }

  /** Deliveries, newest first. Await it for one page, or iterate it for every delivery. */
  list(params: DeliveryListParams = {}, options?: RequestOptions): PagePromise<Delivery> {
    return this.core.list<Delivery>(at("deliveries"), params, options);
  }

  get(id: string, options?: RequestOptions): Promise<Delivery> {
    return this.core.get(at("deliveries", id), undefined, options);
  }

  /** Changes the reference, instructions or metadata. */
  update(id: string, params: DeliveryUpdateParams, options?: RequestOptions): Promise<Delivery> {
    return this.core.patch(at("deliveries", id), params, options);
  }

  /** Books and charges a priced delivery made in the dashboard (one waiting on BOOK, FUND_WALLET or PAY_INVOICE). */
  book(id: string, options?: RequestOptions): Promise<Delivery> {
    return this.core.post(at("deliveries", id, "book"), undefined, options);
  }

  /** The item is packed: the pickup is scheduled from now. Only a paid delivery can be marked ready (409 otherwise). */
  markReady(id: string, options?: RequestOptions): Promise<Delivery> {
    return this.core.post(at("deliveries", id, "ready"), undefined, options);
  }

  /** Cancels and refunds in full, until the rider sets off. */
  cancel(id: string, params: DeliveryCancelParams = {}, options?: RequestOptions): Promise<Delivery> {
    return this.core.post(at("deliveries", id, "cancel"), params, options);
  }

  /** The shipping label, as a PDF. */
  label(id: string, options?: RequestOptions): Promise<FileResponse> {
    return this.core.file(at("deliveries", id, "label"), options);
  }
}

export class WalletResource {
  constructor(private readonly core: Core) {}

  get(options?: RequestOptions): Promise<Wallet> {
    return this.core.get(at("wallet"), undefined, options);
  }

  /** Live mode: starts a Paystack payment and returns the URL to send the payer to. In Test mode use `sandbox.fundWallet`. */
  fund(params: WalletFundParams, options?: RequestOptions): Promise<WalletFundResult> {
    return this.core.post(at("wallet", "fund"), params, options);
  }

  /** The wallet's ledger, newest first. Await for one page or iterate for all. */
  listTransactions(params: WalletTransactionListParams = {}, options?: RequestOptions): PagePromise<WalletTransaction> {
    return this.core.list<WalletTransaction>(at("wallet", "transactions"), params, options);
  }
}

export class Invoices {
  constructor(private readonly core: Core) {}

  list(params: InvoiceListParams = {}, options?: RequestOptions): PagePromise<Invoice> {
    return this.core.list<Invoice>(at("invoices"), params, options);
  }

  get(id: string, options?: RequestOptions): Promise<Invoice> {
    return this.core.get(at("invoices", id), undefined, options);
  }

  /** The invoice as a PDF. */
  pdf(id: string, options?: RequestOptions): Promise<FileResponse> {
    return this.core.file(at("invoices", id, "pdf"), options);
  }
}

/** Test mode only. Refused here, before any request, with live credentials. */
export class Sandbox {
  constructor(private readonly core: Core) {}

  private testOnly(): void {
    if (this.core.mode === "live") {
      throw new PermissionDeniedError({ code: "TEST_MODE_ONLY", message: "Sandbox calls work with test credentials (rci_test_...) only." });
    }
  }

  /** Tops up the test wallet at once, and books deliveries made in the dashboard that waited for funds. */
  async fundWallet(params: SandboxFundParams, options?: RequestOptions): Promise<Wallet> {
    this.testOnly();
    return this.core.post(at("sandbox", "wallet", "fund"), params, options);
  }

  /** Moves a test delivery to the next status, or to the one you name. */
  async advanceDelivery(id: string, params: SandboxAdvanceParams = {}, options?: RequestOptions): Promise<Delivery> {
    this.testOnly();
    return this.core.post(at("sandbox", "deliveries", id, "advance"), params, options);
  }
}

/** The Shipping API: `reeds.shipping`. */
export class Shipping {
  readonly coverage: Coverages;
  readonly addresses: Addresses;
  readonly quotes: Quotes;
  readonly deliveries: Deliveries;
  readonly wallet: WalletResource;
  readonly invoices: Invoices;
  readonly sandbox: Sandbox;

  constructor(core: Core) {
    this.coverage = new Coverages(core);
    this.addresses = new Addresses(core);
    this.quotes = new Quotes(core);
    this.deliveries = new Deliveries(core);
    this.wallet = new WalletResource(core);
    this.invoices = new Invoices(core);
    this.sandbox = new Sandbox(core);
  }
}
