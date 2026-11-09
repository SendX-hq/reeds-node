import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  AuthenticationError,
  ConflictError,
  ConnectionError,
  ConnectionTimeoutError,
  InvalidRequestError,
  NotFoundError,
  PaymentRequiredError,
  PermissionDeniedError,
  RateLimitError,
  Reeds,
  ReedsError,
  ServiceUnavailableError,
  VERSION,
} from "../src/index";
import { delivery, failure, fakeApi, json, success, tokenResponse } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("credentials and the token", () => {
  it("fetches one token with the client credentials, form-encoded, and reuses it", async () => {
    const api = fakeApi(() => success(delivery("dlv_1")));
    const reeds = api.client();
    await reeds.shipping.deliveries.get("dlv_1");
    await reeds.shipping.deliveries.get("dlv_1");
    expect(api.tokenCalls()).toHaveLength(1);
    const [token] = api.tokenCalls();
    expect(token!.url.toString()).toBe("https://api.getreeds.co/oauth/token");
    expect(token!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(token!.body))).toEqual({ grant_type: "client_credentials", client_id: "rci_test_abc", client_secret: "rcs_test_xyz" });
    expect(token!.headers["idempotency-key"]).toBeUndefined();
    for (const call of api.apiCalls()) expect(call.headers.authorization).toBe("Bearer tok_1");
  });

  it("concurrent first calls share one token request", async () => {
    const api = fakeApi(() => success(delivery("dlv_1")));
    const reeds = api.client();
    await Promise.all([1, 2, 3, 4, 5].map(() => reeds.shipping.deliveries.get("dlv_1")));
    expect(api.tokenCalls()).toHaveLength(1);
    expect(api.apiCalls()).toHaveLength(5);
  });

  it("refreshes a token a minute before it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    let n = 0;
    const api = fakeApi(() => success(delivery("dlv_1")), () => tokenResponse(`tok_${++n}`));
    const reeds = api.client();
    await reeds.shipping.deliveries.get("dlv_1");
    vi.setSystemTime(new Date("2026-11-09T10:58:00Z"));
    await reeds.shipping.deliveries.get("dlv_1");
    expect(api.tokenCalls()).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-09T10:59:30Z"));
    await reeds.shipping.deliveries.get("dlv_1");
    expect(api.tokenCalls()).toHaveLength(2);
    expect(api.apiCalls().at(-1)!.headers.authorization).toBe("Bearer tok_2");
  });

  it("an expired or revoked token gets one fresh token and one more try, not counted as a retry", async () => {
    let n = 0;
    let first = true;
    const api = fakeApi(
      () => {
        if (first) {
          first = false;
          return failure(401, "TOKEN_EXPIRED", "The access token has expired.");
        }
        return success(delivery("dlv_1"));
      },
      () => tokenResponse(`tok_${++n}`),
    );
    const found = await api.client({ maxRetries: 0 }).shipping.deliveries.get("dlv_1");
    expect(found.id).toBe("dlv_1");
    expect(api.apiCalls().map((call) => call.headers.authorization)).toEqual(["Bearer tok_1", "Bearer tok_2"]);
  });

  it("a second 401 in a row is an AuthenticationError", async () => {
    const api = fakeApi(() => failure(401, "UNAUTHENTICATED", "The access token isn't valid."));
    const error = await api.client().shipping.deliveries.get("dlv_1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(api.apiCalls()).toHaveLength(2);
    expect(api.tokenCalls()).toHaveLength(2);
  });

  it("credentials the token endpoint refuses are an AuthenticationError with the OAuth code", async () => {
    const api = fakeApi(() => success({}), () => json(401, { error: "invalid_client", error_description: "The client id or secret is wrong." }));
    const error = (await api.client().shipping.coverage.get().catch((e: unknown) => e)) as AuthenticationError;
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error).toMatchObject({ status: 401, code: "invalid_client", message: "The client id or secret is wrong.", requestId: "req_8h2KdP" });
    expect(api.apiCalls()).toHaveLength(0);
  });

  it("without credentials, a call says where to find them; webhooks still work", async () => {
    const reeds = new Reeds({ clientId: undefined, clientSecret: undefined, fetch: (async () => success({})) as typeof fetch });
    const error = (await reeds.shipping.coverage.get().catch((e: unknown) => e)) as AuthenticationError;
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.code).toBe("MISSING_CREDENTIALS");
    expect(error.message).toContain("REEDS_CLIENT_ID");
    expect(reeds.mode).toBeNull();
    expect(typeof reeds.webhooks.constructEvent).toBe("function");
  });

  it("reads REEDS_CLIENT_ID and REEDS_CLIENT_SECRET, and the mode from the client id", async () => {
    vi.stubEnv("REEDS_CLIENT_ID", "rci_live_envid");
    vi.stubEnv("REEDS_CLIENT_SECRET", "rcs_live_envsecret");
    const api = fakeApi(() => success({}));
    const reeds = new Reeds({ fetch: api.fetch });
    expect(reeds.mode).toBe("live");
    await reeds.shipping.coverage.get();
    expect(new URLSearchParams(api.tokenCalls()[0]!.body).get("client_id")).toBe("rci_live_envid");
    expect(api.client().mode).toBe("test");
  });

  it("scopes() lists the scopes the token carries", async () => {
    const api = fakeApi(() => success({}), () => tokenResponse("tok_1", { scope: "shipping store" }));
    expect(await api.client().scopes()).toEqual(["shipping", "store"]);
  });

  it("never puts the secret in an error message", async () => {
    const api = fakeApi(() => success({}), () => json(400, { error: "invalid_request", error_description: "grant_type is required." }));
    const error = (await api.client().shipping.coverage.get().catch((e: unknown) => e)) as ReedsError;
    expect(JSON.stringify({ message: error.message, raw: error.raw })).not.toContain("rcs_test_xyz");
  });
});

