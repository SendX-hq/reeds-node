import { randomUUID } from "node:crypto";
import { ApiError, AuthenticationError, ConnectionError, ConnectionTimeoutError, errorFromResponse } from "./errors";
import { Page, PagePromise } from "./pagination";
import { VERSION } from "../version";

/**
 * The part of the SDK every API module shares: credentials and the token,
 * the HTTP calls, retries, idempotency keys, errors, pagination and files.
 * It knows nothing about deliveries or orders; the modules in src/apis/ give
 * it paths.
 */

export type Mode = "test" | "live";

export type ClientOptions = {
  /** Your client id (`rci_test_...` or `rci_live_...`). Defaults to the REEDS_CLIENT_ID environment variable. */
  clientId?: string;
  /** Your client secret (`rcs_test_...` or `rcs_live_...`). Defaults to REEDS_CLIENT_SECRET. */
  clientSecret?: string;
  /** Defaults to https://api.getreeds.co. */
  baseUrl?: string;
  /** Milliseconds to wait for a response before giving up on an attempt. Default 60 000. */
  timeout?: number;
  /** How many times a failed request is retried when it is safe to (see the README). Default 2. */
  maxRetries?: number;
  /** A fetch implementation to use instead of the global one. */
  fetch?: typeof fetch;
  /** Headers sent with every request. */
  defaultHeaders?: Record<string, string>;
};

export type RequestOptions = {
  /** Sent as `Idempotency-Key`. Every POST gets a fresh key unless you pass one; retries reuse it. */
  idempotencyKey?: string;
  /** Milliseconds, for this request only. */
  timeout?: number;
  /** Retries, for this request only. */
  maxRetries?: number;
  /** Aborts the request (and any retry still waiting). */
  signal?: AbortSignal;
  /** Extra headers for this request. */
  headers?: Record<string, string>;
};

/** A downloaded file: a delivery label or an invoice PDF. */
export type FileResponse = {
  /** The filename Reeds suggests (`Content-Disposition`), when it sends one. */
  filename: string | null;
  contentType: string;
  data: Uint8Array;
};

/** Test hooks, not part of the public API. */
export const TESTING = Symbol.for("reeds.testing");
type Testing = { sleep?: (ms: number) => Promise<void>; random?: () => number };

type Token = { value: string; expiresAt: number; scopes: string[]; livemode: boolean };

type Query = Record<string, string | number | boolean | string[] | null | undefined>;
type Body = { json?: unknown; form?: Record<string, string> };

const DEFAULT_BASE_URL = "https://api.getreeds.co";
const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_RETRIES = 2;
/** A token is refreshed this long before it expires. */
const REFRESH_MARGIN = 60_000;
/** A Retry-After longer than this isn't waited for: the error goes to the caller, with `retryAfter` on it. */
const MAX_RETRY_AFTER_SECONDS = 30;

class Timeout extends Error {}

const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env?.[name] : undefined) || undefined;

const modeOf = (clientId: string | undefined): Mode | null =>
  clientId?.startsWith("rci_live_") ? "live" : clientId?.startsWith("rci_test_") ? "test" : null;

const userAgent = (): string | undefined =>
  typeof process !== "undefined" && process.versions?.node ? `reeds-node/${VERSION} node/${process.version}` : undefined;

/** Seconds from a Retry-After header (seconds, or an HTTP date). */
const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, (at - Date.now()) / 1000);
};

const filenameOf = (disposition: string | null): string | null => {
  if (!disposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) return decodeURIComponent(encoded[1]!.trim());
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1]!.trim() : null;
};

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const codeOf = (body: unknown): string | undefined => {
  const error = (body as { error?: unknown } | undefined)?.error;
  return typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
};

export class Core {
  readonly baseUrl: string;
  /** "test" or "live", from the client id; null when there is no client id (webhook verification only). */
  readonly mode: Mode | null;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private token: Token | undefined;
  private refreshing: Promise<Token> | undefined;

