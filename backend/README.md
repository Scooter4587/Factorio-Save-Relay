# Backend

The Worker currently implements device identities, world ownership, membership,
one-time invitations, renewable host leases and local two-phase ZIP transfers.
The Windows test app uses these endpoints with ZIP copies.

## Local development

Requires Node.js 22 or newer. From `backend/`:

```bash
npm ci
npm run db:migrate:local
npm run dev
```

The API listens on `http://127.0.0.1:8787`. Both commands explicitly use
`wrangler.local.jsonc` and local storage. The D1 ID in that file is a placeholder,
not a Cloudflare resource. No account, domain, R2 bucket or deployment is needed.
Local database files live in ignored `.wrangler/` storage.

With the server running, open a second terminal in `backend/`:

```bash
npm run demo:local
npm run demo:transfer
```

The demo registers two disposable users, creates a world, redeems an invitation
and checks that both users see the same world. It then acquires Adam's host lease,
checks that the friend is blocked, renews and releases it, and hands hosting to
the friend. Each run creates new local data.
It never prints or saves the raw credentials and does not touch Factorio saves.
The transfer demo additionally generates two synthetic ZIPs, sends revisions in
both directions and checks downloaded size, SHA-256 and exact fixture bytes.
It writes to new `artifacts/transfer-demo-*/adam` and `friend` directories only;
downloads are first written as `.download` files and renamed after verification.
These fixtures are valid archives, not playable Factorio worlds. Source files are
preserved and no existing Factorio save path is accepted by the demo.

## Validation

```bash
npm run check
npm test
npm run deploy:dry
```

Tests bundle the real Worker and run HTTP requests against Miniflare with a fresh
temporary D1 database initialized from the migration. They cover permissions,
revoked credentials, expired/reused invitations, concurrent redemption, input
validation, transaction rollback, concurrent host claims, expired/stale leases,
interrupted/corrupt transfers, concurrent finalization and ZIP decompression/CRC.
No remote bindings or credentials are used.
Miniflare and esbuild are pinned to the versions already used by Wrangler.

## API contract

