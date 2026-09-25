import { validateZip } from "./zip";
import { ApiError, json, readBody, textField } from "./http";
import { tokenHash, validToken, type Identity } from "./identity";
import { getWorld } from "./worlds";

// This bounded relay transport is for local development only. Production will
// use short-lived direct R2 URLs rather than routing large saves through Workers.
export const MAX_LOCAL_UPLOAD_BYTES = 512 * 1024 * 1024;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

interface Revision {
  id: string;
  world_id: string;
  revision_number: number;
  base_revision_number: number;
  object_key: string;
  sha256: string;
  file_size_bytes: number;
  uploaded_by_device_id: string;
  status: string;
  upload_lease_hash: string;
  upload_expires_at: string;
}

function publicRevision(row: Revision) {
  return { id: row.id, worldId: row.world_id, revision: row.revision_number,
    baseRevision: row.base_revision_number, sha256: row.sha256,
    fileSize: row.file_size_bytes, uploadedByDeviceId: row.uploaded_by_device_id, status: row.status };
}

function revisionNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, "invalid_revision", "baseRevision must be a non-negative safe integer.");
  }
  return value;
}

async function leaseHash(value: unknown): Promise<string> {
  if (typeof value !== "string" || !validToken(value, "lease")) {
    throw new ApiError(400, "invalid_lease_token", "A valid lockToken is required.");
  }
  return tokenHash(value);
}

async function ownedUpload(db: D1Database, worldId: string, uploadId: string, identity: Identity): Promise<Revision> {
  await getWorld(db, worldId, identity.userId);
  const row = await db.prepare("SELECT * FROM revisions WHERE id = ? AND world_id = ? AND uploaded_by_device_id = ?")
    .bind(uploadId, worldId, identity.deviceId).first<Revision>();
  if (!row) throw new ApiError(404, "upload_not_found", "Upload not found.");
  return row;
}

export async function beginUpload(request: Request, db: D1Database, worldId: string, identity: Identity): Promise<Response> {
  await getWorld(db, worldId, identity.userId);
  const body = await readBody(request);
  const baseRevision = revisionNumber(body.baseRevision);
  const hash = await leaseHash(body.lockToken);
  const sha256 = textField(body, "sha256", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ApiError(400, "invalid_hash", "sha256 must be 64 hexadecimal characters.");
  const size = body.fileSize;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 22 || size > MAX_LOCAL_UPLOAD_BYTES) {
    throw new ApiError(400, "invalid_size", `fileSize must be between 22 and ${MAX_LOCAL_UPLOAD_BYTES} bytes.`);
  }
  const id = crypto.randomUUID();
  const key = `worlds/${worldId}/uploads/${id}.zip`;
  // Number allocation and lease/revision checks occur in the same SQL statement.
  // Incomplete uploads may leave gaps; finalized revisions never move backwards.
  const upload = await db.prepare(`
    INSERT INTO revisions (id, world_id, revision_number, base_revision_number,
      object_key, sha256, file_size_bytes, uploaded_by_device_id, upload_lease_hash, upload_expires_at)
    SELECT ?, w.id, (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM revisions WHERE world_id = w.id),
      ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours')
    FROM worlds w WHERE w.id = ? AND w.current_revision = ?
      AND w.locked_by_device_id = ? AND w.lock_token_hash = ? AND w.lock_expires_at > ${NOW}
      AND EXISTS (SELECT 1 FROM world_members WHERE world_id = w.id AND user_id = ?)
    RETURNING *
  `).bind(id, baseRevision, key, sha256, size, identity.deviceId, hash, worldId, baseRevision,
    identity.deviceId, hash, identity.userId).first<Revision>();
  if (!upload) throw new ApiError(409, "upload_not_allowed", "An active host lease at the current revision is required.");
  return json({ upload: { ...publicRevision(upload), expiresAt: upload.upload_expires_at,
    contentPath: `/v1/worlds/${worldId}/uploads/${id}/content` } }, 201);
}

