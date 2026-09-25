import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { testZip } from "./zip-fixture.mjs";

let mf;
const origin = "https://relay.example.com";
const prefix = "/factorio-relay/v1";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
before(async () => {
  const built = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false,
    format: "esm", platform: "neutral", target: "es2023" });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text,
    compatibilityDate: "2026-09-25", d1Databases: ["DB"], r2Buckets: ["SAVES"],
    bindings: { ALLOW_REGISTRATION: "true", ALLOW_LOCAL_TRANSFERS: "true",
      PRIVATE_PILOT: "true", REGISTRATION_KEY: "private-test-registration-key" } }));
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir(new URL("../migrations/", import.meta.url))).filter(f => f.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
});
after(async () => { await mf?.dispose(); });

async function send(path, { method = "GET", cookie, body, headers = {}, raw } = {}) {
  return mf.dispatchFetch(origin + path, { method, headers: {
    ...(method !== "GET" ? { origin } : {}), ...(cookie ? { cookie } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers,
  }, body: body !== undefined ? JSON.stringify(body) : raw });
}
const payload = response => response.json();

test("private page is served with CSP and the browser API requires a session", async () => {
  const page = await send("/factorio-relay");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await page.text(), /Odovzdať save/);
  const script = await send("/factorio-relay/app.js");
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  const source = await script.text();
  assert.doesNotThrow(() => new Function(source));
  const denied = await send(prefix + "/worlds");
  assert.equal(denied.status, 401);
  assert.equal((await payload(denied)).error.code, "unauthorized");
  assert.equal((await send("/health")).status, 200);
});

test("registration, cookie sign-in, origin check and logout", async () => {
  const registration = await send(prefix + "/devices/register", { method: "POST",
    headers: { "x-relay-registration-key": "private-test-registration-key" },
    body: { displayName: "Web owner", deviceName: "Browser" } });
  assert.equal(registration.status, 201);
  const owner = await payload(registration);
  const cookie = registration.headers.get("set-cookie").split(";")[0];
  assert.match(registration.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Secure/);
  assert.equal((await payload(await send(prefix + "/me", { cookie }))).identity.userId, owner.user.id);
  const crossSite = await send(prefix + "/worlds", { method: "POST", cookie,
    headers: { origin: "https://bad.example.com" }, body: { name: "No" } });
  assert.equal(crossSite.status, 403);
  const worldResponse = await send(prefix + "/worlds", { method: "POST", cookie,
    body: { name: "Browser test" } });
  assert.equal(worldResponse.status, 201);
  const world = (await payload(worldResponse)).world;
  assert.equal(world.currentRevision, 0);
  const signedOut = await send(prefix + "/browser/session", { method: "DELETE", cookie });
  assert.match(signedOut.headers.get("set-cookie"), /Max-Age=0/);
  const badLogin = await send(prefix + "/browser/session", { method: "POST", body: { token: "wrong" } });
  assert.equal(badLogin.status, 401);
  const login = await send(prefix + "/browser/session", { method: "POST", body: { token: owner.token } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);

  const base = prefix + "/worlds/" + world.id;
  const lease = await payload(await send(base + "/lock/acquire", { method: "POST", cookie,
    body: { expectedRevision: 0 } }));
  assert.ok(lease.lease.token);
  const bytes = testZip();
  const begun = await payload(await send(base + "/uploads/begin", { method: "POST", cookie,
    body: { baseRevision: 0, lockToken: lease.lease.token,
      fileSize: bytes.length, sha256: sha(bytes) } }));
  assert.ok(begun.upload.contentPath);
  const put = await send("/factorio-relay" + begun.upload.contentPath, { method: "PUT", cookie,
    headers: { "content-type": "application/zip", "content-length": String(bytes.length),
      "x-relay-lock": lease.lease.token }, raw: bytes });
  assert.equal(put.status, 200, JSON.stringify(await payload(put.clone())));
  const finalized = await send(base + "/uploads/finalize", { method: "POST", cookie,
    body: { uploadId: begun.upload.id, lockToken: lease.lease.token } });
  assert.equal(finalized.status, 200);
  const download = await send(base + "/download", { cookie });
  assert.equal(download.status, 200);
  assert.equal(sha(Buffer.from(await download.arrayBuffer())), sha(bytes));
  assert.equal((await payload(await send(base, { cookie }))).world.currentRevision, 1);
});