All bodies and responses are JSON. Authenticated endpoints require
`Authorization: Bearer <device-token>`. Responses use `Cache-Control: no-store`.
Request JSON is limited to 4096 bytes; names are trimmed, non-empty and at most
80 characters, with no control characters. IDs and membership roles are assigned
by the server, never trusted from request fields.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/health` | none | Public service health |
| GET | `/v1/version` | none | Public version |
| POST | `/v1/devices/register` | `{ "displayName": "Adam", "deviceName": "Adam PC" }` | 201: `{ user, device, token }` |
| GET | `/v1/me` | none | `{ identity: { userId, displayName, deviceId, deviceName } }` |
| POST | `/v1/worlds` | `{ "name": "Pyanodon" }` | 201: `{ world }`, caller is owner |
| GET | `/v1/worlds` | none | `{ worlds: [...] }`, only caller's memberships |
| GET | `/v1/worlds/{id}` | none | `{ world }`, members only |
| POST | `/v1/worlds/{id}/invites` | none | 201: `{ invite: { id, worldId, code, expiresAt } }`, owner only |
| POST | `/v1/invites/redeem` | `{ "code": "<invite-code>" }` | `{ world }`, caller becomes member |
| POST | `/v1/worlds/{id}/lock/acquire` | `{ "expectedRevision": 0 }` | 201: `{ lease }`, world members only |
| POST | `/v1/worlds/{id}/lock/renew` | `{ "lockToken": "<lease-token>" }` | `{ lease }`, owning device/session only |
| POST | `/v1/worlds/{id}/lock/release` | `{ "lockToken": "<lease-token>" }` | `{ released: true, worldId }` |

A `world` contains `id`, `name`, `ownerUserId`, `currentRevision`, caller's `role`
and `createdAt`, plus `hostDeviceId` and `hostLeaseExpiresAt`. The host fields
are null when no active lease exists; no lease secret is exposed. Revision is
zero before the first finalized upload.

Registration currently creates one new user and one device every time. A display
name is a label, not a login or proof of identity. Linking another device to an
existing user and credential rotation/recovery are future work. The raw device
token is returned only at creation and the Windows app stores it in Credential
Manager. A hosted service requires a separate `REGISTRATION_KEY` Worker secret;
the app sends it only on registration and never persists it.

Device tokens and invitation codes contain a UUID salt plus 256 random bits.
D1 stores only SHA-256 hashes of the complete tokens. Invitation codes are opaque
copy/paste strings, not the short human-readable codes in the initial sketch.
Invites expire after 24 hours according to database time. Only the world owner
can create them. A successful redemption consumes the invitation and creates the
membership in one D1 transaction. Only one concurrent redemption can succeed.
Existing members cannot consume a new invitation; replaying an old invitation
cannot restore a removed membership.

## Host leases

Acquisition atomically checks membership, the current revision and whether an
existing lease is still active. `expectedRevision` must be a non-negative safe
integer. Clients must download/verify the current revision before acquisition;
if a competing revision is published in between, acquisition fails and the
client must refresh before trying again. The API revision check is not proof
that a client has downloaded the save; that validation belongs in the client.

A lease contains `worldId`, `deviceId`, `expiresAt`, `ttlSeconds` (180), and
`renewAfterSeconds` (60). Acquisition additionally returns `token` once. Renewal
extends expiry from database time and does not return the token again. Store the
token for that host session; losing it means waiting for expiry before acquiring
another lease. Even the current device cannot acquire a second active lease.

Renew/release require both the owning device credential and the current lease
token. Expired leases cannot be renewed or released; a new acquisition generates
a new secret, so delayed requests from the previous session cannot alter it.
Only the token hash is stored in D1. Expiry uses database time, not PC clocks.
Normal release clears all lock fields. Expired rows can remain in storage but
are reported as inactive and can be replaced by the next valid acquisition.

Acquisition returns 409 `lease_unavailable` for an occupied world or revision
mismatch. Renewal/release return 409 `lease_lost` when the lease no longer belongs
to that active device/session. The client must stop publishing on lease loss;
the upload/finalize endpoints independently enforce that rule.
This API does not prevent someone manually starting Factorio outside the client.
Membership removal or device revocation blocks subsequent lease operations;
the outstanding lease expires naturally. Force-unlock is not implemented yet.

## Local save transfer protocol

The separate local configuration enables `ALLOW_LOCAL_TRANSFERS="true"` and an
emulated private R2 bucket named `SAVES`. Run `npm run db:migrate:local` after
updating an existing checkout to apply `0002_upload_sessions.sql`. Transfer
endpoints are disabled by default in the deployment configuration.

| Method | Path | Body / result |
| --- | --- | --- |
| POST | `/v1/worlds/{id}/uploads/begin` | `{ baseRevision, lockToken, sha256, fileSize }` -> 201 `{ upload }` |
| PUT | `/v1/worlds/{id}/uploads/{uploadId}/content` | ZIP bytes, `Content-Type: application/zip`, exact `Content-Length`, `X-Relay-Lock: <lease-token>` |
| POST | `/v1/worlds/{id}/uploads/finalize` | `{ uploadId, lockToken }` -> `{ revision }` |
| GET | `/v1/worlds/{id}/download` | Current finalized ZIP; 404 before the first upload |
| GET | `/v1/worlds/{id}/revisions` | `{ revisions }`, newest 100 finalized/conflict records |
| GET | `/v1/worlds/{id}/revisions/{number}/download` | Explicit archived or conflict download for world members |
| POST | `/v1/worlds/{id}/revisions/{number}/restore` | `{ expectedRevision, lockToken }` -> 201 `{ revision, restoredFromRevision }`, owner only |

All requests require the device bearer credential. Begin and content upload
require an active lease at the current base revision. Begin reserves a unique
revision number and immutable random R2 object key; gaps from abandoned uploads
are expected. The response contains `id`, `revision`, `baseRevision`, `sha256`,
`fileSize`, `expiresAt` and a relative `contentPath`. The session expires after
24 hours and remains tied to the original acquisition's lease token.

PUT streams bytes to R2 with the declared SHA-256 checksum and a create-only
condition. R2 verifies the checksum. Repeating the same PUT can return success
for the already verified immutable object, but cannot overwrite it. A failed
or interrupted upload never changes the world's current revision. The API caps
this local transport at 512 MiB per ZIP; this is not a production Workers limit
or a claim that large saves have been performance-tested. For a non-local
Worker address, begin rejects ZIPs above 90,000,000 bytes before transfer. The
interim relay transport cannot carry larger saves on a Free/Pro Cloudflare zone;
direct-to-R2 uploads are still required for those.

Finalize checks stored size/checksum and validates the ZIP32 central/local
records, entry boundaries, decompression, uncompressed sizes and entry CRC32s.
Validation streams entry output to counters without extracting files to disk.
The supported subset is a non-empty, single-disk, unencrypted archive using
STORE or DEFLATE, with at most 2,048 entries, a 4 MiB directory and 2 GiB total
expanded data. Data descriptors are supported; ZIP64, other compression methods,
self-extracting prefixes and arbitrary padding are rejected. This checks ZIP
integrity, not whether Factorio can load the world with the installed game/mods.

After validation, a single D1 transaction rechecks the lease and base revision,
archives the old current revision and promotes the new one. Only one competing
candidate can succeed. If the lease, membership, session expiry or base revision
changed, the upload is preserved as a conflict and finalize returns 409
`upload_conflict`. An already successful finalize can be retried idempotently,
including after the revision becomes archived. It never rolls back the world.

Downloads are restricted to members. They stream immutable content only when its
R2 size and SHA-256 metadata match D1, and expose `X-Save-Sha256`, `X-Save-Revision`
and `Content-Length`. Clients must independently verify the received bytes before
replacing any local file. Incomplete uploads never appear as downloadable
revisions. Storage loss/integrity mismatch returns 503; bad uploaded bytes or
invalid archives return 422; mismatched size headers return 400.

Each successful finalize retains the current revision plus the four newest
archived revisions. Older finalized records are first marked `pending_delete`;
only then are their R2 objects deleted and records marked `deleted`. A deletion
failure leaves the record pending for the next cleanup call. Conflicts are
preserved separately. The cleanup handler can also be scheduled after remote
resources are provisioned; there is no production cron or binding yet.

Restore requires the owner's active host lease and the expected current
revision. It copies the selected current/archived object's verified bytes into
a new immutable object and promotes a *new* revision through the same finalize
checks. The original revision and audit trail remain intact. Missing, deleted
or conflict revisions cannot be restored through this endpoint.

Still pending: direct short-lived R2 transfer URLs, cleanup of abandoned uploads,
production scheduling and automatic real-save host workflow. The Windows
client supports a manual workflow with copies outside Factorio's real saves
folder, on localhost or the limited HTTPS test service. Do not use this relay
transport as the production service.

The private test service has application-level cost guards: at most 1 GB of
reserved non-deleted revision bytes and monthly ceilings of 10,000 R2 Class A
and 500,000 Class B operations through this Worker. Upload and restore
reservations are atomic across worlds; R2 reads and writes reserve an operation
in D1 before accessing the bucket. These limits do not cover other access to
the Cloudflare account and are not a guarantee against an invoice. See
[remote-test.md](remote-test.md) before remote deployment.
The remote template enables `PRIVATE_PILOT="true"`, which limits the service
to two registered players and one world. The local development config leaves
this unset so tests can create more fixtures.

References: [R2 integrity/conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
and [PKWARE ZIP format](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).

Errors use `{ "error": { "code": "...", "message": "..." } }`:

- 400: invalid JSON, fields or invitation format.
- 401: missing, invalid or revoked device credential.
- 403: registration disabled or a member attempts an owner-only action.
- 404: unknown endpoint or a world inaccessible to the caller.
- 409: unknown, expired, consumed invitation, or caller is already a member.
- 413 / 415: oversized body / unsupported content type.
- 503: D1 binding missing; 500: unexpected internal failure, with no DB details.

## Deployment boundary

`wrangler.jsonc` remains the unprovisioned deployment configuration. The separate
`wrangler.remote.example.jsonc` is a template for a small private test service;
see [remote-test.md](remote-test.md). Registration requires both
`ALLOW_REGISTRATION="true"` and the `REGISTRATION_KEY` secret on a remote URL.
The intentionally keyless local mode works only when
`ALLOW_INSECURE_LOCAL_REGISTRATION="true"` and the request is addressed to
localhost. Never deploy `wrangler.local.jsonc` as a public test service.

D1 batch operations provide transaction rollback as described in the
[Cloudflare D1 documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