describe("requests", () => {
  it("sends the SDK's User-Agent, Accept and any default headers, to the base URL you set", async () => {
    const api = fakeApi(() => success({}));
    await api.client({ baseUrl: "https://api.example.test/", defaultHeaders: { "X-Team": "ops" } }).shipping.coverage.get();
    const [call] = api.apiCalls();
    expect(call!.url.toString()).toBe("https://api.example.test/shipping/v1/coverage");
    expect(call!.headers["user-agent"]).toBe(`reeds-node/${VERSION} node/${process.version}`);
    expect(call!.headers.accept).toBe("application/json");
    expect(call!.headers["x-team"]).toBe("ops");
    expect(api.tokenCalls()[0]!.url.toString()).toBe("https://api.example.test/oauth/token");
  });

  it("an empty baseUrl (an unset environment variable) means the default", async () => {
    const api = fakeApi(() => success({}));
    await api.client({ baseUrl: "" }).shipping.coverage.get();
    expect(api.apiCalls()[0]!.url.origin).toBe("https://api.getreeds.co");
    expect(api.tokenCalls()[0]!.url.toString()).toBe("https://api.getreeds.co/oauth/token");
  });

  it("gives every POST an Idempotency-Key, and none to a GET or PATCH", async () => {
    const api = fakeApi(() => success(delivery("dlv_1")));
    const reeds = api.client();
    await reeds.shipping.deliveries.markReady("dlv_1");
    await reeds.shipping.deliveries.markReady("dlv_1");
    await reeds.shipping.deliveries.get("dlv_1");
    await reeds.shipping.deliveries.update("dlv_1", { reference: "R2" });
    const [first, second, get, patch] = api.apiCalls();
    expect(first!.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second!.headers["idempotency-key"]).not.toBe(first!.headers["idempotency-key"]);
    expect(get!.headers["idempotency-key"]).toBeUndefined();
    expect(patch!.headers["idempotency-key"]).toBeUndefined();
  });

  it("uses your Idempotency-Key when you pass one", async () => {
    const api = fakeApi(() => success(delivery("dlv_1"), 201));
    await api.client().shipping.deliveries.create({ quote_id: "qt_1" }, { idempotencyKey: "order-10045-delivery" });
    expect(api.apiCalls()[0]!.headers["idempotency-key"]).toBe("order-10045-delivery");
  });

  it("returns the envelope's data", async () => {
    const api = fakeApi(() => success({ id: "dlv_1", status: "delivered" }));
    expect(await api.client().shipping.deliveries.get("dlv_1")).toEqual({ id: "dlv_1", status: "delivered" });
  });

  it("keeps fields and values it doesn't know", async () => {
    const api = fakeApi(() => success({ id: "dlv_1", status: "with_partner", new_field: { a: 1 } }));
    expect(await api.client().shipping.deliveries.get("dlv_1")).toMatchObject({ status: "with_partner", new_field: { a: 1 } });
  });

  it("a 2xx body that isn't the envelope is an ApiError, not a silent undefined", async () => {
    const api = fakeApi(() => new Response("<html>ok</html>", { status: 200, headers: { "x-request-id": "req_x" } }));
    const error = (await api.client().shipping.coverage.get().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "UNEXPECTED_RESPONSE", requestId: "req_x" });
  });

  it("aborts with your signal", async () => {
    const controller = new AbortController();
    const api = fakeApi(async () => {
      controller.abort();
      return new Error("aborted");
    });
    const error = (await api.client().shipping.coverage.get({ signal: controller.signal }).catch((e: unknown) => e)) as ConnectionError;
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.code).toBe("ABORTED");
    expect(api.apiCalls()).toHaveLength(1);
  });

  it("gives up on an attempt after the timeout", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    const api = fakeApi(() => success({}));
    let calls = 0;
    const reeds = api.client({
      timeout: 20,
      maxRetries: 1,
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => (String(url).endsWith("/oauth/token") ? tokenResponse() : (calls++, hang(url, init)))) as typeof fetch,
    });
    const error = (await reeds.shipping.coverage.get().catch((e: unknown) => e)) as ConnectionTimeoutError;
    expect(error).toBeInstanceOf(ConnectionTimeoutError);
    expect(error.code).toBe("TIMEOUT");
    expect(calls).toBe(2);
  });
});

