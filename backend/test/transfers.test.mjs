import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { testZip } from "./zip-fixture.mjs";

let mf, db, bucket;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
before(async () => {
  const built = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "neutral", target: "es2023" });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text,
    compatibilityDate: "2026-09-25", d1Databases: ["DB"], r2Buckets: ["SAVES"],
    bindings: { ALLOW_REGISTRATION: "true", ALLOW_LOCAL_TRANSFERS: "true" } }));
  db = await mf.getD1Database("DB");
  bucket = await mf.getR2Bucket("SAVES");
  for (const file of (await readdir(new URL("../migrations/", import.meta.url))).filter(f => f.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
});
after(async () => { await mf?.dispose(); });

async function api(path, player, body, method = body === undefined ? "GET" : "POST") {
  const response = await mf.dispatchFetch(`http://localhost${path}`, { method,
    headers: { ...(player ? { authorization: `Bearer ${player.token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function player(name) {
  const r = await api("/v1/devices/register", null, { displayName: name, deviceName: name });
  assert.equal(r.status, 201); return r.body;
}
async function setup() {
  const a = await player("Adam"), b = await player("Friend");
  const world = (await api("/v1/worlds", a, { name: "Transfer test" })).body.world;
  const code = (await api(`/v1/worlds/${world.id}/invites`, a, undefined, "POST")).body.invite.code;
  assert.equal((await api("/v1/invites/redeem", b, { code })).status, 200);
  const base = `/v1/worlds/${world.id}`;
  const lease = (await api(`${base}/lock/acquire`, a, { expectedRevision: 0 })).body.lease;
  return { a, b, world, base, lease };
}
async function begin(ctx, bytes = testZip(), baseRevision = 0, player = ctx.a, lease = ctx.lease) {
  const response = await api(`${ctx.base}/uploads/begin`, player, { baseRevision, lockToken: lease.token, fileSize: bytes.length, sha256: sha(bytes) });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.upload;
}
async function put(ctx, upload, bytes = testZip(), player = ctx.a, lease = ctx.lease) {
  const response = await mf.dispatchFetch(`http://localhost${upload.contentPath}`, { method: "PUT", headers: {
    authorization: `Bearer ${player.token}`, "x-relay-lock": lease.token,
    "content-type": "application/zip", "content-length": String(bytes.length),
  }, body: bytes });
  return { status: response.status, body: await response.json() };
}
const finish = (ctx, upload, player = ctx.a, lease = ctx.lease) => api(`${ctx.base}/uploads/finalize`, player, { uploadId: upload.id, lockToken: lease.token });
async function download(ctx, player = ctx.b, suffix = "/download") {
  const response = await mf.dispatchFetch(`http://localhost${ctx.base}${suffix}`, { headers: { authorization: `Bearer ${player.token}` } });
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
}
const current = async ctx => (await api(ctx.base, ctx.a)).body.world.currentRevision;

test("two hosts upload and download successive byte-identical ZIP revisions", async () => {
  const ctx = await setup();
  assert.equal((await download(ctx)).status, 404);
  const first = testZip("Adam revision one");
  const upload = await begin(ctx, first);
  assert.equal(await current(ctx), 0);
  assert.equal((await put(ctx, upload, first)).status, 200);
  assert.equal(await current(ctx), 0);
  assert.equal((await finish(ctx, upload)).status, 200);
  let received = await download(ctx);
  assert.equal(received.status, 200);
  assert.deepEqual(received.bytes, first);
  assert.equal(received.headers.get("x-save-sha256"), sha(first));
  assert.equal(received.headers.get("x-save-revision"), String(upload.revision));
  assert.equal(received.headers.get("cache-control"), "no-store");
  await api(`${ctx.base}/lock/release`, ctx.a, { lockToken: ctx.lease.token });
  const lease = (await api(`${ctx.base}/lock/acquire`, ctx.b, { expectedRevision: upload.revision })).body.lease;
  const second = testZip("Friend revision two");
  const next = await begin(ctx, second, upload.revision, ctx.b, lease);
  assert.equal((await put(ctx, next, second, ctx.b, lease)).status, 200);
  assert.equal((await finish(ctx, next, ctx.b, lease)).status, 200);
  received = await download(ctx, ctx.a);
  assert.deepEqual(received.bytes, second);
  assert.deepEqual((await download(ctx, ctx.b, `/revisions/${upload.revision}/download`)).bytes, first);
  const history = (await api(`${ctx.base}/revisions`, ctx.b)).body.revisions;
  assert.deepEqual(history.map(r => r.status), ["current", "archived"]);
  assert.equal((await finish(ctx, upload)).status, 200);
  assert.equal(await current(ctx), next.revision);
  assert.ok(!JSON.stringify(history).includes("object_key") && !JSON.stringify(history).includes("lease_hash"));
});

test("missing or rejected content never advances the world", async () => {
  const ctx = await setup();
  const bytes = testZip();
  const upload = await begin(ctx, bytes);
  assert.equal((await finish(ctx, upload)).status, 409);
  const corrupt = Buffer.from(bytes); corrupt[35] ^= 1;
  assert.equal((await put(ctx, upload, corrupt)).status, 422);
  assert.equal(await current(ctx), 0);
  assert.equal((await download(ctx)).status, 404);
  assert.equal((await put(ctx, upload, bytes)).status, 200);
  assert.equal((await finish(ctx, upload)).status, 200);
});

test("retrying PUT/finalize is safe and finalized content cannot be overwritten", async () => {
  const ctx = await setup();
  const upload = await begin(ctx);
  assert.equal((await put(ctx, upload)).status, 200);
  assert.equal((await put(ctx, upload)).status, 200);
  const results = await Promise.all([finish(ctx, upload), finish(ctx, upload)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal((await finish(ctx, upload)).status, 200);
  assert.equal((await put(ctx, upload)).status, 409);
  assert.equal(await current(ctx), upload.revision);
});

test("concurrent candidates reserve distinct numbers; only one can publish", async () => {
  const ctx = await setup();
  const uploads = await Promise.all([begin(ctx), begin(ctx)]);
  assert.notEqual(uploads[0].revision, uploads[1].revision);
  await Promise.all(uploads.map(u => put(ctx, u)));
  const results = await Promise.all(uploads.map(u => finish(ctx, u)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const history = (await api(`${ctx.base}/revisions`, ctx.a)).body.revisions;
  assert.equal(history.filter(r => r.status === "current").length, 1);
  const conflict = history.find(r => r.status === "conflict");
  assert.deepEqual((await download(ctx, ctx.a, `/revisions/${conflict.revision}/download`)).bytes, testZip());
});

test("an expired lease preserves uploaded bytes as a conflict without publication", async () => {
  const ctx = await setup();
  const upload = await begin(ctx); await put(ctx, upload);
  await db.prepare("UPDATE worlds SET lock_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(ctx.world.id).run();
  assert.equal((await finish(ctx, upload)).body.error.code, "upload_conflict");
  assert.equal(await current(ctx), 0);
  assert.deepEqual((await download(ctx, ctx.b, `/revisions/${upload.revision}/download`)).bytes, testZip());
});

test("old upload cannot use a newly acquired lease on the same device", async () => {
  const ctx = await setup();
  const upload = await begin(ctx); await put(ctx, upload);
  await api(`${ctx.base}/lock/release`, ctx.a, { lockToken: ctx.lease.token });
  const lease = (await api(`${ctx.base}/lock/acquire`, ctx.a, { expectedRevision: 0 })).body.lease;
  assert.equal((await finish(ctx, upload, ctx.a, lease)).body.error.code, "lease_lost");
  assert.equal((await finish(ctx, upload)).body.error.code, "upload_conflict");
  assert.equal(await current(ctx), 0);
});

test("non-hosts and outsiders cannot upload, finalize or read private saves", async () => {
  const ctx = await setup();
  const outsider = await player("Outsider");
  const upload = await begin(ctx);
  assert.equal((await put(ctx, upload, testZip(), ctx.b)).status, 404);
  assert.equal((await finish(ctx, upload, ctx.b)).status, 404);
  assert.equal((await api(`${ctx.base}/uploads/begin`, ctx.b, { baseRevision: 0, lockToken: ctx.lease.token, sha256: sha(testZip()), fileSize: testZip().length })).status, 409);
  await put(ctx, upload); await finish(ctx, upload);
  assert.equal((await download(ctx, outsider)).status, 404);
  assert.equal((await api(`${ctx.base}/revisions`, outsider)).status, 404);
});

test("non-ZIP and truncated archives with matching hashes cannot finalize", async () => {
  const ctx = await setup();
  for (const bytes of [Buffer.alloc(64, 65), testZip().subarray(0, -3)]) {
    const upload = await begin(ctx, bytes);
    assert.equal((await put(ctx, upload, bytes)).status, 200);
    assert.equal((await finish(ctx, upload)).body.error.code, "invalid_zip");
    assert.equal(await current(ctx), 0);
  }
});

test("world update failure rolls back archival and promotion together", async () => {
  const ctx = await setup();
  const first = await begin(ctx); await put(ctx, first); await finish(ctx, first);
  const second = await begin(ctx, testZip(), first.revision); await put(ctx, second);
  await db.prepare("CREATE TRIGGER test_fail_promotion BEFORE UPDATE OF current_revision ON worlds BEGIN SELECT RAISE(ABORT, 'injected failure'); END").run();
  try {
    assert.equal((await finish(ctx, second)).status, 500);
    assert.equal(await current(ctx), first.revision);
    const rows = await db.prepare("SELECT status FROM revisions WHERE world_id = ? ORDER BY revision_number").bind(ctx.world.id).all();
    assert.deepEqual(rows.results.map(r => r.status), ["current", "uploading"]);
  } finally { await db.prepare("DROP TRIGGER test_fail_promotion").run(); }
  assert.equal((await finish(ctx, second)).status, 200);
});

test("storage loss returns an error instead of a partial save", async () => {
  const ctx = await setup();
  const upload = await begin(ctx); await put(ctx, upload); await finish(ctx, upload);
  const row = await db.prepare("SELECT object_key FROM revisions WHERE id = ?").bind(upload.id).first();
  await bucket.delete(row.object_key);
  assert.equal((await download(ctx)).status, 503);
  assert.equal(await current(ctx), upload.revision);
});

test("invalid begin metadata, expired sessions and stale base revisions are rejected", async () => {
  const ctx = await setup();
  const body = { baseRevision: 0, lockToken: ctx.lease.token, fileSize: testZip().length, sha256: sha(testZip()) };
  for (const override of [{ baseRevision: -1 }, { fileSize: 0 }, { fileSize: 536870913 }, { fileSize: 22.5 }, { sha256: "no" }]) {
    assert.equal((await api(`${ctx.base}/uploads/begin`, ctx.a, { ...body, ...override })).status, 400);
  }
  assert.equal((await api(`${ctx.base}/uploads/begin`, ctx.a, { ...body, baseRevision: 1 })).status, 409);
  const upload = await begin(ctx); await put(ctx, upload);
  await db.prepare("UPDATE revisions SET upload_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(upload.id).run();
  assert.equal((await put(ctx, upload)).status, 409);
  assert.equal((await finish(ctx, upload)).body.error.code, "upload_conflict");
});

test("changed content cannot replace an already stored immutable upload", async () => {
  const ctx = await setup();
  const upload = await begin(ctx); await put(ctx, upload);
  const changed = Buffer.from(testZip()); changed[40] ^= 1;
  // R2 may reject the checksum first or return the existing immutable object.
  // Either way the original bytes must remain unchanged.
  assert.ok([200, 422].includes((await put(ctx, upload, changed)).status));
  assert.equal((await finish(ctx, upload)).status, 200);
  assert.deepEqual((await download(ctx)).bytes, testZip());
});

test("content length and media type must agree with the upload declaration", async () => {
  const ctx = await setup();
  const upload = await begin(ctx);
  for (const [bytes, type, status] of [[testZip().subarray(0, -1), "application/zip", 400], [testZip(), "text/plain", 415]]) {
    const response = await mf.dispatchFetch(`http://localhost${upload.contentPath}`, { method: "PUT", headers: {
      authorization: `Bearer ${ctx.a.token}`, "x-relay-lock": ctx.lease.token,
      "content-type": type, "content-length": String(bytes.length),
    }, body: bytes });
    assert.equal(response.status, status);
    await response.arrayBuffer();
  }
  assert.equal(await current(ctx), 0);
});

test("interrupted upload leaves no current save and can be retried", async () => {
  const ctx = await setup();
  const upload = await begin(ctx);
  let sent = false;
  const interrupted = new ReadableStream({ pull(controller) {
    if (!sent) { controller.enqueue(testZip().subarray(0, 30)); sent = true; }
    else controller.error(new Error("Simulated interrupted connection"));
  } });
  try {
    const response = await mf.dispatchFetch(`http://localhost${upload.contentPath}`, { method: "PUT", duplex: "half", headers: {
      authorization: `Bearer ${ctx.a.token}`, "x-relay-lock": ctx.lease.token,
      "content-type": "application/zip", "content-length": String(testZip().length),
    }, body: interrupted });
    assert.ok(response.status >= 400);
    await response.arrayBuffer();
  } catch (error) {
    assert.match(String(error), /interrupted|fetch failed|terminated|mismatch|closed/i);
  }
  assert.equal(await current(ctx), 0);
  assert.equal((await finish(ctx, upload)).status, 409);
  assert.equal((await put(ctx, upload)).status, 200);
  assert.equal((await finish(ctx, upload)).status, 200);
});

test("deflated ZIPs with and without data descriptors validate and round-trip", async () => {
  for (const descriptor of [false, true]) {
    const ctx = await setup();
    const bytes = testZip("Compressed synthetic save ".repeat(100), true, descriptor);
    const upload = await begin(ctx, bytes);
    assert.equal((await put(ctx, upload, bytes)).status, 200);
    assert.equal((await finish(ctx, upload)).status, 200);
    assert.deepEqual((await download(ctx)).bytes, bytes);
  }
});

test("ZIP with a matching SHA but corrupt entry CRC or deflate data never publishes", async () => {
  for (const compressed of [false, true]) {
    const ctx = await setup();
    const bytes = Buffer.from(testZip("Damaged before upload".repeat(10), compressed));
    bytes[50] ^= 0x7f;
    const upload = await begin(ctx, bytes);
    assert.equal((await put(ctx, upload, bytes)).status, 200);
    assert.equal((await finish(ctx, upload)).body.error.code, "invalid_zip");
    assert.equal(await current(ctx), 0);
  }
});

test("ZIP expanded-size bombs, encryption and invalid descriptors are rejected", async () => {
  const original = testZip("Descriptor test", true, true);
  const central = original.readUInt32LE(original.length - 6);
  const bomb = Buffer.from(original); bomb.writeUInt32LE(0xffffffff, central + 24);
  const encrypted = Buffer.from(original); encrypted.writeUInt16LE(9, central + 8);
  const badDescriptor = Buffer.from(original); badDescriptor[central - 12] ^= 1;
  for (const bytes of [bomb, encrypted, badDescriptor]) {
    const ctx = await setup();
    const upload = await begin(ctx, bytes); await put(ctx, upload, bytes);
    assert.equal((await finish(ctx, upload)).body.error.code, "invalid_zip");
    assert.equal(await current(ctx), 0);
  }
});

test("independent .NET ZIP with a directory and multiple deflated entries validates", async () => {
  // Generated with System.IO.Compression.ZipArchive, independently of testZip().
  const bytes = Buffer.from("UEsDBBQAAAAAAGKSOV0AAAAAAAAAAAAAAAAHAAAAc2FtcGxlL1BLAwQUAAAACABikjldZQCJSS0AAAAlAAAAEAAAAHNhbXBsZS9sZXZlbC5kYXTyzEtJLUjNS0nNK1EorswryUgtyUxWSCxKzsgsS1VIy6woKS1KBQAAAP//AwBQSwMEFAAAAAgAYpI5XWUAiUktAAAAJQAAABAAAABzYW1wbGUvaW5mby5qc29u8sxLSS1IzUtJzStRKK7MK8lILclMVkgsSs7ILEtVSMusKCktSgUAAAD//wMAUEsBAhQAFAAAAAAAYpI5XQAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAHNhbXBsZS9QSwECFAAUAAAACABikjldZQCJSS0AAAAlAAAAEAAAAAAAAAAAAAAAAAAlAAAAc2FtcGxlL2xldmVsLmRhdFBLAQIUABQAAAAIAGKSOV1lAIlJLQAAACUAAAAQAAAAAAAAAAAAAAAAAIAAAABzYW1wbGUvaW5mby5qc29uUEsFBgAAAAADAAMAsQAAANsAAAAAAA==", "base64");
  const ctx = await setup();
  const upload = await begin(ctx, bytes); await put(ctx, upload, bytes);
  assert.equal((await finish(ctx, upload)).status, 200);
  assert.deepEqual((await download(ctx)).bytes, bytes);
});
