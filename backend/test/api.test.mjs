import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Wrangler's pinned Miniflare 5 build provides an adapter for the documented
// Miniflare 4 test options used here.
const runtime = (options) => new Miniflare(convertV4MiniflareOptions(options));

let mf;
let db;
let script;
before(async () => {
  const result = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "neutral", target: "es2023" });
  script = result.outputFiles[0].text;
  mf = runtime({ modules: true, script, compatibilityDate: "2026-09-25", d1Databases: ["DB"], bindings: { ALLOW_REGISTRATION: "true" } });
  db = await mf.getD1Database("DB");
  const migration = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
});
after(async () => { await mf?.dispose(); });

async function api(path, { method = "GET", token, body, raw, headers = {} } = {}, runtime = mf) {
  const response = await runtime.dispatchFetch(`http://localhost${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : raw,
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function register(name = "Player") {
  const response = await api("/v1/devices/register", { method: "POST", body: { displayName: name, deviceName: `${name}-PC` } });
  assert.equal(response.status, 201);
  return response.body;
}
async function world(owner, name = "Pyanodon") {
  const response = await api("/v1/worlds", { method: "POST", token: owner.token, body: { name } });
  assert.equal(response.status, 201);
  return response.body.world;
}
async function invite(owner, worldId) {
  const response = await api(`/v1/worlds/${worldId}/invites`, { method: "POST", token: owner.token });
  assert.equal(response.status, 201);
  return response.body.invite;
}
const redeem = (player, code) => api("/v1/invites/redeem", { method: "POST", token: player.token, body: { code } });

test("health/version remain public; unknown routes return JSON 404", async () => {
  assert.equal((await api("/health")).body.status, "ok");
  assert.equal((await api("/v1/version")).status, 200);
  assert.equal((await api("/missing")).status, 404);
});

test("registration returns distinct identities, stores only a hash, and authenticates", async () => {
  const first = await register("Adam");
  const second = await register("Adam");
  assert.notEqual(first.user.id, second.user.id);
  assert.notEqual(first.token, second.token);
  const row = await db.prepare("SELECT token_hash, last_seen_at FROM devices WHERE id = ?").bind(first.device.id).first();
  assert.match(row.token_hash, /^[a-f0-9]{64}$/);
  assert.ok(!first.token.includes(row.token_hash));
  const me = await api("/v1/me", { token: first.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.identity.userId, first.user.id);
  assert.equal(me.body.identity.deviceId, first.device.id);
  assert.ok(!JSON.stringify(me.body).includes("token"));
  assert.ok((await db.prepare("SELECT last_seen_at FROM devices WHERE id = ?").bind(first.device.id).first()).last_seen_at);
});

test("missing, malformed, forged and revoked tokens are rejected", async () => {
  const player = await register();
  for (const token of [undefined, "bad", `${player.token.slice(0, -1)}${player.token.endsWith("0") ? "1" : "0"}`]) {
    const response = await api("/v1/worlds", { token });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  }
  await db.prepare("UPDATE devices SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").bind(player.device.id).run();
  assert.equal((await api("/v1/me", { token: player.token })).status, 401);
});

test("two users share a world through a single-use invite, but not other worlds", async () => {
  const adam = await register("Adam");
  const friend = await register("Friend");
  const shared = await world(adam);
  const privateWorld = await world(adam, "Private");
  assert.equal(shared.role, "owner");
  assert.equal(shared.currentRevision, 0);
  assert.deepEqual((await api("/v1/worlds", { token: friend.token })).body.worlds, []);
  const invitation = await invite(adam, shared.id);
  assert.ok(Date.parse(invitation.expiresAt) > Date.now() + 23 * 60 * 60 * 1000);
  const joined = await redeem(friend, invitation.code);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.world.role, "member");
  assert.equal(joined.body.world.ownerUserId, adam.user.id);
  const worlds = (await api("/v1/worlds", { token: friend.token })).body.worlds;
  assert.deepEqual(worlds.map((item) => item.id), [shared.id]);
  assert.equal((await api(`/v1/worlds/${shared.id}`, { token: friend.token })).status, 200);
  assert.equal((await api(`/v1/worlds/${privateWorld.id}`, { token: friend.token })).status, 404);
  assert.equal((await redeem(friend, invitation.code)).status, 409);
});

test("outsiders cannot read a world or invite themselves; members cannot invite", async () => {
  const owner = await register();
  const outsider = await register();
  const shared = await world(owner);
  assert.equal((await api(`/v1/worlds/${shared.id}`, { token: outsider.token })).status, 404);
  assert.equal((await api(`/v1/worlds/${shared.id}/invites`, { method: "POST", token: outsider.token })).status, 404);
  await redeem(outsider, (await invite(owner, shared.id)).code);
  assert.equal((await api(`/v1/worlds/${shared.id}/invites`, { method: "POST", token: outsider.token })).status, 403);
});

test("request body cannot spoof owner identity or membership role", async () => {
  const owner = await register();
  const other = await register();
  const created = await api("/v1/worlds", { method: "POST", token: owner.token, body: { name: "World", ownerUserId: other.user.id, userId: other.user.id } });
  assert.equal(created.body.world.ownerUserId, owner.user.id);
  const invitation = await invite(owner, created.body.world.id);
  const joined = await api("/v1/invites/redeem", { method: "POST", token: other.token, body: { code: invitation.code, role: "owner", userId: owner.user.id } });
  assert.equal(joined.body.world.role, "member");
});

test("expired and unknown invites grant no membership", async () => {
  const owner = await register();
  const player = await register();
  const shared = await world(owner);
  const invitation = await invite(owner, shared.id);
  await db.prepare("UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(invitation.id).run();
  assert.equal((await redeem(player, invitation.code)).status, 409);
  assert.equal((await redeem(player, `fsr_invite.${crypto.randomUUID()}.${"a".repeat(64)}`)).status, 409);
  assert.equal((await redeem(player, "invalid")).status, 400);
  assert.deepEqual((await api("/v1/worlds", { token: player.token })).body.worlds, []);
});

test("existing member does not consume an invitation or downgrade owner role", async () => {
  const owner = await register();
  const player = await register();
  const shared = await world(owner);
  const invitation = await invite(owner, shared.id);
  assert.equal((await redeem(owner, invitation.code)).status, 409);
  assert.equal((await api(`/v1/worlds/${shared.id}`, { token: owner.token })).body.world.role, "owner");
  assert.equal((await redeem(player, invitation.code)).status, 200);
});

test("simultaneous redemption by different users has exactly one winner", async () => {
  const owner = await register();
  const a = await register();
  const b = await register();
  const shared = await world(owner);
  const invitation = await invite(owner, shared.id);
  const results = await Promise.all([redeem(a, invitation.code), redeem(b, invitation.code)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const members = await db.prepare("SELECT user_id FROM world_members WHERE world_id = ? AND role = 'member'").bind(shared.id).all();
  assert.equal(members.results.length, 1);
  assert.equal(members.results[0].user_id, results[0].status === 200 ? a.user.id : b.user.id);
});

test("simultaneous duplicate redemption by the same user succeeds only once", async () => {
  const owner = await register();
  const player = await register();
  const invitation = await invite(owner, (await world(owner)).id);
  const results = await Promise.all([redeem(player, invitation.code), redeem(player, invitation.code)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test("a used invitation cannot restore a removed membership", async () => {
  const owner = await register();
  const player = await register();
  const shared = await world(owner);
  const invitation = await invite(owner, shared.id);
  assert.equal((await redeem(player, invitation.code)).status, 200);
  await db.prepare("DELETE FROM world_members WHERE world_id = ? AND user_id = ?").bind(shared.id, player.user.id).run();
  assert.equal((await redeem(player, invitation.code)).status, 409);
  assert.equal((await api(`/v1/worlds/${shared.id}`, { token: player.token })).status, 404);
});

test("failed membership insert rolls back invitation consumption and hides DB details", async () => {
  const owner = await register();
  const player = await register();
  const shared = await world(owner);
  const invitation = await invite(owner, shared.id);
  await db.prepare("CREATE TRIGGER test_fail_member BEFORE INSERT ON world_members WHEN NEW.role = 'member' BEGIN SELECT RAISE(ABORT, 'private database details'); END").run();
  try {
    const failed = await redeem(player, invitation.code);
    assert.equal(failed.status, 500);
    assert.ok(!JSON.stringify(failed.body).includes("private database details"));
    const row = await db.prepare("SELECT redeemed_at, redeemed_by_user_id FROM invites WHERE id = ?").bind(invitation.id).first();
    assert.equal(row.redeemed_at, null);
    assert.equal(row.redeemed_by_user_id, null);
  } finally {
    await db.prepare("DROP TRIGGER test_fail_member").run();
  }
  assert.equal((await redeem(player, invitation.code)).status, 200);
});

test("failed device insert rolls back the new user", async () => {
  const count = async () => (await db.prepare("SELECT COUNT(*) AS count FROM users").first()).count;
  const beforeCount = await count();
  await db.prepare("CREATE TRIGGER test_fail_device BEFORE INSERT ON devices BEGIN SELECT RAISE(ABORT, 'injected failure'); END").run();
  try {
    assert.equal((await api("/v1/devices/register", { method: "POST", body: { displayName: "Rollback", deviceName: "PC" } })).status, 500);
    assert.equal(await count(), beforeCount);
  } finally {
    await db.prepare("DROP TRIGGER test_fail_device").run();
  }
});

test("failed owner membership insert rolls back the new world", async () => {
  const owner = await register();
  await db.prepare("CREATE TRIGGER test_fail_owner BEFORE INSERT ON world_members WHEN NEW.role = 'owner' BEGIN SELECT RAISE(ABORT, 'injected failure'); END").run();
  try {
    assert.equal((await api("/v1/worlds", { method: "POST", token: owner.token, body: { name: "Rollback" } })).status, 500);
    assert.deepEqual((await api("/v1/worlds", { token: owner.token })).body.worlds, []);
  } finally {
    await db.prepare("DROP TRIGGER test_fail_owner").run();
  }
});

test("JSON and name validation reject malformed or oversized requests", async () => {
  for (const body of [null, [], {}, { displayName: " ", deviceName: "PC" }, { displayName: 7, deviceName: "PC" }, { displayName: "x".repeat(81), deviceName: "PC" }, { displayName: "Adam\nAdmin", deviceName: "PC" }]) {
    assert.equal((await api("/v1/devices/register", { method: "POST", body })).status, 400);
  }
  assert.equal((await api("/v1/devices/register", { method: "POST", raw: "{", headers: { "content-type": "application/json" } })).status, 400);
  assert.equal((await api("/v1/devices/register", { method: "POST", raw: "{}" })).status, 415);
  assert.equal((await api("/v1/devices/register", { method: "POST", body: { displayName: "x".repeat(5000), deviceName: "PC" } })).status, 413);
  const owner = await register();
  assert.equal((await api("/v1/worlds", { method: "POST", token: owner.token, body: { name: " " } })).status, 400);
  const name = "Pyanodon'); DROP TABLE users; --";
  assert.equal((await world(owner, name)).name, name);
  assert.equal((await api("/v1/me", { token: owner.token })).status, 200);
});

test("tokens and invitation secrets never appear in world responses or raw DB fields", async () => {
  const owner = await register();
  const shared = await world(owner);
  const invitation = await invite(owner, shared.id);
  const stored = await db.prepare("SELECT * FROM invites WHERE id = ?").bind(invitation.id).first();
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(stored).includes(invitation.code));
  const listed = JSON.stringify((await api("/v1/worlds", { token: owner.token })).body);
  assert.ok(!listed.includes("token_hash") && !listed.includes(owner.token) && !listed.includes(invitation.code));
});

test("registration is off by default and missing DB returns a controlled 503", async () => {
  const closed = runtime({ modules: true, script, compatibilityDate: "2026-09-25", d1Databases: ["DB"] });
  const unconfigured = runtime({ modules: true, script, compatibilityDate: "2026-09-25" });
  try {
    assert.equal((await api("/v1/devices/register", { method: "POST", body: { displayName: "A", deviceName: "PC" } }, closed)).body.error.code, "registration_disabled");
    assert.equal((await api("/v1/worlds", {}, unconfigured)).status, 503);
    assert.equal((await api("/health", {}, unconfigured)).status, 200);
  } finally {
    await Promise.all([closed.dispose(), unconfigured.dispose()]);
  }
});
