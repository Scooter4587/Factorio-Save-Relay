# Initial architecture

## Scope

The first supported workflow is one Factorio multiplayer world shared by two
Windows users who alternate hosting. Supporting arbitrary games, merging two
save histories, background dedicated hosting and modifying Factorio save data
are explicit non-goals for the MVP.

## Trust boundaries

1. The Windows client may read and replace only the save selected by the user.
2. Device credentials are stored locally and sent only over HTTPS.
3. The Worker authorizes operations but does not receive long-lived Cloudflare
   credentials from a client.
4. R2 objects are private and immutable after a revision is finalized.
5. D1 is the authority for membership, the current revision and the active host
   lease.

## World state

Each world has one monotonically increasing current revision. A client must pull
that revision before it can acquire the host lease. While hosting, the client
renews a short lease. A finalized upload is promoted only when its base revision
still equals the world's current revision.

If that comparison fails, the uploaded object is retained as a conflict and is
never installed automatically on another device.

## Client state machine

```text
Unconfigured -> Ready -> Pulling -> ReadyToHost -> Hosting -> Uploading -> Ready
                   |         |           |             |
                   +-------> Error <------+----------> Conflict
```

The client must never replace a local save while Factorio is running. Downloads
are written to a temporary file, validated, hashed and atomically moved into
place only after the game exits.

## Upload protocol

1. Acquire or renew the host lease.
2. Request an upload for `baseRevision`.
3. Upload the completed ZIP to a private, revision-specific R2 key.
4. Finalize with size and SHA-256 metadata.
5. Atomically archive the previous current revision and promote the new one.
6. Mark revisions outside the five-version retention window for deletion.

Interrupted uploads remain non-current and are cleaned up later.

## Restore protocol

Restore never rewrites history. The selected old object is copied into a new,
monotonically numbered revision so that the restore itself can be audited and
reversed.

## Authentication plan

The MVP uses application identities rather than passwords:

- a user has one or more devices;
- each device owns a randomly generated bearer credential;
- only a salted hash is stored in D1;
- one-time, expiring invites add another user to a specific world;
- credentials are stored with Windows Credential Manager.

Interactive email or third-party login can be added later without changing the
world and revision model.
