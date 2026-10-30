import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/now-playing.js";

const secrets = ["test-client", "test-secret", "test-refresh"];
const keys = ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"];
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const token = () => json({ access_token: "test-access", scope: "user-read-currently-playing" });

async function run(t, responses, { method = "GET", missing = false } = {}) {
  keys.forEach((key, i) => {
    const before = process.env[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
    if (missing) delete process.env[key]; else process.env[key] = secrets[i];
  });
  const calls = [];
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  t.mock.method(globalThis, "fetch", async (...args) => {
    calls.push(args);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "unexpected Spotify request");
    return next;
  });
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  await handler({ method }, res);
  for (const secret of [...secrets, "test-access", "UPSTREAM_SECRET"]) {
    assert.ok(!JSON.stringify({ body: res.body, logs }).includes(secret), "credential leaked");
  }
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(res.headers["Access-Control-Allow-Methods"], "GET, OPTIONS");
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type");
  assert.equal(res.headers["Cache-Control"], "no-store");
  return { res, calls };
}

test("successful contract and Spotify request protocol", async (t) => {
  const item = {
    name: "Song", artists: [{ name: "A" }, { name: "B" }],
    external_urls: { spotify: "https://open.spotify.com/track/123" },
    album: { name: "Album", images: [{ url: "https://image.test/cover" }] },
    duration_ms: 1234,
  };
  const { res, calls } = await run(t, [token(), json({ is_playing: true, item, progress_ms: 100 })]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    is_playing: true, title: "Song", artist: "A, B", url: item.external_urls.spotify,
    album: "Album", album_image: "https://image.test/cover", progress_ms: 100, duration_ms: 1234,
  });
  assert.equal(calls[0][0], "https://accounts.spotify.com/api/token");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers.Authorization, "Basic " + Buffer.from("test-client:test-secret").toString("base64"));
  assert.equal(calls[0][1].headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(calls[0][1].body.get("grant_type"), "refresh_token");
  assert.equal(calls[0][1].body.get("refresh_token"), "test-refresh");
  assert.equal(calls[1][0], "https://api.spotify.com/v1/me/player/currently-playing");
  assert.equal(calls[1][1].headers.Authorization, "Bearer test-access");
});

for (const status of [202, 204]) {
  test("empty playback " + status, async (t) => {
    const { res } = await run(t, [token(), new Response(null, { status })]);
    assert.deepEqual(res.body, { is_playing: false });
    assert.equal(res.statusCode, 200);
  });
}
test("null item", async (t) => {
  const { res } = await run(t, [token(), json({ item: null })]);
  assert.deepEqual(res.body, { is_playing: false });
});
test("paused item retains the existing contract", async (t) => {
  const { res } = await run(t, [token(), json({ is_playing: false, item: { name: "Paused", duration_ms: 5 }, progress_ms: 1 })]);
  assert.deepEqual(res.body, {
    is_playing: false, title: "Paused", artist: "", url: null, album: null,
    album_image: null, progress_ms: 1, duration_ms: 5,
  });
});
test("preflight and unsupported method make no Spotify calls", async (t) => {
  const { res, calls } = await run(t, [], { method: "OPTIONS", missing: true });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 0);
});
test("POST rejected", async (t) => {
  const { res, calls } = await run(t, [], { method: "POST" });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET, OPTIONS");
  assert.equal(calls.length, 0);
});
test("missing environment", async (t) => {
  const { res, calls } = await run(t, [], { missing: true });
  assert.equal(res.body.code, "SPOTIFY_CONFIG_MISSING");
  assert.equal(res.statusCode, 500);
  assert.equal(calls.length, 0);
});

const cases = [
  ["invalid grant", () => [json({ error: "invalid_grant", error_description: "UPSTREAM_SECRET" }, 400)], 502, "SPOTIFY_REAUTH_REQUIRED", "token"],
  ["invalid client", () => [json({ error: "invalid_client" }, 400)], 502, "SPOTIFY_INVALID_CLIENT", "token"],
  ["non-JSON token 401", () => [new Response("UPSTREAM_SECRET", { status: 401 })], 502, "SPOTIFY_INVALID_CLIENT", "token"],
  ["missing granted scope", () => [json({ access_token: "test-access", scope: "user-read-email" })], 403, "SPOTIFY_MISSING_SCOPE", "token"],
  ["missing scope from Spotify", () => [token(), json({ error: { message: "Insufficient client scope" } }, 403)], 403, "SPOTIFY_MISSING_SCOPE", "currently-playing"],
  ["scope in challenge", () => [token(), new Response(null, { status: 403, headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope"' } })], 403, "SPOTIFY_MISSING_SCOPE", "currently-playing"],
  ["generic forbidden", () => [token(), new Response("UPSTREAM_SECRET", { status: 403 })], 403, "SPOTIFY_ACCESS_DENIED", "currently-playing"],
  ["token forbidden", () => [json({}, 403)], 403, "SPOTIFY_ACCESS_DENIED", "token"],
  ["playback unauthorized", () => [token(), json({}, 401)], 502, "SPOTIFY_ACCESS_TOKEN_REJECTED", "currently-playing"],
  ["token upstream unavailable", () => [new Response("UPSTREAM_SECRET", { status: 503 })], 502, "SPOTIFY_UPSTREAM_ERROR", "token"],
  ["playback upstream unavailable", () => [token(), json({}, 500)], 502, "SPOTIFY_UPSTREAM_ERROR", "currently-playing"],
  ["no access token", () => [json({})], 502, "SPOTIFY_INVALID_RESPONSE", "token"],
  ["invalid playback JSON", () => [token(), new Response("bad")], 502, "SPOTIFY_INVALID_RESPONSE", "currently-playing"],
  ["network error", () => [new Error("UPSTREAM_SECRET")], 502, "SPOTIFY_NETWORK_ERROR", "token"],
  ["timeout", () => [new DOMException("UPSTREAM_SECRET", "TimeoutError")], 504, "SPOTIFY_TIMEOUT", "token"],
  ["playback timeout", () => [token(), new DOMException("UPSTREAM_SECRET", "TimeoutError")], 504, "SPOTIFY_TIMEOUT", "currently-playing"],
];
for (const [name, responses, status, code, stage] of cases) {
  test(name, async (t) => {
    const { res, calls } = await run(t, responses());
    assert.equal(res.statusCode, status);
    assert.equal(res.body.code, code);
    assert.equal(res.body.stage, stage);
    assert.ok(calls.length <= 2, "no automatic retries");
  });
}
for (const stage of ["token", "currently-playing"]) {
  test("429 with Retry-After at " + stage, async (t) => {
    const limited = json({ error: { message: "UPSTREAM_SECRET" } }, 429, { "Retry-After": "30" });
    const { res } = await run(t, stage === "token" ? [limited] : [token(), limited]);
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.code, "SPOTIFY_RATE_LIMITED");
    assert.equal(res.headers["Retry-After"], "30");
    assert.equal(res.headers["Access-Control-Expose-Headers"], "Retry-After");
  });
}
test("development quota differs from rate limiting", async (t) => {
  const { res } = await run(t, [token(), json({ error: { reason: "QUOTA_EXCEEDED" } }, 429)]);
  assert.equal(res.body.code, "SPOTIFY_QUOTA_EXCEEDED");
});
test("omitted scope retains original grant", async (t) => {
  const { res } = await run(t, [json({ access_token: "test-access" }), json({ item: null })]);
  assert.equal(res.statusCode, 200);
});
