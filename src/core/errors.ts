/**
 * Every failure is a ReedsError. Branch on `status` and `code`, never on
 * `message`, which Reeds can reword. The subclass says what kind of failure it
 * is, so `instanceof RateLimitError` and `error.code === "RATE_LIMITED"` agree.
 */

export type ErrorField = { field: string; message: string };

export type ReedsErrorInit = {
  status?: number;
  code: string;
  message: string;
  fields?: ErrorField[];
  docUrl?: string;
  requestId?: string;
  retryAfter?: number;
  /** The `error` object as the API sent it, with any fields beyond the common ones (`delivery_id`, `hold_reason`). */
  raw?: Record<string, unknown>;
  headers?: Headers;
  cause?: unknown;
};

export class ReedsError extends Error {
  /** The HTTP status, or undefined when no response came (or the SDK refused before sending). */
  readonly status: number | undefined;
  /** The API's stable code, such as `INSUFFICIENT_BALANCE`, or the OAuth error (`invalid_client`). */
  readonly code: string;
  /** Each invalid field, on `422 INVALID_REQUEST`. */
  readonly fields: ErrorField[];
  /** The code's page on the developer hub. */
  readonly docUrl: string | undefined;
  /** The `X-Request-Id` of the call. Quote it to Reeds support. */
  readonly requestId: string | undefined;
  /** The API's `error` object as sent, including fields only some codes carry. */
  readonly raw: Record<string, unknown> | undefined;
  readonly headers: Headers | undefined;

  constructor(init: ReedsErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.fields = init.fields ?? [];
    this.docUrl = init.docUrl;
    this.requestId = init.requestId;
    this.raw = init.raw;
    this.headers = init.headers;
  }
}

/** 401, or the token endpoint refusing the credentials. */
export class AuthenticationError extends ReedsError {}
/** 403: the credentials can't do this (a missing scope, an IP not allowed, a sandbox call with live credentials). */
export class PermissionDeniedError extends ReedsError {}
/** 404. */
export class NotFoundError extends ReedsError {}
/** 409: the object's state doesn't allow it (already booked, cancelled, a quote already used). */
export class ConflictError extends ReedsError {}
/** 400 or 422: the request itself is wrong. `fields` lists each invalid field. */
export class InvalidRequestError extends ReedsError {}
/** 402: the wallet or credit doesn't cover it (`INSUFFICIENT_BALANCE`, `CREDIT_LIMIT_REACHED`). */
export class PaymentRequiredError extends ReedsError {}

/** 429. `retryAfter` is the seconds Reeds asked you to wait. */
export class RateLimitError extends ReedsError {
  readonly retryAfter: number | undefined;
  constructor(init: ReedsErrorInit) {
    super(init);
    this.retryAfter = init.retryAfter;
  }
}

/** 503: Reeds is shedding load and did nothing. `retryAfter` is the seconds to wait. */
export class ServiceUnavailableError extends ReedsError {
  readonly retryAfter: number | undefined;
  constructor(init: ReedsErrorInit) {
    super(init);
    this.retryAfter = init.retryAfter;
  }
}

/** Any other failure status (5xx). */
export class ApiError extends ReedsError {}
/** No response: the network failed, or the request was aborted. */
export class ConnectionError extends ReedsError {}
/** No response within the timeout. */
export class ConnectionTimeoutError extends ConnectionError {}
/** A webhook whose signature or timestamp doesn't check out. Reply 400 and don't trust it. */
export class WebhookSignatureError extends ReedsError {}

const BY_STATUS: Record<number, new (init: ReedsErrorInit) => ReedsError> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  402: PaymentRequiredError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  422: InvalidRequestError,
  429: RateLimitError,
  503: ServiceUnavailableError,
};

export const errorClassFor = (status: number) => BY_STATUS[status] ?? ApiError;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Builds the error for a failed response from its body (the failure envelope, an OAuth error, or anything else). */
export const errorFromResponse = (status: number, body: unknown, headers: Headers, retryAfter?: number): ReedsError => {
  const requestId = headers.get("x-request-id") ?? undefined;
  const ErrorClass = errorClassFor(status);
  // The API's failure envelope: { status: "failed", error: { code, message, doc_url, fields? } }.
  if (isRecord(body) && isRecord(body.error)) {
    const error = body.error;
    return new ErrorClass({
      status,
      code: typeof error.code === "string" ? error.code : `HTTP_${status}`,
      message: typeof error.message === "string" ? error.message : `Reeds answered ${status}.`,
      fields: Array.isArray(error.fields) ? (error.fields as ErrorField[]) : [],
      docUrl: typeof error.doc_url === "string" ? error.doc_url : undefined,
      requestId,
      retryAfter,
      raw: error,
      headers,
    });
  }
  // The token endpoint's OAuth errors: { error: "invalid_client", error_description }.
  if (isRecord(body) && typeof body.error === "string") {
    return new ErrorClass({
      status,
      code: body.error,
      message: typeof body.error_description === "string" ? body.error_description : body.error,
      requestId,
      retryAfter,
      raw: body,
      headers,
    });
  }
  // Not JSON (a proxy's HTML page, say).
  return new ErrorClass({ status, code: `HTTP_${status}`, message: `Reeds answered ${status} without an error body.`, requestId, retryAfter, headers });
};
