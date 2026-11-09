import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Reeds, WebhookSignatureError, webhooks } from "../src/index";

type Vector = { name: string; payload: string; header: string; secrets: string[]; now: number; valid: boolean; error?: string };
const vectors = JSON.parse(readFileSync(new URL("./fixtures/webhook-vectors.json", import.meta.url), "utf8")) as { tolerance: number; cases: Vector[] };

const outcome = (run: () => unknown): string => {
  try {
    run();
    return "valid";
  } catch (error) {
    if (!(error instanceof WebhookSignatureError)) throw error;
    return error.code;
  }
};

describe("webhook signatures: the shared vectors (made by the API's own signer)", () => {
  for (const vector of vectors.cases) {
    it(vector.name, () => {
      const expected = vector.valid ? "valid" : vector.error;
      const options = { now: vector.now, tolerance: vectors.tolerance };
      expect(outcome(() => webhooks.verifySignature(vector.payload, vector.header, vector.secrets, options))).toBe(expected);
      // The same with the body as bytes, as a raw-body parser gives it.
      expect(outcome(() => webhooks.verifySignature(Buffer.from(vector.payload, "utf8"), vector.header, vector.secrets, options))).toBe(expected);
    });
  }
});

describe("constructEvent", () => {
  const valid = vectors.cases.find((vector) => vector.name === "valid")!;
  const future = vectors.cases.find((vector) => vector.name.startsWith("an event type"))!;

  it("returns the parsed event once the signature checks out", () => {
    const event = new Reeds().webhooks.constructEvent(valid.payload, valid.header, valid.secrets, { now: valid.now });
    expect(event.type).toBe("delivery.booked");
    if (event.type === "delivery.booked") expect(event.data.delivery.id).toBe("dlv_9Kd3Qx7M");
  });

  it("returns an event type it doesn't know yet, instead of throwing", () => {
    const event = webhooks.constructEvent(future.payload, future.header, future.secrets, { now: future.now });
    expect(event.type as string).toBe("order.paid");
  });

  it("refuses a parsed body and says to pass the raw one", () => {
    const error = (() => {
      try {
        webhooks.constructEvent(JSON.parse(valid.payload), valid.header, valid.secrets, { now: valid.now });
      } catch (e) {
        return e as WebhookSignatureError;
      }
    })();
    expect(error).toBeInstanceOf(WebhookSignatureError);
    expect(error!.code).toBe("RAW_BODY_REQUIRED");
  });

  it("refuses a client secret, which never signs webhooks", () => {
    expect(outcome(() => webhooks.verifySignature(valid.payload, valid.header, "rcs_test_xyz", { now: valid.now }))).toBe("WRONG_SECRET_TYPE");
  });

  it("refuses no secret", () => {
    expect(outcome(() => webhooks.verifySignature(valid.payload, valid.header, "", { now: valid.now }))).toBe("NO_SECRET");
    expect(outcome(() => webhooks.verifySignature(valid.payload, valid.header, [], { now: valid.now }))).toBe("NO_SECRET");
  });

  it("checks the time against the clock by default", () => {
    // The vectors were signed in 2026; with today's clock the valid one is too old.
    const now = Math.floor(Date.now() / 1000);
    expect(outcome(() => webhooks.verifySignature(valid.payload, valid.header, valid.secrets))).toBe(Math.abs(now - valid.now) > 300 ? "TIMESTAMP_OUTSIDE_TOLERANCE" : "valid");
  });
});