  constructor(options: ClientOptions = {}) {
    this.clientId = options.clientId ?? env("REEDS_CLIENT_ID");
    this.clientSecret = options.clientSecret ?? env("REEDS_CLIENT_SECRET");
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.mode = modeOf(this.clientId);
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const fetchImpl = options.fetch ?? (typeof fetch === "function" ? fetch : undefined);
    if (!fetchImpl) throw new Error("reeds: no fetch available. Use Node.js 18 or later, or pass `fetch` in the options.");
    this.fetchImpl = fetchImpl;
    this.defaultHeaders = options.defaultHeaders ?? {};
    const testing = (options as { [TESTING]?: Testing })[TESTING];
    this.sleep = testing?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = testing?.random ?? Math.random;
  }

  // ------------------------------------------------------------ the token

  /** The scopes the access token carries: one per Reeds API the account may use. */
  async scopes(): Promise<string[]> {
    return (await this.getToken()).scopes;
  }

  private async getToken(): Promise<Token> {
    if (this.token && this.token.expiresAt - REFRESH_MARGIN > Date.now()) return this.token;
    // One refresh at a time: concurrent calls wait for the same one.
    this.refreshing ??= this.fetchToken().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async fetchToken(): Promise<Token> {
    if (!this.clientId || !this.clientSecret) {
      throw new AuthenticationError({
        code: "MISSING_CREDENTIALS",
        message: "Pass clientId and clientSecret, or set REEDS_CLIENT_ID and REEDS_CLIENT_SECRET. Find them in Dashboard → Developers.",
      });
    }
    const response = await this.request("POST", "/oauth/token", {
      auth: false,
      form: { grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret },
    });
    const body = (await readBody(response)) as { access_token?: string; expires_in?: number; scope?: string; livemode?: boolean } | undefined;
    if (!body?.access_token) {
      throw new ApiError({ status: response.status, code: "UNEXPECTED_RESPONSE", message: "The token endpoint answered without an access token.", requestId: response.headers.get("x-request-id") ?? undefined });
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      scopes: (body.scope ?? "").split(/\s+/).filter(Boolean),
      livemode: Boolean(body.livemode),
    };
    return this.token;
  }

  // ------------------------------------------------------------ calls the modules make

  get<T>(path: string, query?: Query, options?: RequestOptions): Promise<T> {
    return this.data<T>("GET", path, { query }, options);
  }

  post<T>(path: string, json?: unknown, options?: RequestOptions): Promise<T> {
    return this.data<T>("POST", path, { json }, options);
  }

  patch<T>(path: string, json: unknown, options?: RequestOptions): Promise<T> {
    return this.data<T>("PATCH", path, { json }, options);
  }

  list<T extends { id?: string | undefined }>(path: string, query: Query = {}, options?: RequestOptions): PagePromise<T> {
    const load = async (params: Query): Promise<Page<T>> => {
      const response = await this.request("GET", path, { query: params, options });
      const body = (await readBody(response)) as { data?: T[]; has_more?: boolean } | undefined;
      if (!body || !Array.isArray(body.data)) throw this.unexpected(response);
      return new Page<T>(body.data, Boolean(body.has_more), (startingAfter) => load({ ...params, starting_after: startingAfter }));
    };
    return new PagePromise(() => load(query));
  }

  async file(path: string, options?: RequestOptions): Promise<FileResponse> {
    const response = await this.request("GET", path, { accept: "application/pdf", options });
    return {
      filename: filenameOf(response.headers.get("content-disposition")),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      data: new Uint8Array(await response.arrayBuffer()),
    };
  }

  private async data<T>(method: string, path: string, init: { query?: Query; json?: unknown }, options?: RequestOptions): Promise<T> {
    const response = await this.request(method, path, { ...init, options });
    const body = (await readBody(response)) as { status?: string; data?: T } | undefined;
    if (!body || body.status !== "success" || !("data" in body)) throw this.unexpected(response);
    return body.data as T;
  }

  private unexpected(response: Response): ApiError {
    return new ApiError({
      status: response.status,
      code: "UNEXPECTED_RESPONSE",
      message: `Reeds answered ${response.status} with a body this version of the SDK doesn't recognise.`,
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
  }

  // ------------------------------------------------------------ one request, with retries

  private url(path: string, query?: Query): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    return url.toString();
  }

  /** Retried: no response, 429, 502, 503, 504, a 500 on a GET, and 409 REQUEST_IN_PROGRESS (the same key still running). */
  private retryable(method: string, status: number, code: string | undefined): boolean {
    if (status === 429 || status === 502 || status === 503 || status === 504) return true;
    if (status === 500) return method === "GET";
    return status === 409 && code === "REQUEST_IN_PROGRESS";
  }

  /** About 0.5 s, then 1 s, 2 s ..., at most 8 s, with jitter. */
  private backoff(attempt: number): number {
    return Math.min(8000, 500 * 2 ** attempt) * (1 - 0.25 * this.random());
  }

  private async request(
    method: string,
    path: string,
    init: Body & { query?: Query; accept?: string; auth?: boolean; options?: RequestOptions },
  ): Promise<Response> {
    const options = init.options ?? {};
    const auth = init.auth ?? true;
    const url = this.url(path, init.query);
    // Every POST to an API carries a key, so a retry can never create or charge twice.
    const idempotencyKey = auth ? (options.idempotencyKey ?? (method === "POST" ? randomUUID() : undefined)) : undefined;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    let refreshed = false;

    for (let attempt = 0; ; attempt += 1) {
      if (options.signal?.aborted) throw new ConnectionError({ code: "ABORTED", message: "The request was aborted.", cause: options.signal.reason });
      const token = auth ? await this.getToken() : undefined;
      const headers: Record<string, string> = { Accept: init.accept ?? "application/json", ...this.defaultHeaders };
      const agent = userAgent();
      if (agent) headers["User-Agent"] = agent;
      if (token) headers.Authorization = `Bearer ${token.value}`;
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      let body: string | undefined;
      if (init.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(init.form).toString();
      } else if (init.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(init.json);
      }
      Object.assign(headers, options.headers);

      let response: Response;
      try {
        response = await this.send(url, { method, headers, body }, options);
      } catch (error) {
        if (options.signal?.aborted) throw new ConnectionError({ code: "ABORTED", message: "The request was aborted.", cause: error });
        if (attempt < maxRetries) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        if (error instanceof Timeout) {
          throw new ConnectionTimeoutError({ code: "TIMEOUT", message: `No answer from Reeds within ${options.timeout ?? this.timeout} ms.`, cause: error });
        }
        throw new ConnectionError({ code: "CONNECTION_FAILED", message: `Couldn't reach Reeds: ${(error as Error)?.message ?? error}`, cause: error });
      }
      if (response.ok) return response;

      const errorBody = await readBody(response);
      const code = codeOf(errorBody);
      // The token expired or was revoked: one fresh token, one more try (not counted as a retry).
      if (auth && token && response.status === 401 && !refreshed && (code === "TOKEN_EXPIRED" || code === "UNAUTHENTICATED")) {
        if (this.token?.value === token.value) this.token = undefined;
        refreshed = true;
        attempt -= 1;
        continue;
      }
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      if (attempt < maxRetries && this.retryable(method, response.status, code) && (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_SECONDS)) {
        await this.sleep(retryAfter !== undefined ? retryAfter * 1000 : this.backoff(attempt));
        continue;
      }
      throw errorFromResponse(response.status, errorBody, response.headers, retryAfter);
    }
  }

  private async send(url: string, init: { method: string; headers: Record<string, string>; body?: string }, options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Timeout()), options.timeout ?? this.timeout);
    const onAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) controller.abort(options.signal.reason);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.reason instanceof Timeout) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}
