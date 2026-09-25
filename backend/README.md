# Backend

The Worker currently implements device identities, world ownership, membership
and one-time invitations. Save transfers and host leases are not implemented yet.

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
```

The demo registers two disposable users, creates a world, redeems an invitation
and checks that both users see the same world. Each run creates new local data.
It never prints or saves the raw credentials and does not touch Factorio saves.

## Validation

```bash
npm run check
npm test
npm run deploy:dry
```

Tests bundle the real Worker and run HTTP requests against Miniflare with a fresh
temporary D1 database initialized from the migration. They cover permissions,
revoked credentials, expired/reused invitations, concurrent redemption, input
validation and transaction rollback. No remote bindings or credentials are used.
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

A `world` contains `id`, `name`, `ownerUserId`, `currentRevision`, caller's `role`
and `createdAt`. Revision is zero until save transfers are implemented.

Registration currently creates one new user and one device every time. A display
name is a label, not a login or proof of identity. Linking another device to an
existing user, credential rotation/recovery and the Windows Credential Manager
integration are future work. The raw device token is returned only at creation.

Device tokens and invitation codes contain a UUID salt plus 256 random bits.
D1 stores only SHA-256 hashes of the complete tokens. Invitation codes are opaque
copy/paste strings, not the short human-readable codes in the initial sketch.
Invites expire after 24 hours according to database time. Only the world owner
can create them. A successful redemption consumes the invitation and creates the
membership in one D1 transaction. Only one concurrent redemption can succeed.
Existing members cannot consume a new invitation; replaying an old invitation
cannot restore a removed membership.

Errors use `{ "error": { "code": "...", "message": "..." } }`:

- 400: invalid JSON, fields or invitation format.
- 401: missing, invalid or revoked device credential.
- 403: registration disabled or a member attempts an owner-only action.
- 404: unknown endpoint or a world inaccessible to the caller.
- 409: unknown, expired, consumed invitation, or caller is already a member.
- 413 / 415: oversized body / unsupported content type.
- 503: D1 binding missing; 500: unexpected internal failure, with no DB details.

## Deployment boundary

`wrangler.jsonc` remains the unprovisioned deployment configuration. Registration
is disabled unless `ALLOW_REGISTRATION` is explicitly `"true"`; it is enabled
only in the separate local configuration. Public deployment needs a real D1
binding, migrations, HTTPS and a deliberate registration/access and abuse-control
policy. Do not deploy `wrangler.local.jsonc` or treat its open local registration
as a production onboarding policy.

D1 batch operations provide transaction rollback as described in the
[Cloudflare D1 documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