describe("retries", () => {
  const sequence = (...answers: Array<Response | Error>) => {
    let i = 0;
    return () => answers[Math.min(i++, answers.length - 1)]!;
  };

  it("retries a 429 after Retry-After, with the same Idempotency-Key", async () => {
    const api = fakeApi(sequence(failure(429, "RATE_LIMITED", "Too many requests.", {}, { "retry-after": "3" }), success(delivery("dlv_1"), 201)));
    const created = await api.client().shipping.deliveries.create({ quote_id: "qt_1" });
    expect(created.id).toBe("dlv_1");
    const [first, second] = api.apiCalls();
    expect(second!.headers["idempotency-key"]).toBe(first!.headers["idempotency-key"]);
    expect(api.sleeps).toEqual([3000]);
  });

  it("retries 502, 503 and 504, backing off 0.5 s then 1 s without Retry-After", async () => {
    const api = fakeApi(sequence(failure(502, "INTERNAL_ERROR"), failure(503, "SERVICE_UNAVAILABLE"), success({})));
    await api.client().shipping.coverage.get();
    expect(api.apiCalls()).toHaveLength(3);
    expect(api.sleeps).toEqual([500, 1000]);
  });

  it("retries a 500 on a GET, never on a POST", async () => {
    const get = fakeApi(sequence(failure(500, "INTERNAL_ERROR"), success({})));
    await get.client().shipping.coverage.get();
    expect(get.apiCalls()).toHaveLength(2);

    const post = fakeApi(sequence(failure(500, "INTERNAL_ERROR"), success({})));
    const error = await post.client().shipping.deliveries.book("dlv_1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(post.apiCalls()).toHaveLength(1);
  });

  it("retries 409 REQUEST_IN_PROGRESS (the same key still running), but not another 409", async () => {
    const running = fakeApi(sequence(failure(409, "REQUEST_IN_PROGRESS"), success(delivery("dlv_1"))));
    await running.client().shipping.deliveries.book("dlv_1");
    expect(running.apiCalls()).toHaveLength(2);

    const booked = fakeApi(sequence(failure(409, "ACTION_NOT_ALLOWED", "This delivery is already booked.")));
    expect(await booked.client().shipping.deliveries.book("dlv_1").catch((e: unknown) => e)).toBeInstanceOf(ConflictError);
    expect(booked.apiCalls()).toHaveLength(1);
  });

  it("retries a dropped connection, then gives up with a ConnectionError", async () => {
    const api = fakeApi(() => new TypeError("fetch failed"));
    const error = (await api.client().shipping.coverage.get().catch((e: unknown) => e)) as ConnectionError;
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.code).toBe("CONNECTION_FAILED");
    expect(api.apiCalls()).toHaveLength(3);
  });

  it("stops after maxRetries and throws the last error, with retryAfter", async () => {
    const api = fakeApi(() => failure(503, "SERVICE_UNAVAILABLE", "Reeds is busy.", {}, { "retry-after": "2" }));
    const error = (await api.client({ maxRetries: 1 }).shipping.coverage.get().catch((e: unknown) => e)) as ServiceUnavailableError;
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.retryAfter).toBe(2);
    expect(api.apiCalls()).toHaveLength(2);
  });

  it("doesn't wait out a Retry-After longer than 30 s: the caller decides", async () => {
    const api = fakeApi(() => failure(429, "RATE_LIMITED", "Slow down.", {}, { "retry-after": "120" }));
    const error = (await api.client().shipping.quotes.create({} as never).catch((e: unknown) => e)) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(120);
    expect(api.apiCalls()).toHaveLength(1);
    expect(api.sleeps).toEqual([]);
  });

  it("maxRetries per request overrides the client's", async () => {
    const api = fakeApi(() => failure(503, "SERVICE_UNAVAILABLE"));
    await api.client().shipping.coverage.get({ maxRetries: 0 }).catch(() => undefined);
    expect(api.apiCalls()).toHaveLength(1);
  });

  it("never retries 400, 402, 403, 404 or 422", async () => {
    for (const [status, code] of [[400, "IDEMPOTENCY_KEY_REQUIRED"], [402, "INSUFFICIENT_BALANCE"], [403, "INSUFFICIENT_SCOPE"], [404, "NOT_FOUND"], [422, "INVALID_REQUEST"]] as const) {
      const api = fakeApi(() => failure(status, code));
      await api.client().shipping.deliveries.get("dlv_1").catch(() => undefined);
      expect(api.apiCalls(), String(status)).toHaveLength(1);
    }
  });
});

