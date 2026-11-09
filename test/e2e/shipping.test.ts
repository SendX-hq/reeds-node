import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, Reeds } from "../../src/index";

/**
 * The SDK against the real API in Test mode: run nightly by .github/workflows/e2e.yml,
 * or by hand with `npm run test:e2e`. Needs TEST credentials of a dedicated account:
 *
 *   REEDS_E2E_CLIENT_ID=rci_test_... REEDS_E2E_CLIENT_SECRET=rcs_test_... npm run test:e2e
 *
 * REEDS_E2E_BASE_URL picks the API (default https://api.getreeds.co). Test mode never
 * moves real money or sends a rider.
 */
const clientId = process.env.REEDS_E2E_CLIENT_ID;
const clientSecret = process.env.REEDS_E2E_CLIENT_SECRET;
const run = clientId && clientSecret ? describe : describe.skip;

const pickup = { name: "Reeds SDK test", phone: "08031234567", address: "23 Allen Avenue", area: "Ikeja", lga: "Ikeja", state: "Lagos" };
const dropoff = { name: "Reeds SDK receiver", phone: "08098765432", address: "14 Admiralty Way", area: "Lekki Phase 1", lga: "Eti-Osa", state: "Lagos" };
const pack = { description: "SDK end-to-end test parcel", quantity: 1, weight_kg: 1 };

run("Shipping API, Test mode, end to end", () => {
  const reeds = new Reeds({ clientId, clientSecret, baseUrl: process.env.REEDS_E2E_BASE_URL });

  it("uses test credentials", async () => {
    expect(reeds.mode).toBe("test");
    expect(await reeds.scopes()).toContain("shipping");
  });

  it("quote, book not ready, mark ready, advance to delivered, label", async () => {
    await reeds.shipping.sandbox.fundWallet({ amount: 1_000_000 });
    const quote = await reeds.shipping.quotes.create({ pickup, dropoff, package: pack });
    if (!quote.available) throw new Error(`Reeds didn't quote the test route: ${JSON.stringify(quote)}`);

    const reference = `SDK-E2E-${Date.now()}`;
    const made = await reeds.shipping.deliveries.create({ quote_id: quote.id, reference, ready: false });
    expect(made.status).toBe("requires_action");
    expect(made.required_actions?.map((action) => action.type)).toEqual(["MARK_READY"]);

    const ready = await reeds.shipping.deliveries.markReady(made.id);
    expect(ready.status).toBe("scheduled");

    const delivered = await reeds.shipping.sandbox.advanceDelivery(made.id, { status: "delivered" });
    expect(delivered.status).toBe("delivered");

    const found = await reeds.shipping.deliveries.list({ reference });
    expect(found.data.map((d) => d.id)).toEqual([made.id]);

    const label = await reeds.shipping.deliveries.label(made.id);
    expect(new TextDecoder().decode(label.data.subarray(0, 4))).toBe("%PDF");
  });

  it("errors carry the API's code and request id", async () => {
    const missing = await reeds.shipping.deliveries.get("dlv_00000000-0000-0000-0000-000000000000").catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect((missing as NotFoundError).requestId).toBeTruthy();

    const quote = await reeds.shipping.quotes.create({ pickup, dropoff, package: pack });
    if (!quote.available) throw new Error("no quote");
    const made = await reeds.shipping.deliveries.create({ quote_id: quote.id, ready: false });
    await reeds.shipping.deliveries.cancel(made.id, { reason: "SDK end-to-end test" });
    await expect(reeds.shipping.deliveries.markReady(made.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
