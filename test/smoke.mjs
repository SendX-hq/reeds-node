// The BUILT package on the oldest supported Node (18), with no test framework:
// CI builds on a current Node, then runs `node test/smoke.mjs` on 18 and 20.
// A local HTTP server plays the API: token, a read, a write retried after a 503
// with the same Idempotency-Key, two pages, an error, a webhook signature.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Reeds, { NotFoundError, webhooks } from "../dist/index.js";

const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs");
assert.equal(typeof cjs.Reeds, "function", "CommonJS build exports Reeds");

const seen = [];
let busy = true;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, "http://localhost");
    seen.push({ method: req.method, path: url.pathname, search: url.search, key: req.headers["idempotency-key"], auth: req.headers.authorization });
    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", "x-request-id": "req_smoke", ...headers });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === "/oauth/token") return send(200, { access_token: "tok_smoke", token_type: "Bearer", expires_in: 3600, scope: "shipping", livemode: false });
    if (url.pathname === "/shipping/v1/coverage") return send(200, { status: "success", data: { states: [{ name: "Lagos" }] } });
    if (url.pathname === "/shipping/v1/deliveries" && req.method === "POST") {
      if (busy) {
        busy = false;
        return send(503, { status: "failed", error: { code: "SERVICE_UNAVAILABLE", message: "Busy.", doc_url: "https://developer.getreeds.co/errors/SERVICE_UNAVAILABLE" } }, { "retry-after": "0" });
      }
      return send(201, { status: "success", data: { id: "dlv_1", ...JSON.parse(body) } });
    }
    if (url.pathname === "/shipping/v1/deliveries") {
      const after = url.searchParams.get("starting_after");
      return send(200, { status: "success", data: after ? [{ id: "dlv_1" }] : [{ id: "dlv_3" }, { id: "dlv_2" }], has_more: !after });
    }
    return send(404, { status: "failed", error: { code: "NOT_FOUND", message: "No such delivery.", doc_url: "https://developer.getreeds.co/errors/NOT_FOUND" } });
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const reeds = new Reeds({ clientId: "rci_test_smoke", clientSecret: "rcs_test_smoke", baseUrl });
  assert.equal(reeds.mode, "test");

  const coverage = await reeds.shipping.coverage.get();
  assert.equal(coverage.states[0].name, "Lagos");

  const made = await reeds.shipping.deliveries.create({ quote_id: "qt_1", ready: true });
  assert.equal(made.id, "dlv_1");
  const posts = seen.filter((call) => call.method === "POST" && call.path === "/shipping/v1/deliveries");
  assert.equal(posts.length, 2, "the 503 was retried");
  assert.ok(posts[0].key && posts[0].key === posts[1].key, "the retry reused the Idempotency-Key");

  const ids = [];
  for await (const delivery of reeds.shipping.deliveries.list({ limit: 2 })) ids.push(delivery.id);
  assert.deepEqual(ids, ["dlv_3", "dlv_2", "dlv_1"]);

  const error = await reeds.shipping.deliveries.get("dlv_x").catch((e) => e);
  assert.ok(error instanceof NotFoundError);
  assert.equal(error.code, "NOT_FOUND");
  assert.equal(error.requestId, "req_smoke");

  assert.equal(seen.filter((call) => call.path === "/oauth/token").length, 1, "one token for every call");
  assert.ok(seen.filter((call) => call.path !== "/oauth/token").every((call) => call.auth === "Bearer tok_smoke"));

  const vectors = JSON.parse(readFileSync(new URL("./fixtures/webhook-vectors.json", import.meta.url), "utf8"));
  for (const vector of vectors.cases) {
    let outcome = "valid";
    try {
      webhooks.verifySignature(vector.payload, vector.header, vector.secrets, { now: vector.now, tolerance: vectors.tolerance });
    } catch (e) {
      outcome = e.code;
    }
    assert.equal(outcome, vector.valid ? "valid" : vector.error, vector.name);
  }

  console.log(`smoke ok on Node ${process.version}`);
} finally {
  server.close();
}