function checksum(object: R2Object): string | undefined {
  if (!object.checksums.sha256) return undefined;
  return Array.from(new Uint8Array(object.checksums.sha256), b => b.toString(16).padStart(2, "0")).join("");
}

function verifiedObject(object: R2Object | null, upload: Revision): boolean {
  return object !== null && object.size === upload.file_size_bytes && checksum(object) === upload.sha256;
}

export async function putContent(request: Request, db: D1Database, bucket: R2Bucket, worldId: string, uploadId: string, identity: Identity): Promise<Response> {
  const upload = await ownedUpload(db, worldId, uploadId, identity);
  const hash = await leaseHash(request.headers.get("x-relay-lock"));
  const allowed = await db.prepare(`SELECT 1 FROM revisions r JOIN worlds w ON w.id = r.world_id
    WHERE r.id = ? AND r.status = 'uploading' AND r.upload_lease_hash = ?
      AND r.upload_expires_at > ${NOW} AND w.lock_token_hash = r.upload_lease_hash
      AND w.locked_by_device_id = ? AND w.lock_expires_at > ${NOW}
      AND w.current_revision = r.base_revision_number
      AND EXISTS (SELECT 1 FROM world_members WHERE world_id = w.id AND user_id = ?)
  `).bind(upload.id, hash, identity.deviceId, identity.userId).first();
  if (!allowed) throw new ApiError(409, "upload_not_allowed", "Upload is closed, expired or no longer owns the current host lease.");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/zip") {
    throw new ApiError(415, "unsupported_media_type", "Use application/zip.");
  }
  const length = request.headers.get("content-length");
  if (!length || !/^\d+$/.test(length) || Number(length) !== upload.file_size_bytes || !request.body) {
    throw new ApiError(400, "size_mismatch", "Content-Length must match the declared fileSize.");
  }
  let object: R2Object | null;
  try {
    object = await bucket.put(upload.object_key, request.body, {
      sha256: upload.sha256,
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/zip", cacheControl: "no-store" },
    });
  } catch {
    // R2 validates the supplied checksum while streaming. A rejected or interrupted
    // PUT cannot publish a revision; a retry uses the same immutable object key.
    throw new ApiError(422, "upload_rejected", "Storage rejected the upload. Check the file hash and retry.");
  }
  if (!object) object = await bucket.head(upload.object_key);
  if (!verifiedObject(object, upload)) throw new ApiError(422, "integrity_mismatch", "Stored size or SHA-256 does not match the upload.");
  return json({ uploaded: true, uploadId, sha256: upload.sha256, fileSize: upload.file_size_bytes });
}

