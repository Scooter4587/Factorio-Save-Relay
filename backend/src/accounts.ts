import { ApiError, json, readBody, textField } from "./http";
import { newToken, tokenHash, type Identity } from "./identity";

const LOGIN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const RECOVERY = /^fsr_recovery\.[0-9a-f-]{36}\.[0-9a-f]{64}$/;
const ITERATIONS = 25000;

function loginName(value: unknown): string {
  if (typeof value !== "string" || !LOGIN.test(value.trim().toLowerCase())) {
    throw new ApiError(400, "invalid_login_name", "Use 3-32 letters, numbers, dots, underscores or hyphens for the account name.");
  }
  return value.trim().toLowerCase();
}

function password(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ApiError(400, "invalid_password", "Password must contain 12-128 characters without control characters.");
  }
  return value;
}

function requirePepper(pepper?: string): string {
  if (!pepper || pepper.length < 32) throw new ApiError(503, "account_login_unavailable", "Account login is not configured.");
  return pepper;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(value: string, salt: string, pepper: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
  const mixedSalt = new TextEncoder().encode(`factorio-relay-v1:${salt}:${pepper}`);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: mixedSalt, iterations: ITERATIONS }, material, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
}

function equalHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function rateLimit(db: D1Database): Promise<void> {
  const result = await db.prepare(`
    INSERT INTO auth_attempts (key_hash, attempts) VALUES (?, 1)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN window_start < datetime('now', '-15 minutes') THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start < datetime('now', '-15 minutes') THEN CURRENT_TIMESTAMP ELSE window_start END
    RETURNING attempts
  `).bind("private-pilot-account-auth").first<{ attempts: number }>();
  if (result && result.attempts > 50) throw new ApiError(429, "too_many_attempts", "Too many attempts. Try again in 15 minutes.");
}

export async function createAccount(request: Request, db: D1Database, pepperValue: string | undefined): Promise<Response> {
  const pepper = requirePepper(pepperValue);
  const body = await readBody(request);
  const username = loginName(body.username);
  const displayName = textField(body, "displayName");
  const deviceName = textField(body, "deviceName");
  const secret = password(body.password);
  const userId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const salt = randomHex(16);
  const deviceToken = newToken("device", deviceId);
  const recoveryCode = newToken("recovery", userId);
  if (await db.prepare("SELECT 1 FROM users WHERE login_name = ?").bind(username).first()) {
    throw new ApiError(409, "account_exists", "This account name is already in use.");
  }
  const [user, device] = await db.batch<{ id: string }>([
    db.prepare(`INSERT INTO users (id, display_name, login_name, password_salt, password_hash, recovery_hash)
      SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM users) < 2
      AND NOT EXISTS (SELECT 1 FROM users WHERE login_name = ?) RETURNING id`)
      .bind(userId, displayName, username, salt, await hashPassword(secret, salt, pepper), await tokenHash(recoveryCode), username),
    db.prepare(`INSERT INTO devices (id, user_id, device_name, token_hash)
      SELECT ?, id, ?, ? FROM users WHERE id = ? RETURNING id`)
      .bind(deviceId, deviceName, await tokenHash(deviceToken), userId),
  ]);
  if (!user?.results[0] || !device?.results[0]) {
    if (await db.prepare("SELECT 1 FROM users WHERE login_name = ?").bind(username).first()) {
      throw new ApiError(409, "account_exists", "This account name is already in use.");
    }
    throw new ApiError(403, "pilot_full", "This private pilot already has two registered players.");
  }
  return json({ user: { id: userId, displayName, username }, device: { id: deviceId, deviceName }, token: deviceToken, recoveryCode }, 201);
}

export async function upgradeAccount(request: Request, db: D1Database, identity: Identity,
  pepperValue: string | undefined): Promise<Response> {
  const pepper = requirePepper(pepperValue);
  const body = await readBody(request);
  const username = loginName(body.username);
  const secret = password(body.password);
  const salt = randomHex(16);
  const recoveryCode = newToken("recovery", identity.userId);
  const updated = await db.prepare(`UPDATE users SET login_name = ?, password_salt = ?, password_hash = ?, recovery_hash = ?
    WHERE id = ? AND login_name IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE login_name = ?) RETURNING id`)
    .bind(username, salt, await hashPassword(secret, salt, pepper), await tokenHash(recoveryCode), identity.userId, username)
    .first<{ id: string }>();
  if (!updated) throw new ApiError(409, "account_upgrade_unavailable", "This account already has a login or the name is in use.");
  return json({ upgraded: true, recoveryCode });
}

export async function loginAccount(request: Request, db: D1Database, pepperValue: string | undefined): Promise<Response> {
  const pepper = requirePepper(pepperValue);
  const body = await readBody(request);
  const username = loginName(body.username);
  const secret = password(body.password);
  const deviceName = textField(body, "deviceName");
  await rateLimit(db);
  const user = await db.prepare(`SELECT id, display_name AS displayName, password_salt AS salt,
    password_hash AS hash FROM users WHERE login_name = ?`).bind(username)
    .first<{ id: string; displayName: string; salt: string; hash: string }>();
  // Hash a dummy value as well, so unknown usernames do not take a cheap path.
  const candidate = await hashPassword(secret, user?.salt ?? "00000000000000000000000000000000", pepper);
  if (!user?.hash || !equalHash(candidate, user.hash)) {
    throw new ApiError(401, "invalid_credentials", "Account name or password is incorrect.");
  }
  const deviceId = crypto.randomUUID();
  const token = newToken("device", deviceId);
  await db.prepare("INSERT INTO devices (id, user_id, device_name, token_hash) VALUES (?, ?, ?, ?)")
    .bind(deviceId, user.id, deviceName, await tokenHash(token)).run();
  return json({ user: { id: user.id, displayName: user.displayName, username },
    device: { id: deviceId, deviceName }, token });
}

export async function recoverAccount(request: Request, db: D1Database, pepperValue: string | undefined): Promise<Response> {
  const pepper = requirePepper(pepperValue);
  const body = await readBody(request);
  const username = loginName(body.username);
  const code = textField(body, "recoveryCode", 160);
  const secret = password(body.newPassword);
  if (!RECOVERY.test(code)) throw new ApiError(401, "invalid_recovery", "Recovery details are incorrect.");
  await rateLimit(db);
  const user = await db.prepare("SELECT id FROM users WHERE login_name = ? AND recovery_hash = ?")
    .bind(username, await tokenHash(code)).first<{ id: string }>();
  if (!user) throw new ApiError(401, "invalid_recovery", "Recovery details are incorrect.");
  const nextCode = newToken("recovery", user.id);
  const salt = randomHex(16);
  const [updated] = await db.batch([
    db.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, recovery_hash = ?
      WHERE id = ? AND recovery_hash = ?`).bind(salt, await hashPassword(secret, salt, pepper),
      await tokenHash(nextCode), user.id, await tokenHash(code)),
    db.prepare(`UPDATE devices SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND (SELECT changes()) = 1`)
      .bind(user.id),
  ]);
  if (updated?.meta.changes !== 1) throw new ApiError(401, "invalid_recovery", "Recovery details are incorrect.");
  return json({ recovered: true, recoveryCode: nextCode });
}
