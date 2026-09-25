import { ApiError, json } from "./http";
import { authenticate, register } from "./identity";
import { createInvite, createWorld, getWorld, listWorlds, redeemInvite } from "./worlds";
import { acquireLease, changeLease } from "./leases";

interface Env {
  DB?: D1Database;
  ALLOW_REGISTRATION?: string;
}

const SERVICE_VERSION = "0.1.0";

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
      const registration = method === "POST" && pathname === "/v1/devices/register";
      const recognized = registration
        || (method === "GET" && pathname === "/v1/me")
        || (["GET", "POST"].includes(method) && pathname === "/v1/worlds")
        || (method === "POST" && pathname === "/v1/invites/redeem")
        || (method === "POST" && leaseMatch)
        || (worldMatch && ((method === "GET" && !worldMatch[2]) || (method === "POST" && worldMatch[2])));
      if (!recognized) throw new ApiError(404, "not_found", "The requested endpoint does not exist.");
      if (!env.DB) throw new ApiError(503, "database_unavailable", "Database binding is not configured.");
      if (registration) {
        if (env.ALLOW_REGISTRATION !== "true") {
          throw new ApiError(403, "registration_disabled", "Device registration is disabled.");
        }
        return await register(request, env.DB);
      }
      const identity = await authenticate(request, env.DB);
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
} satisfies ExportedHandler<Env>;