export async function finalizeUpload(request: Request, db: D1Database, bucket: R2Bucket, worldId: string, identity: Identity): Promise<Response> {
  const body = await readBody(request);
  const uploadId = textField(body, "uploadId", 36);
  const upload = await ownedUpload(db, worldId, uploadId, identity);
  const hash = await leaseHash(body.lockToken);
  if (hash !== upload.upload_lease_hash) throw new ApiError(409, "lease_lost", "This upload belongs to a different host session.");
  if (["current", "archived"].includes(upload.status)) return json({ revision: publicRevision(upload) });
  if (upload.status !== "uploading") throw new ApiError(409, "upload_conflict", "Upload cannot be promoted; its content has been preserved.");
  if (!verifiedObject(await bucket.head(upload.object_key), upload)) {
    throw new ApiError(409, "upload_incomplete", "Verified upload content is missing.");
  }
  await validateZip(bucket, upload.object_key, upload.file_size_bytes);
  // All four statements share one D1 transaction. The lease and base revision
  // are checked again at commit time; competing finalizations cannot both win.
  await db.batch([
    db.prepare(`UPDATE revisions SET status = 'conflict'
      WHERE id = ? AND status = 'uploading' AND (
        upload_expires_at <= ${NOW} OR NOT EXISTS (
          SELECT 1 FROM worlds w WHERE w.id = revisions.world_id
          AND w.current_revision = revisions.base_revision_number
          AND w.lock_token_hash = revisions.upload_lease_hash
          AND w.locked_by_device_id = ? AND w.lock_expires_at > ${NOW}
          AND EXISTS (SELECT 1 FROM world_members WHERE world_id = w.id AND user_id = ?)
          AND EXISTS (SELECT 1 FROM devices WHERE id = ? AND revoked_at IS NULL)))
    `).bind(uploadId, identity.deviceId, identity.userId, identity.deviceId),
    db.prepare(`UPDATE revisions SET status = 'archived' WHERE world_id = ? AND status = 'current'
      AND EXISTS (SELECT 1 FROM revisions candidate WHERE candidate.id = ? AND candidate.status = 'uploading')
    `).bind(worldId, uploadId),
    db.prepare(`UPDATE revisions SET status = 'current', finalized_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'uploading'`).bind(uploadId),
    db.prepare(`UPDATE worlds SET current_revision = (SELECT revision_number FROM revisions WHERE id = ?), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND EXISTS (SELECT 1 FROM revisions WHERE id = ? AND status = 'current')
    `).bind(uploadId, worldId, uploadId),
    // Keep the current revision plus the four most recent archived revisions.
    // Mark first; physical deletion is retried separately and never targets current.
    db.prepare(`UPDATE revisions SET status = 'pending_delete'
      WHERE world_id = ? AND status = 'archived'
        AND revision_number NOT IN (
          SELECT revision_number FROM revisions WHERE world_id = ? AND status IN ('current', 'archived')
          ORDER BY revision_number DESC LIMIT 5
        )
        AND EXISTS (SELECT 1 FROM revisions WHERE id = ? AND status = 'current')
    `).bind(worldId, worldId, uploadId),
  ]);
  const result = await ownedUpload(db, worldId, uploadId, identity);
  if (result.status === "conflict") throw new ApiError(409, "upload_conflict", "The host lease or base revision changed. Uploaded content has been preserved.");
  // Metadata is already committed. A deletion failure leaves pending_delete
  // for the next cleanup run rather than invalidating a successful upload.
  await cleanupRetention(db, bucket, worldId);
  return json({ revision: publicRevision(result) });
}

export async function cleanupRetention(db: D1Database, bucket: R2Bucket, worldId?: string): Promise<number> {
  const statement = worldId
    ? db.prepare("SELECT id, object_key FROM revisions WHERE world_id = ? AND status = 'pending_delete' ORDER BY finalized_at LIMIT 100").bind(worldId)
    : db.prepare("SELECT id, object_key FROM revisions WHERE status = 'pending_delete' ORDER BY finalized_at LIMIT 100");
  const { results } = await statement.all<{ id: string; object_key: string }>();
  let deleted = 0;
  for (const row of results) {
    try {
      await bucket.delete(row.object_key);
      const changed = await db.prepare("UPDATE revisions SET status = 'deleted' WHERE id = ? AND status = 'pending_delete'")
        .bind(row.id).run();
      deleted += changed.meta.changes;
    } catch {
      // No object key or database error details in logs. A later call retries.
      console.error("Retention cleanup failed; pending deletion will be retried.");
    }
  }
  return deleted;
}

