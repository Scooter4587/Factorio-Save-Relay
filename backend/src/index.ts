import { ApiError, json } from "./http";
import { authenticate, register, tokenHash } from "./identity";
import { createInvite, createWorld, getWorld, listWorlds, redeemInvite } from "./worlds";
import { acquireLease, changeLease } from "./leases";
import { beginUpload, putContent, finalizeUpload, listRevisions, download, restoreRevision, cleanupRetention } from "./transfers";

interface Env {
  DB?: D1Database;
  ALLOW_REGISTRATION?: string;
  ALLOW_INSECURE_LOCAL_REGISTRATION?: string;
  REGISTRATION_KEY?: string;
  SAVES?: R2Bucket;
  ALLOW_LOCAL_TRANSFERS?: string;
}

const SERVICE_VERSION = "0.1.0";

async function registrationAuthorized(request: Request, env: Env): Promise<boolean> {
  if (env.REGISTRATION_KEY) {
    const supplied = request.headers.get("x-relay-registration-key") ?? "";
    if (supplied.length < 1 || supplied.length > 256) return false;
    const actual = await tokenHash(supplied);
    const expected = await tokenHash(env.REGISTRATION_KEY);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
  }
  const host = new URL(request.url).hostname;
  return env.ALLOW_INSECURE_LOCAL_REGISTRATION === "true"
    && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);
      const method = request.method;
      if (method === "GET" && pathname === "/health") {
        return json({ service: "factorio-save-relay-api", status: "ok", version: SERVICE_VERSION });
      }
      if (method === "GET" && pathname === "/v1/version") return json({ version: SERVICE_VERSION });

      const worldMatch = /^\/v1\/worlds\/([0-9a-f-]{36})(\/invites)?$/.exec(pathname);
      const leaseMatch = /^\/v1\/worlds\/([0-9a-f-]{36})\/lock\/(acquire|renew|release)$/.exec(pathname);
      const uploadMatch = /^\/v1\/worlds\/([0-9a-f-]{36})\/uploads\/(begin|finalize)$/.exec(pathname);
      const contentMatch = /^\/v1\/worlds\/([0-9a-f-]{36})\/uploads\/([0-9a-f-]{36})\/content$/.exec(pathname);
      const downloadMatch = /^\/v1\/worlds\/([0-9a-f-]{36})\/(?:revisions\/([1-9][0-9]*)\/)?download$/.exec(pathname);
      const historyMatch = /^\/v1\/worlds\/([0-9a-f-]{36})\/revisions$/.exec(pathname);
      const restoreMatch = /^\/v1\/worlds\/([0-9a-f-]{36})\/revisions\/([1-9][0-9]*)\/restore$/.exec(pathname);
      const transfer = (method === "POST" && uploadMatch) || (method === "PUT" && contentMatch)
        || (method === "GET" && (downloadMatch || historyMatch)) || (method === "POST" && restoreMatch);
      const registration = method === "POST" && pathname === "/v1/devices/register";
      const recognized = registration
        || (method === "GET" && pathname === "/v1/me")
        || (["GET", "POST"].includes(method) && pathname === "/v1/worlds")
        || (method === "POST" && pathname === "/v1/invites/redeem")
        || (method === "POST" && leaseMatch)
        || transfer
        || (worldMatch && ((method === "GET" && !worldMatch[2]) || (method === "POST" && worldMatch[2])));
      if (!recognized) throw new ApiError(404, "not_found", "The requested endpoint does not exist.");
      if (!env.DB) throw new ApiError(503, "database_unavailable", "Database binding is not configured.");
      if (registration) {
        if (env.ALLOW_REGISTRATION !== "true") {
          throw new ApiError(403, "registration_disabled", "Device registration is disabled.");
        }
        if (!await registrationAuthorized(request, env)) {
          throw new ApiError(403, "registration_denied", "A valid registration key is required.");
        }
        return await register(request, env.DB);
      }
      const identity = await authenticate(request, env.DB);
      if (transfer) {
        if (env.ALLOW_LOCAL_TRANSFERS !== "true") throw new ApiError(503, "transfers_disabled", "Local transfer transport is disabled.");
        if (!env.SAVES) throw new ApiError(503, "storage_unavailable", "Save storage is not configured.");
        if (uploadMatch) return uploadMatch[2] === "begin"
          ? await beginUpload(request, env.DB, uploadMatch[1]!, identity)
          : await finalizeUpload(request, env.DB, env.SAVES, uploadMatch[1]!, identity);
        if (contentMatch) return await putContent(request, env.DB, env.SAVES, contentMatch[1]!, contentMatch[2]!, identity);
        if (historyMatch) return await listRevisions(env.DB, historyMatch[1]!, identity);
        if (restoreMatch) {
          const revision = Number(restoreMatch[2]);
          if (!Number.isSafeInteger(revision)) throw new ApiError(400, "invalid_revision", "Invalid revision number.");
          return await restoreRevision(request, env.DB, env.SAVES, restoreMatch[1]!, revision, identity);
        }
        const revision = downloadMatch![2] === undefined ? undefined : Number(downloadMatch![2]);
        if (revision !== undefined && !Number.isSafeInteger(revision)) throw new ApiError(400, "invalid_revision", "Invalid revision number.");
        return await download(env.DB, env.SAVES, downloadMatch![1]!, identity, revision);
      }
      if (pathname === "/v1/me") return json({ identity });
      if (pathname === "/v1/worlds") {
        return method === "GET" ? await listWorlds(env.DB, identity) : await createWorld(request, env.DB, identity);
      }
      if (pathname === "/v1/invites/redeem") return await redeemInvite(request, env.DB, identity);
      if (leaseMatch) {
        const worldId = leaseMatch[1]!;
        const action = leaseMatch[2];
        return action === "acquire"
          ? await acquireLease(request, env.DB, worldId, identity)
          : await changeLease(request, env.DB, worldId, identity, action as "renew" | "release");
      }
      const worldId = worldMatch![1]!;
      return method === "GET"
        ? json({ world: await getWorld(env.DB, worldId, identity.userId) })
        : await createInvite(env.DB, worldId, identity);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
      // Database errors can contain bound values. Do not log them or expose them.
      console.error("API request failed unexpectedly.");
      return json({ error: { code: "internal_error", message: "The request could not be completed." } }, 500);
    }
  },
  async scheduled(_event, env): Promise<void> {
    if (env.DB && env.SAVES && env.ALLOW_LOCAL_TRANSFERS === "true") {
      await cleanupRetention(env.DB, env.SAVES);
    }
  },
} satisfies ExportedHandler<Env>;
