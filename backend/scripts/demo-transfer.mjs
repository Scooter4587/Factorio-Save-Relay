import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { testZip } from "../test/zip-fixture.mjs";

// This demo only creates synthetic ZIPs under a new ignored artifacts directory.
// It deliberately does not accept a real Factorio save path or remote API URL.
const baseUrl = "http://127.0.0.1:8787";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function api(path, player, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${baseUrl}${path}`, { method,
    headers: { ...(player ? { authorization: `Bearer ${player.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${value.error?.code}`);
  return value;
}
async function upload(worldPath, player, lease, source, baseRevision) {
  const bytes = await readFile(source);
  const { upload } = await api(`${worldPath}/uploads/begin`, player, {
    baseRevision, lockToken: lease.token, sha256: hash(bytes), fileSize: bytes.length,
  });
  const response = await fetch(`${baseUrl}${upload.contentPath}`, { method: "PUT", headers: {
    authorization: `Bearer ${player.token}`, "x-relay-lock": lease.token,
    "content-type": "application/zip", "content-length": String(bytes.length),
  }, body: bytes });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  const { revision } = await api(`${worldPath}/uploads/finalize`, player, { uploadId: upload.id, lockToken: lease.token });
  return revision;
}
async function receive(worldPath, player, directory, expectedBytes, expectedRevision) {
  const response = await fetch(`${baseUrl}${worldPath}/download`, { headers: { authorization: `Bearer ${player.token}` } });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const temporary = join(directory, `received-${expectedRevision}.zip.download`);
  await writeFile(temporary, bytes, { flag: "wx" });
  const saved = await readFile(temporary);
  assert.equal(saved.length, Number(response.headers.get("content-length")));
  assert.equal(hash(saved), response.headers.get("x-save-sha256"));
  assert.equal(Number(response.headers.get("x-save-revision")), expectedRevision);
  // Exact fixture equality also proves the downloaded test ZIP is unchanged.
  assert.deepEqual(saved, expectedBytes);
  await rename(temporary, join(directory, `received-${expectedRevision}.zip`));
}

await mkdir(resolve("artifacts"), { recursive: true });
const root = await mkdtemp(join(resolve("artifacts"), "transfer-demo-"));
const aDir = join(root, "adam"), bDir = join(root, "friend");
await Promise.all([mkdir(aDir), mkdir(bDir)]);
const a = await api("/v1/devices/register", null, { displayName: "Demo Adam", deviceName: "Demo A" });
const b = await api("/v1/devices/register", null, { displayName: "Demo Friend", deviceName: "Demo B" });
const { world } = await api("/v1/worlds", a, { name: "Synthetic ZIP relay demo" });
const worldPath = `/v1/worlds/${world.id}`;
const { invite } = await api(`${worldPath}/invites`, a, undefined, "POST");
await api("/v1/invites/redeem", b, { code: invite.code });

const first = testZip("Adam synthetic revision 1");
const firstPath = join(aDir, "source-1.zip");
await writeFile(firstPath, first, { flag: "wx" });
const { lease: aLease } = await api(`${worldPath}/lock/acquire`, a, { expectedRevision: 0 });
let firstRevision;
try {
  firstRevision = await upload(worldPath, a, aLease, firstPath, 0);
} finally { await api(`${worldPath}/lock/release`, a, { lockToken: aLease.token }); }
await receive(worldPath, b, bDir, first, firstRevision.revision);
console.log("PASS: Adam uploaded; Friend downloaded identical bytes and verified SHA-256.");

const second = testZip("Friend synthetic revision 2");
const secondPath = join(bDir, "source-2.zip");
await writeFile(secondPath, second, { flag: "wx" });
const { lease: bLease } = await api(`${worldPath}/lock/acquire`, b, { expectedRevision: firstRevision.revision });
let secondRevision;
try {
  secondRevision = await upload(worldPath, b, bLease, secondPath, firstRevision.revision);
} finally { await api(`${worldPath}/lock/release`, b, { lockToken: bLease.token }); }
await receive(worldPath, a, aDir, second, secondRevision.revision);
console.log("PASS: Friend uploaded a new revision; Adam downloaded and verified it.");
console.log(`Synthetic test files: ${root}`);
console.log("Real Factorio saves were not accessed. These synthetic ZIPs are not playable worlds.");
