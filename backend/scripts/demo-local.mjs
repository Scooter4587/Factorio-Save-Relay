import assert from "node:assert/strict";

// Intentionally fixed to loopback: this demo creates disposable local identities.
const base = "http://127.0.0.1:8787";
async function api(path, method = "GET", body, token) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(`${method} ${path}: ${response.status} ${result.error?.code}`);
    error.status = response.status;
    throw error;
  }
  return result;
}
const adam = await api("/v1/devices/register", "POST", { displayName: "Demo Adam", deviceName: "Demo Adam PC" });
const friend = await api("/v1/devices/register", "POST", { displayName: "Demo Friend", deviceName: "Demo Friend PC" });
const { world } = await api("/v1/worlds", "POST", { name: "Demo Pyanodon" }, adam.token);
const { invite } = await api(`/v1/worlds/${world.id}/invites`, "POST", undefined, adam.token);
await api("/v1/invites/redeem", "POST", { code: invite.code }, friend.token);
for (const player of [adam, friend]) {
  const { worlds } = await api("/v1/worlds", "GET", undefined, player.token);
  assert.ok(worlds.some((item) => item.id === world.id));
}
console.log("PASS: Two local users share the same world through a one-time invitation.");
console.log(`World: ${world.id}; owner: Demo Adam; member: Demo Friend; revision: 0.`);
const lockPath = `/v1/worlds/${world.id}/lock`;
const { lease } = await api(`${lockPath}/acquire`, "POST", { expectedRevision: 0 }, adam.token);
try {
  await assert.rejects(api(`${lockPath}/acquire`, "POST", { expectedRevision: 0 }, friend.token), { status: 409 });
  await api(`${lockPath}/renew`, "POST", { lockToken: lease.token }, adam.token);
} finally {
  await api(`${lockPath}/release`, "POST", { lockToken: lease.token }, adam.token);
}
const { lease: friendLease } = await api(`${lockPath}/acquire`, "POST", { expectedRevision: 0 }, friend.token);
await api(`${lockPath}/release`, "POST", { lockToken: friendLease.token }, friend.token);
console.log("PASS: Adam hosts exclusively, renews and releases; Friend then takes over.");
console.log("No save files were transferred. Demo credentials are not printed or persisted by this script.");
