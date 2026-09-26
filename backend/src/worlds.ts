import { ApiError, json, readBody, textField } from "./http";
import { newToken, tokenHash, validToken, type Identity } from "./identity";

interface World {
  id: string;
  name: string;
  ownerUserId: string;
  currentRevision: number;
  role: "owner" | "member";
  createdAt: string;
  hostDeviceId: string | null;
  hostLeaseExpiresAt: string | null;
}

interface WorldMember {
  userId: string;
  displayName: string;
  role: "owner" | "member";
}

const WORLD_SELECT = `SELECT w.id, w.name, w.owner_user_id AS ownerUserId,
  w.current_revision AS currentRevision, m.role, w.created_at AS createdAt,
  CASE WHEN w.lock_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    THEN w.locked_by_device_id ELSE NULL END AS hostDeviceId,
  CASE WHEN w.lock_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    THEN w.lock_expires_at ELSE NULL END AS hostLeaseExpiresAt
  FROM worlds w JOIN world_members m ON m.world_id = w.id`;

export async function getWorld(db: D1Database, worldId: string, userId: string): Promise<World> {
  const world = await db.prepare(`${WORLD_SELECT} WHERE w.id = ? AND m.user_id = ?`)
    .bind(worldId, userId).first<World>();
  // Do not reveal whether another user's world exists.
  if (!world) throw new ApiError(404, "world_not_found", "World not found.");
  return world;
}

export async function getWorldDetails(db: D1Database, worldId: string, userId: string): Promise<World & { members: WorldMember[] }> {
  const world = await getWorld(db, worldId, userId);
  const { results } = await db.prepare(`
    SELECT u.id AS userId, u.display_name AS displayName, m.role
    FROM world_members m JOIN users u ON u.id = m.user_id
    WHERE m.world_id = ? AND EXISTS (
      SELECT 1 FROM world_members viewer WHERE viewer.world_id = m.world_id AND viewer.user_id = ?
    )
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.display_name, u.id
  `).bind(worldId, userId).all<WorldMember>();
  return { ...world, members: results };
}

export async function listWorlds(db: D1Database, identity: Identity): Promise<Response> {
  const { results } = await db.prepare(`${WORLD_SELECT} WHERE m.user_id = ? ORDER BY w.created_at, w.id`)
    .bind(identity.userId).all<World>();
  return json({ worlds: results });
}

export async function createWorld(request: Request, db: D1Database, identity: Identity, privatePilot = false): Promise<Response> {
  const name = textField(await readBody(request), "name");
  const id = crypto.randomUUID();
  const [world, membership] = await db.batch<{ id: string }>([
    db.prepare(privatePilot
      ? "INSERT INTO worlds (id, owner_user_id, name) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM worlds) < 1 RETURNING id"
      : "INSERT INTO worlds (id, owner_user_id, name) VALUES (?, ?, ?) RETURNING id")
      .bind(id, identity.userId, name),
    db.prepare("INSERT INTO world_members (world_id, user_id, role) SELECT id, owner_user_id, 'owner' FROM worlds WHERE id = ? RETURNING world_id AS id")
      .bind(id),
  ]);
  if (!world?.results[0] || !membership?.results[0]) {
    throw new ApiError(403, "pilot_world_limit", "This private pilot already has one world.");
  }
  return json({ world: await getWorld(db, id, identity.userId) }, 201);
}

export async function createInvite(db: D1Database, worldId: string, identity: Identity): Promise<Response> {
  const world = await getWorld(db, worldId, identity.userId);
  if (world.ownerUserId !== identity.userId || world.role !== "owner") {
    throw new ApiError(403, "owner_required", "Only the world owner can create invitations.");
  }
  const id = crypto.randomUUID();
  const code = newToken("invite", id);
  const invite = await db.prepare(`
    INSERT INTO invites (id, world_id, token_hash, expires_at)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours'))
    RETURNING expires_at AS expiresAt
  `).bind(id, worldId, await tokenHash(code)).first<{ expiresAt: string }>();
  return json({ invite: { id, worldId, code, expiresAt: invite!.expiresAt } }, 201);
}

export async function redeemInvite(request: Request, db: D1Database, identity: Identity): Promise<Response> {
  const code = textField(await readBody(request), "code", 160);
  if (!validToken(code, "invite")) {
    throw new ApiError(400, "invalid_invite", "Invalid invitation code.");
  }
  const hash = await tokenHash(code);
  // The conditional claim and membership insert share one transaction. A failed
  // insert rolls back the claim; concurrent requests cannot claim the same invite.
  const [claim] = await db.batch<{ worldId: string }>([
    db.prepare(`
      UPDATE invites SET redeemed_at = CURRENT_TIMESTAMP, redeemed_by_user_id = ?
      WHERE token_hash = ? AND redeemed_at IS NULL
        AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND NOT EXISTS (
          SELECT 1 FROM world_members WHERE world_id = invites.world_id AND user_id = ?
        )
      RETURNING world_id AS worldId
    `).bind(identity.userId, hash, identity.userId),
    db.prepare(`
      INSERT INTO world_members (world_id, user_id, role)
      SELECT world_id, redeemed_by_user_id, 'member' FROM invites
      WHERE changes() = 1 AND token_hash = ? AND redeemed_by_user_id = ? AND redeemed_at IS NOT NULL
      ON CONFLICT (world_id, user_id) DO NOTHING
    `).bind(hash, identity.userId),
  ]);
  const worldId = claim?.results[0]?.worldId;
  if (!worldId) {
    throw new ApiError(409, "invite_unavailable", "Invitation is expired, already used, unknown, or you are already a member.");
  }
  return json({ world: await getWorld(db, worldId, identity.userId) });
}
