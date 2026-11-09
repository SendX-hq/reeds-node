import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { Reeds, SHIPPING_EVENT_TYPES, VERSION } from "../src/index";

/**
 * The SDK against its specs: every operation has a method, every event type is
 * known, and nothing in the SDK points at an operation the spec doesn't have.
 * When the sync-spec workflow brings in a new operation, this fails until the
 * method exists.
 */

type Spec = { paths: Record<string, Record<string, { operationId?: string }>>; webhooks?: Record<string, unknown> };
const spec = (file: string) => parse(readFileSync(new URL(`../spec/${file}`, import.meta.url), "utf8")) as Spec;
const operationIds = (s: Spec) =>
  Object.values(s.paths).flatMap((item) => Object.entries(item).filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method)).map(([, op]) => op.operationId!));

const reeds = new Reeds({ clientId: "rci_test_x", clientSecret: "rcs_test_x" });

/** operationId -> the method that calls it. The token endpoint is the core's. */
const SHIPPING_METHODS: Record<string, unknown> = {
  createAccessToken: "core",
  getCoverage: reeds.shipping.coverage.get,
  createQuote: reeds.shipping.quotes.create,
  createDelivery: reeds.shipping.deliveries.create,
  listDeliveries: reeds.shipping.deliveries.list,
  getDelivery: reeds.shipping.deliveries.get,
  updateDelivery: reeds.shipping.deliveries.update,
  bookDelivery: reeds.shipping.deliveries.book,
  markDeliveryReady: reeds.shipping.deliveries.markReady,
  cancelDelivery: reeds.shipping.deliveries.cancel,
  getDeliveryLabel: reeds.shipping.deliveries.label,
  getWallet: reeds.shipping.wallet.get,
  fundWallet: reeds.shipping.wallet.fund,
  listWalletTransactions: reeds.shipping.wallet.listTransactions,
  listInvoices: reeds.shipping.invoices.list,
  getInvoice: reeds.shipping.invoices.get,
  getInvoicePdf: reeds.shipping.invoices.pdf,
  sendTestWebhook: reeds.webhooks.sendTest,
  sandboxFundWallet: reeds.shipping.sandbox.fundWallet,
  sandboxAdvanceDelivery: reeds.shipping.sandbox.advanceDelivery,
};

describe("the Shipping API spec (spec/shipping-v1.yaml)", () => {
  const shipping = spec("shipping-v1.yaml");

  it("every operation has a method, and every method an operation", () => {
    expect(Object.keys(SHIPPING_METHODS).sort()).toEqual(operationIds(shipping).sort());
    for (const [operationId, method] of Object.entries(SHIPPING_METHODS)) {
      if (method !== "core") expect(typeof method, operationId).toBe("function");
    }
  });

  it("every webhook event type is known", () => {
    expect([...SHIPPING_EVENT_TYPES].sort()).toEqual(Object.keys(shipping.webhooks ?? {}).sort());
  });
});

describe("the package", () => {
  it("VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
