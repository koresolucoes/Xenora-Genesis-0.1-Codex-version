// This worker is the only outbound service the test application can reach.
const calls = [];
let stored;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    calls.push(url.hostname + url.pathname);
    check(request.method === "POST", "The RPC must use POST");
    check(request.headers.get("apikey") === "test-publishable", "Missing gateway API key");
    check(request.headers.get("x-xenora-gateway") === "a".repeat(64), "Missing gateway token");
    const params = await request.json();
    if (url.pathname.endsWith("/xenora_gateway_create_checkpoint")) {
      if (params.p_checkpoint.redirect) return Response.redirect("https://other.invalid/redirected", 307);
      stored = params;
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/xenora_gateway_read_checkpoint") &&
        params.p_id === stored?.p_id && params.p_hash === stored?.p_hash) {
      return Response.json(stored.p_checkpoint);
    }
    return new Response(null, { status: 404 });
  },

  async test(controller, env) {
    const collection = "https://lab.invalid/api/checkpoints";
    const post = checkpoint => env.APP.fetch(collection, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint })
    });
    const saved = await post({ version: 2, label: "Lagoa de água" });
    check(saved.status === 201, "A valid checkpoint must return 201, got " + saved.status);
    const { id, token } = await saved.json();
    const reopened = await env.APP.fetch(collection + "/" + id, { headers: { Authorization: "Bearer " + token } });
    check(reopened.status === 200, "A valid checkpoint key must reopen the object");
    const { checkpoint } = await reopened.json();
    check(checkpoint.label === "Lagoa de água" && checkpoint.version === 2, "Checkpoint changed in transit");
    const redirect = await post({ redirect: true });
    check(redirect.status === 503, "An upstream redirect must be rejected");
    check(calls.join("|") === ["rpc.invalid/rest/v1/rpc/xenora_gateway_create_checkpoint",
      "rpc.invalid/rest/v1/rpc/xenora_gateway_read_checkpoint",
      "rpc.invalid/rest/v1/rpc/xenora_gateway_create_checkpoint"].join("|"),
    "The worker must only contact the configured RPC, exactly once per operation");
  }
};
