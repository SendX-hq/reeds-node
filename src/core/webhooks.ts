import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors";

/**
 * Webhook signatures, the same for every Reeds API:
 *
 *   Reeds-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]
 *
 * Each v1 is the hex HMAC-SHA256 of `t + "." + raw body`, keyed with the
 * endpoint's signing secret (whsec_test_... or whsec_live_...). During a secret
 * rotation the header carries two v1 values for 24 hours; any match is enough.
 * Then `t` must be within 5 minutes of now: every attempt, retries included,
 * is signed afresh when it is sent.
 */

/** Seconds a signed event stays valid either side of now. */
export const DEFAULT_TOLERANCE = 300;

export type VerifyOptions = {
  /** Seconds either side of now. Default 300. */
  tolerance?: number;
  /** Now, in Unix seconds. For tests. */
  now?: number;
};

/** The raw request body: the exact bytes Reeds sent, as a string or a Buffer/Uint8Array. Never a parsed object. */
export type WebhookPayload = string | Uint8Array;

const fail = (code: string, message: string): never => {
  throw new WebhookSignatureError({ code, message });
};

const bytesOf = (payload: WebhookPayload): Uint8Array => {
  if (typeof payload === "string") return new TextEncoder().encode(payload);
  if (payload instanceof Uint8Array) return payload;
  return fail(
    "RAW_BODY_REQUIRED",
    "Pass the raw request body (a string or Buffer), not parsed JSON: a re-serialised body never matches the signature. See the README for your framework.",
  );
};

const parseHeader = (header: string | null | undefined): { timestamp: number; signatures: string[] } => {
  if (typeof header !== "string" || header.trim() === "") return fail("NO_SIGNATURE_HEADER", "The request has no Reeds-Signature header.");
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === undefined) return fail("INVALID_SIGNATURE_HEADER", "The Reeds-Signature header has no valid t= timestamp.");
  if (signatures.length === 0) return fail("NO_SIGNATURE", "The Reeds-Signature header has no v1= signature.");
  return { timestamp, signatures };
};

const sign = (secret: string, timestamp: number, body: Uint8Array): Buffer =>
  createHmac("sha256", Buffer.from(secret, "utf8")).update(`${timestamp}.`, "utf8").update(body).digest();

const matches = (expected: Buffer, given: string): boolean => {
  if (!/^[0-9a-f]+$/i.test(given) || given.length !== expected.length * 2) return false;
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
};

const secretsOf = (secret: string | readonly string[]): string[] => {
  const secrets = (Array.isArray(secret) ? secret : [secret]) as string[];
  if (secrets.length === 0 || secrets.some((value) => typeof value !== "string" || value === "")) {
    fail("NO_SECRET", "Pass your webhook endpoint's signing secret (whsec_...), from Dashboard → Developers.");
  }
  if (secrets.some((value) => value.startsWith("rcs_"))) {
    fail("WRONG_SECRET_TYPE", "That's a client secret. Webhooks are signed with the endpoint's signing secret (whsec_...), from Dashboard → Developers.");
  }
  return secrets;
};

/**
 * Checks a webhook's Reeds-Signature. Throws WebhookSignatureError when it
 * doesn't check out; answer 400 then, and don't act on the event.
 * `secret` can be a list (both secrets while you rotate one).
 */
export const verifySignature = (payload: WebhookPayload, header: string | null | undefined, secret: string | readonly string[], options: VerifyOptions = {}): void => {
  const secrets = secretsOf(secret);
  const body = bytesOf(payload);
  const { timestamp, signatures } = parseHeader(header);
  const signed = secrets.some((value) => {
    const expected = sign(value, timestamp, body);
    return signatures.some((given) => matches(expected, given));
  });
  if (!signed) fail("SIGNATURE_MISMATCH", "No signature in the Reeds-Signature header matches this body and secret.");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  if (Math.abs(now - timestamp) > tolerance) {
    fail("TIMESTAMP_OUTSIDE_TOLERANCE", `The event was signed ${Math.abs(now - timestamp)} s from now; the limit is ${tolerance} s.`);
  }
};

/** Verifies the signature, then parses the event. */
export const constructEvent = <E>(payload: WebhookPayload, header: string | null | undefined, secret: string | readonly string[], options: VerifyOptions = {}): E => {
  verifySignature(payload, header, secret, options);
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  try {
    return JSON.parse(text) as E;
  } catch {
    return fail("INVALID_PAYLOAD", "The signed body isn't JSON.");
  }
};
