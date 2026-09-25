import { ApiError, json, readBody, textField } from "./http";

export interface Identity {
  userId: string;
  displayName: string;
  deviceId: string;
  deviceName: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export async function tokenHash(token: string): Promise<string> {
  // Each token includes a unique UUID salt and 256 bits of random secret.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newToken(kind: "device" | "invite" | "lease", id: string): string {
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `fsr_${kind}.${id}.${secret}`;
}

export function validToken(token: string, kind: "device" | "invite" | "lease"): boolean {
  return new RegExp(`^fsr_${kind}\\.${UUID}\\.[0-9a-f]{64}$`).test(token);
}

export async function register(request: Request, db: D1Database): Promise<Response> {
  const body = await readBody(request);
  const displayName = textField(body, "displayName");
  const deviceName = textField(body, "deviceName");
  const userId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const token = newToken("device", deviceId);
  await db.batch([
    db.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").bind(userId, displayName),
    db.prepare("INSERT INTO devices (id, user_id, device_name, token_hash) VALUES (?, ?, ?, ?)")
      .bind(deviceId, userId, deviceName, await tokenHash(token)),
  ]);
  return json({ user: { id: userId, displayName }, device: { id: deviceId, deviceName }, token }, 201);
}

export async function authenticate(request: Request, db: D1Database): Promise<Identity> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer ([^\s]+)$/i.exec(header)?.[1];
  if (!token || !validToken(token, "device")) {
    throw new ApiError(401, "unauthorized", "A valid device bearer token is required.");
  }
  const identity = await db.prepare(`
    SELECT d.id AS deviceId, d.device_name AS deviceName,
           u.id AS userId, u.display_name AS displayName
    FROM devices d JOIN users u ON u.id = d.user_id
    WHERE d.token_hash = ? AND d.revoked_at IS NULL
  `).bind(await tokenHash(token)).first<Identity>();
  if (!identity) throw new ApiError(401, "unauthorized", "A valid device bearer token is required.");
  await db.prepare("UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(identity.deviceId).run();
  return identity;
}
