import { describe, expect, it } from "vitest";
import { Page, PermissionDeniedError } from "../src/index";
import { delivery, fakeApi, failure, json, success } from "./helpers";

const pickup = { name: "Tola Fabrics", phone: "08051234567", address: "23 Allen Avenue", lga: "Ikeja", state: "Lagos" };
const dropoff = { name: "Chinedu Eze", phone: "08098765432", address: "14 Admiralty Way", lga: "Eti-Osa", state: "Lagos" };

describe("reeds.shipping: every operation's request", () => {
  it("sends each call to its path, with its method, body and query", async () => {
    const api = fakeApi((call) => {
      if (call.url.pathname.endsWith("/label") || call.url.pathname.endsWith("/pdf")) return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-type": "application/pdf" } });
      if (call.method === "GET" && /\/(deliveries|transactions|invoices)$/.test(call.url.pathname)) return json(200, { status: "success", data: [], has_more: false });
      return success({ id: "x" });
    });
    const s = api.client().shipping;
    await s.coverage.get();
    await s.addresses.autocomplete({ query: "23 Allen Avenue", session_token: "3f2c8d1e-7b4a-4c55-9e0d-2a6b1f9c8e70" });
    await s.addresses.details({ place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4", session_token: "3f2c8d1e-7b4a-4c55-9e0d-2a6b1f9c8e70" });
    await s.addresses.reverse({ latitude: 6.6018, longitude: 3.3515 });
    await s.quotes.create({ pickup, dropoff, package: { weight_kg: 2 } } as never);
    await s.deliveries.create({ quote_id: "qt_1", reference: "ORDER-1", ready: false });
    await s.deliveries.list({ status: "scheduled", ids: ["dlv_1", "dlv_2"], limit: 10 });
    await s.deliveries.get("dlv_1");
    await s.deliveries.update("dlv_1", { reference: "ORDER-2" });
    await s.deliveries.book("dlv_1");
    await s.deliveries.markReady("dlv_1");
    await s.deliveries.cancel("dlv_1", { reason: "Customer cancelled" });
    await s.deliveries.label("dlv_1");
    await s.wallet.get();
    await s.wallet.fund({ amount: 500000 });
    await s.wallet.listTransactions({ limit: 5 });
    await s.invoices.list({ status: "issued" });
    await s.invoices.get("inv_1");
    await s.invoices.pdf("inv_1");
    await s.sandbox.fundWallet({ amount: 1000000 });
    await s.sandbox.advanceDelivery("dlv_1", { status: "delivered" } as never);
    await api.client().webhooks.sendTest({ type: "delivery.booked" } as never);

    const seen = api.apiCalls().map((call) => `${call.method} ${call.url.pathname}${call.url.search}${call.body ? ` ${call.body}` : ""}`);
    expect(seen).toEqual([
      "GET /shipping/v1/coverage",
      "GET /shipping/v1/addresses/autocomplete?query=23+Allen+Avenue&session_token=3f2c8d1e-7b4a-4c55-9e0d-2a6b1f9c8e70",
      "GET /shipping/v1/addresses/details?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4&session_token=3f2c8d1e-7b4a-4c55-9e0d-2a6b1f9c8e70",
      "GET /shipping/v1/addresses/reverse?latitude=6.6018&longitude=3.3515",
      `POST /shipping/v1/quotes ${JSON.stringify({ pickup, dropoff, package: { weight_kg: 2 } })}`,
      'POST /shipping/v1/deliveries {"quote_id":"qt_1","reference":"ORDER-1","ready":false}',
      "GET /shipping/v1/deliveries?status=scheduled&ids=dlv_1%2Cdlv_2&limit=10",
      "GET /shipping/v1/deliveries/dlv_1",
      'PATCH /shipping/v1/deliveries/dlv_1 {"reference":"ORDER-2"}',
      "POST /shipping/v1/deliveries/dlv_1/book",
      "POST /shipping/v1/deliveries/dlv_1/ready",
      'POST /shipping/v1/deliveries/dlv_1/cancel {"reason":"Customer cancelled"}',
      "GET /shipping/v1/deliveries/dlv_1/label",
      "GET /shipping/v1/wallet",
      'POST /shipping/v1/wallet/fund {"amount":500000}',
      "GET /shipping/v1/wallet/transactions?limit=5",
      "GET /shipping/v1/invoices?status=issued",
      "GET /shipping/v1/invoices/inv_1",
      "GET /shipping/v1/invoices/inv_1/pdf",
      'POST /shipping/v1/sandbox/wallet/fund {"amount":1000000}',
      'POST /shipping/v1/sandbox/deliveries/dlv_1/advance {"status":"delivered"}',
      'POST /shipping/v1/webhooks/test {"type":"delivery.booked"}',
    ]);
    expect(api.apiCalls().find((call) => call.url.pathname.endsWith("/label"))!.headers.accept).toBe("application/pdf");
  });

  it("escapes ids in the path", async () => {
    const api = fakeApi(() => success({}));
    await api.client().shipping.deliveries.get("dlv_1/../wallet");
    expect(api.apiCalls()[0]!.url.pathname).toBe("/shipping/v1/deliveries/dlv_1%2F..%2Fwallet");
  });
});

describe("addresses", () => {
  const TOKEN = "3f2c8d1e-7b4a-4c55-9e0d-2a6b1f9c8e70";
  const place = {
    place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    name: "23 Allen Avenue",
    formatted_address: "23 Allen Ave, Allen, Ikeja 101233, Lagos, Nigeria",
    area: "Ikeja",
    lga: "Ikeja",
    state: "Lagos",
    country: "NG",
    latitude: 6.6018,
    longitude: 3.3515,
    precise: true,
  };

  it("returns the suggestions and the place themselves, out of data", async () => {
    const suggestions = [{ place_id: place.place_id, main_text: "23 Allen Avenue", secondary_text: "Ikeja, Lagos, Nigeria" }];
    const api = fakeApi((call) => (call.url.pathname.endsWith("/autocomplete") ? success({ suggestions }) : success(place)));
    const s = api.client().shipping;
    expect(await s.addresses.autocomplete({ query: "23 Allen", session_token: TOKEN })).toEqual({ suggestions });
    expect(await s.addresses.details({ place_id: place.place_id, session_token: TOKEN })).toEqual(place);
    expect(await s.addresses.reverse({ latitude: 6.6018, longitude: 3.3515 })).toEqual(place);
    // Reads: no Idempotency-Key on any of them.
    expect(api.apiCalls().map((call) => [call.method, call.headers["idempotency-key"]])).toEqual([["GET", undefined], ["GET", undefined], ["GET", undefined]]);
  });

  it("leaves session_token out of details when there is none", async () => {
    const api = fakeApi(() => success(place));
    await api.client().shipping.addresses.details({ place_id: place.place_id });
    expect(api.apiCalls()[0]!.url.search).toBe(`?place_id=${place.place_id}`);
  });

  it("sends a pin's coordinates as plain decimals", async () => {
    const api = fakeApi(() => success(place));
    await api.client().shipping.addresses.reverse({ latitude: 9.0765, longitude: 7.398574 });
    expect(api.apiCalls()[0]!.url.search).toBe("?latitude=9.0765&longitude=7.398574");
  });

  it("answers a search past the allowance, or switched off, with PermissionDeniedError and no retry", async () => {
    for (const code of ["ADDRESS_SEARCH_LIMIT_REACHED", "ADDRESS_SEARCH_DISABLED"]) {
      const api = fakeApi(() => failure(403, code));
      const error = (await api.client().shipping.addresses.autocomplete({ query: "23 Allen", session_token: TOKEN }).catch((e: unknown) => e)) as PermissionDeniedError;
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect(error.code).toBe(code);
      expect(error.status).toBe(403);
      expect(api.apiCalls()).toHaveLength(1);
    }
  });
});

describe("quotes", () => {
  it("answers a route Reeds doesn't serve with available: false, not an error", async () => {
    const api = fakeApi(() => success({ available: false, reason: { code: "INTERSTATE_NOT_AVAILABLE", message: "Reeds doesn't deliver from Lagos to Kano." } }));
    const quote = await api.client().shipping.quotes.create({ pickup, dropoff } as never);
    expect(quote.available).toBe(false);
  });
});

describe("lists", () => {
  const pages = (ids: string[][]) =>
    fakeApi((call) => {
      const after = call.url.searchParams.get("starting_after");
      const index = after === null ? 0 : ids.findIndex((page) => page.at(-1) === after) + 1;
      const page = ids[index] ?? [];
      return json(200, { status: "success", data: page.map((id) => delivery(id)), has_more: index < ids.length - 1 });
    });

  it("await gives one page with has_more and nextPage()", async () => {
    const api = pages([["dlv_3", "dlv_2"], ["dlv_1"]]);
    const page = await api.client().shipping.deliveries.list({ limit: 2 });
    expect(page).toBeInstanceOf(Page);
    expect(page.data.map((d) => d.id)).toEqual(["dlv_3", "dlv_2"]);
    expect(page.has_more).toBe(true);
    const next = await page.nextPage();
    expect(next!.data.map((d) => d.id)).toEqual(["dlv_1"]);
    expect(next!.has_more).toBe(false);
    expect(await next!.nextPage()).toBeNull();
    expect(api.apiCalls()[1]!.url.search).toBe("?limit=2&starting_after=dlv_2");
  });

  it("for await walks every page, keeping the filters", async () => {
    const api = pages([["dlv_5", "dlv_4"], ["dlv_3", "dlv_2"], ["dlv_1"]]);
    const ids: string[] = [];
    for await (const d of api.client().shipping.deliveries.list({ status: "delivered", limit: 2 })) ids.push(d.id);
    expect(ids).toEqual(["dlv_5", "dlv_4", "dlv_3", "dlv_2", "dlv_1"]);
    expect(api.apiCalls().map((call) => call.url.search)).toEqual([
      "?status=delivered&limit=2",
      "?status=delivered&limit=2&starting_after=dlv_4",
      "?status=delivered&limit=2&starting_after=dlv_2",
    ]);
  });

  it("an empty list ends at once", async () => {
    const api = pages([[]]);
    const items = [];
    for await (const transaction of api.client().shipping.wallet.listTransactions()) items.push(transaction);
    expect(items).toEqual([]);
    expect(api.apiCalls()).toHaveLength(1);
  });
});

describe("files", () => {
  it("returns a label's bytes, type and filename", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 label");
    const api = fakeApi(() => new Response(pdf, { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="reeds-label-HQ3W5F2.pdf"' } }));
    const file = await api.client().shipping.deliveries.label("dlv_1");
    expect(file.filename).toBe("reeds-label-HQ3W5F2.pdf");
    expect(file.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(file.data)).toBe("%PDF-1.7 label");
  });
});

describe("sandbox", () => {
  it("refuses with live credentials before sending anything", async () => {
    const api = fakeApi(() => success({}));
    const reeds = api.client({ clientId: "rci_live_abc", clientSecret: "rcs_live_xyz" });
    for (const call of [() => reeds.shipping.sandbox.fundWallet({ amount: 1000 } as never), () => reeds.shipping.sandbox.advanceDelivery("dlv_1")]) {
      const error = (await call().catch((e: unknown) => e)) as PermissionDeniedError;
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect(error.code).toBe("TEST_MODE_ONLY");
    }
    expect(api.calls).toHaveLength(0);
  });
});
