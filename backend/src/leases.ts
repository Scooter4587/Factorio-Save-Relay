import { ApiError, json, readBody, textField } from "./http";
import { newToken, tokenHash, validToken, type Identity } from "./identity";
import { getWorld } from "./worlds";

const TTL_SECONDS = 180;
const RENEW_AFTER_SECONDS = 60;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const EXPIRY = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${TTL_SECONDS} seconds')`;
const MEMBER = "EXISTS (SELECT 1 FROM world_members WHERE world_id = worlds.id AND user_id = ?)";

interface LeaseRow {
  worldId: string;
  deviceId: string;
  expiresAt: string;
}

export async function acquireLease(request: Request, db: D1Database, worldId: string, identity: Identity): Promise<Response> {
  await getWorld(db, worldId, identity.userId);
  const { expectedRevision } = await readBody(request);
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new ApiError(400, "invalid_revision", "expectedRevision must be a non-negative safe integer.");
  }
  const token = newToken("lease", crypto.randomUUID());
  // Claim only a free/expired lease at exactly the caller's revision. This is
  // one conditional write, not a read followed by an unconditional update.
  const lease = await db.prepare(`
    UPDATE worlds SET locked_by_device_id = ?, lock_token_hash = ?,
      lock_expires_at = ${EXPIRY}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND current_revision = ? AND ${MEMBER}
      AND (locked_by_device_id IS NULL OR lock_expires_at <= ${NOW})
    RETURNING id AS worldId, locked_by_device_id AS deviceId, lock_expires_at AS expiresAt
  `).bind(identity.deviceId, await tokenHash(token), worldId, expectedRevision, identity.userId).first<LeaseRow>();
  if (!lease) {
    throw new ApiError(409, "lease_unavailable", "World is already leased or its revision has changed. Refresh the world before retrying.");
  }
  return json({ lease: { ...lease, token, ttlSeconds: TTL_SECONDS, renewAfterSeconds: RENEW_AFTER_SECONDS } }, 201);
}

export async function changeLease(request: Request, db: D1Database, worldId: string, identity: Identity, action: "renew" | "release"): Promise<Response> {
  await getWorld(db, worldId, identity.userId);
  const token = textField(await readBody(request), "lockToken", 160);
  if (!validToken(token, "lease")) {
    throw new ApiError(400, "invalid_lease_token", "A valid lease token is required.");
  }
  // Both device identity and this acquisition's secret must match. An old
  // session cannot renew or release a later lease, even on the same device.
  const update = action === "renew"
    ? `lock_expires_at = ${EXPIRY}`
    : "locked_by_device_id = NULL, lock_token_hash = NULL, lock_expires_at = NULL";
  const result = await db.prepare(`
    UPDATE worlds SET ${update}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND locked_by_device_id = ? AND lock_token_hash = ?
      AND lock_expires_at > ${NOW} AND ${MEMBER}
    RETURNING id AS worldId, locked_by_device_id AS deviceId, lock_expires_at AS expiresAt
  `).bind(worldId, identity.deviceId, await tokenHash(token), identity.userId).first<LeaseRow>();
  if (!result) {
    throw new ApiError(409, "lease_lost", "Lease is expired, released, or belongs to another session. Stop publishing and refresh the world.");
  }
  return action === "release"
    ? json({ released: true, worldId })
    : json({ lease: { ...result, ttlSeconds: TTL_SECONDS, renewAfterSeconds: RENEW_AFTER_SECONDS } });
}