export async function restoreRevision(request: Request, db: D1Database, bucket: R2Bucket, worldId: string, revision: number, identity: Identity): Promise<Response> {
  const world = await getWorld(db, worldId, identity.userId);
  if (world.role !== "owner") throw new ApiError(403, "owner_required", "Only the world owner may restore a revision.");
  const body = await readBody(request);
  const expectedRevision = revisionNumber(body.expectedRevision);
  const hash = await leaseHash(body.lockToken);
  const source = await db.prepare("SELECT * FROM revisions WHERE world_id = ? AND revision_number = ? AND status IN ('current', 'archived')")
    .bind(worldId, revision).first<Revision>();
  if (!source) throw new ApiError(404, "revision_not_found", "Revision is unavailable for restore.");
  const original = await bucket.get(source.object_key);
  if (!verifiedObject(original, source)) {
    if (original) await original.body.cancel();
    throw new ApiError(503, "storage_integrity_error", "The selected revision is unavailable or does not match its checksum.");
  }
  const id = crypto.randomUUID();
  const key = `worlds/${worldId}/restores/${id}.zip`;
  // Reserve a new number, retaining the original object and audit history.
  const reserved = await db.prepare(`
    INSERT INTO revisions (id, world_id, revision_number, base_revision_number,
      object_key, sha256, file_size_bytes, uploaded_by_device_id, upload_lease_hash, upload_expires_at)
    SELECT ?, w.id, (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM revisions WHERE world_id = w.id),
      ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours')
    FROM worlds w WHERE w.id = ? AND w.current_revision = ?
      AND w.locked_by_device_id = ? AND w.lock_token_hash = ? AND w.lock_expires_at > ${NOW}
      AND EXISTS (SELECT 1 FROM world_members WHERE world_id = w.id AND user_id = ? AND role = 'owner')
      AND EXISTS (SELECT 1 FROM revisions WHERE id = ? AND status IN ('current', 'archived'))
    RETURNING id
  `).bind(id, expectedRevision, key, source.sha256, source.file_size_bytes, identity.deviceId,
    hash, worldId, expectedRevision, identity.deviceId, hash, identity.userId, source.id).first<{ id: string }>();
  if (!reserved) {
    await original!.body.cancel();
    throw new ApiError(409, "restore_not_allowed", "An owner host lease at the current revision is required.");
  }
  try {
    const copied = await bucket.put(key, original!.body, { sha256: source.sha256,
      onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/zip", cacheControl: "no-store" } });
    if (!verifiedObject(copied, source)) throw new Error("Restore copy was not verified.");
  } catch {
    throw new ApiError(503, "restore_copy_failed", "Could not copy the selected revision. The current save is unchanged.");
  }
  const finalizeRequest = new Request(request.url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId: id, lockToken: body.lockToken }) });
  const response = await finalizeUpload(finalizeRequest, db, bucket, worldId, identity);
  if (response.status !== 200) return response;
  const result = await response.json() as { revision: ReturnType<typeof publicRevision> };
  return json({ revision: result.revision, restoredFromRevision: revision }, 201);
}

export async function listRevisions(db: D1Database, worldId: string, identity: Identity): Promise<Response> {
  await getWorld(db, worldId, identity.userId);
  const { results } = await db.prepare("SELECT * FROM revisions WHERE world_id = ? AND status IN ('current', 'archived', 'conflict') ORDER BY revision_number DESC LIMIT 100")
    .bind(worldId).all<Revision>();
  return json({ revisions: results.map(publicRevision) });
}

export async function download(db: D1Database, bucket: R2Bucket, worldId: string, identity: Identity, revision?: number): Promise<Response> {
  const world = await getWorld(db, worldId, identity.userId);
  const row = await db.prepare("SELECT * FROM revisions WHERE world_id = ? AND revision_number = ? AND status IN ('current', 'archived', 'conflict')")
    .bind(worldId, revision ?? world.currentRevision).first<Revision>();
  if (!row) throw new ApiError(404, "revision_not_found", "No downloadable revision exists.");
  const object = await bucket.get(row.object_key);
  if (!verifiedObject(object, row)) {
    if (object) await object.body.cancel();
    throw new ApiError(503, "storage_integrity_error", "Save content is unavailable or does not match its recorded checksum.");
  }
  return new Response(object!.body, { headers: {
    "content-type": "application/zip", "content-length": String(row.file_size_bytes),
    "content-disposition": `attachment; filename="revision-${row.revision_number}.zip"`,
    "cache-control": "no-store", "x-content-type-options": "nosniff",
    "x-save-sha256": row.sha256, "x-save-revision": String(row.revision_number),
  } });
}