describe("errors", () => {
  it("maps each status to its class, with the code, fields, doc_url and request id", async () => {
    const cases: Array<[number, string, new (...args: never[]) => ReedsError]> = [
      [400, "IDEMPOTENCY_KEY_REQUIRED", InvalidRequestError],
      [402, "INSUFFICIENT_BALANCE", PaymentRequiredError],
      [403, "INSUFFICIENT_SCOPE", PermissionDeniedError],
      [404, "NOT_FOUND", NotFoundError],
      [409, "QUOTE_ALREADY_USED", ConflictError],
      [422, "INVALID_REQUEST", InvalidRequestError],
    ];
    for (const [status, code, ErrorClass] of cases) {
      const api = fakeApi(() => failure(status, code, "Nope.", { fields: [{ field: "dropoff.lga", message: "Enter the LGA." }], delivery_id: "dlv_9" }));
      const error = (await api.client().shipping.deliveries.get("dlv_1").catch((e: unknown) => e)) as ReedsError;
      expect(error, code).toBeInstanceOf(ErrorClass);
      expect(error).toBeInstanceOf(ReedsError);
      expect(error).toMatchObject({ status, code, message: "Nope.", docUrl: `https://developer.getreeds.co/errors/${code}`, requestId: "req_8h2KdP" });
      expect(error.fields).toEqual([{ field: "dropoff.lga", message: "Enter the LGA." }]);
      expect(error.raw?.delivery_id).toBe("dlv_9");
      expect(error.name).toBe(ErrorClass.name);
    }
  });

  it("a failure without a JSON body still says the status", async () => {
    const api = fakeApi(() => new Response("<html>413 Request Entity Too Large</html>", { status: 413 }));
    const error = (await api.client().shipping.coverage.get().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, code: "HTTP_413" });
  });
});
