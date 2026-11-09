import { Reeds } from "../src/client";
import { TESTING, type ClientOptions } from "../src/core/client";

export type Call = { url: URL; method: string; headers: Record<string, string>; body: string | undefined };
type Handler = (call: Call) => Response | Error | Promise<Response | Error>;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "req_8h2KdP", ...headers } });

export const success = (data: unknown, status = 200) => json(status, { status: "success", data });

export const failure = (status: number, code: string, message = "Something's wrong.", extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json(status, { status: "failed", error: { code, message, doc_url: `https://developer.getreeds.co/errors/${code}`, ...extra } }, headers);

export const tokenResponse = (accessToken = "tok_1", extra: Record<string, unknown> = {}) =>
  json(200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, scope: "shipping", livemode: false, ...extra });

/**
 * A fake API: every request is recorded; the token endpoint answers a fresh
 * token unless `token` says otherwise; everything else goes to `handler`.
 */
export const fakeApi = (handler: Handler, token: () => Response | Error = () => tokenResponse()) => {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value])),
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const answer = call.url.pathname === "/oauth/token" ? token() : await handler(call);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const client = (options: ClientOptions = {}) =>
    new Reeds({
      clientId: "rci_test_abc",
      clientSecret: "rcs_test_xyz",
      fetch: fetchImpl as typeof fetch,
      ...options,
      [TESTING]: { sleep: async (ms: number) => void sleeps.push(ms), random: () => 0 },
    } as ClientOptions);
  /** The calls to the API itself, not the token endpoint. */
  const apiCalls = () => calls.filter((call) => call.url.pathname !== "/oauth/token");
  const tokenCalls = () => calls.filter((call) => call.url.pathname === "/oauth/token");
  return { calls, apiCalls, tokenCalls, sleeps, client, fetch: fetchImpl as typeof fetch };
};

export const delivery = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: "scheduled", reference: "ORDER-10045", ...extra });
