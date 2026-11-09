// The README's examples, type-checked by `npm run typecheck` (never run): if the
// types change under an example, this stops compiling.
import Reeds, { InvalidRequestError, PaymentRequiredError, ReedsError, webhooks, type ReedsEvent } from "../src/index";

export async function quickstart(): Promise<void> {
  const reeds = new Reeds({ clientId: process.env.REEDS_CLIENT_ID, clientSecret: process.env.REEDS_CLIENT_SECRET });

  const quote = await reeds.shipping.quotes.create({
    pickup: { name: "Tola Fabrics", phone: "08051234567", address: "23 Allen Avenue", area: "Ikeja", lga: "Ikeja", state: "Lagos" },
    dropoff: { name: "Chinedu Eze", phone: "08098765432", address: "14 Admiralty Way", area: "Lekki Phase 1", lga: "Eti-Osa", state: "Lagos" },
    package: { description: "2 pairs of sneakers", quantity: 1, weight_kg: 1.5 },
  });
  if (!quote.available) throw new Error(quote.reason.message);

  const delivery = await reeds.shipping.deliveries.create({ quote_id: quote.id, reference: "ORDER-10045" });
  console.log(delivery.tracking_code, delivery.schedule);

  const notReady = await reeds.shipping.deliveries.create({ quote_id: quote.id, ready: false });
  await reeds.shipping.deliveries.markReady(notReady.id);

  const page = await reeds.shipping.deliveries.list({ status: "delivered", limit: 50 });
  console.log(page.data.length, page.has_more, await page.nextPage());
  for await (const d of reeds.shipping.deliveries.list({ status: "delivered" })) console.log(d.id);

  const label = await reeds.shipping.deliveries.label(delivery.id);
  console.log(label.filename ?? "label.pdf", label.data.byteLength);

  try {
    await reeds.shipping.deliveries.create({ quote_id: quote.id }, { idempotencyKey: "order-10045-delivery" });
  } catch (error) {
    if (error instanceof PaymentRequiredError) console.log(error.code);
    else if (error instanceof InvalidRequestError) console.log(error.fields);
    else if (error instanceof ReedsError) console.error(error.code, error.message, error.requestId, error.docUrl);
  }

  await reeds.shipping.sandbox.fundWallet({ amount: 1_000_000 });
  await reeds.shipping.sandbox.advanceDelivery(delivery.id);
  await reeds.shipping.sandbox.advanceDelivery(delivery.id, { status: "delivered" });
  await reeds.webhooks.sendTest({ type: "delivery.booked" });
  console.log(reeds.mode, await reeds.scopes());
}

export function handle(body: string, header: string | null): void {
  const event: ReedsEvent = webhooks.constructEvent(body, header, [process.env.REEDS_WEBHOOK_SECRET!, "whsec_test_old"]);
  switch (event.type) {
    case "delivery.status_changed":
      console.log(event.data.delivery.id, event.data.previous_status, "->", event.data.delivery.status);
      break;
    case "wallet.low_balance":
      console.log("Wallet low:", event.data.balance);
      break;
    case "delivery.schedule_changed":
      // `reason` can be absent; the previous schedule is always there.
      console.log(event.data.reason ?? "", event.data.previous_schedule);
      break;
    default:
      break;
  }
}
