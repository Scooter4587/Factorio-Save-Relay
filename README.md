# Factorio Save Relay

Self-hosted save synchronization for alternating Factorio multiplayer hosts.

> [!WARNING]
> This project is an early prototype. Do not use it as the only copy of a valuable
> save until the restore and failure-recovery paths have been validated.

Factorio Save Relay is intended for small multiplayer groups that want to rotate
the host without manually sending save files after every session. A Windows
client will coordinate through a Cloudflare-hosted API, store immutable save
revisions in R2, and keep multiplayer worlds from silently splitting into two
conflicting histories.

## Safety principles

- Never overwrite a local save until the download and SHA-256 hash are verified.
- Never promote an upload unless it is based on the current cloud revision.
- Only the device holding the renewable host lease may publish a new revision.
- Preserve conflicts instead of guessing which save is correct.
- Keep the five most recent finalized revisions by default.
- Never commit credentials, access tokens, or real save files.

## Planned architecture

| Component | Technology | Responsibility |
| --- | --- | --- |
| Windows client | C# / .NET WPF | Host workflow, save detection, validation, upload and download |
| API | Cloudflare Workers / TypeScript | Authentication, membership, leases and revision coordination |
| Metadata | Cloudflare D1 | Users, devices, worlds, invites and revision history |
| Save storage | Cloudflare R2 | Private immutable Factorio save archives |
| Dashboard | Web UI | Status, history, restore and emergency unlock |

See [docs/architecture.md](docs/architecture.md) for the initial technical design.

## Repository layout

```text
backend/     Cloudflare Worker API and D1 migrations
client/      Windows desktop client
dashboard/   Web dashboard (planned after the sync core is proven)
docs/        Architecture and development notes
```

## Backend development

Requirements: Node.js 22 or newer and a Cloudflare account for remote deployment.

```bash
cd backend
npm install
npm run check
npm test
npm run db:migrate:local
npm run dev
```

The local health endpoint is `GET /health`. Local development uses a separate
configuration and local D1 database; no Cloudflare account or domain is needed.
With the server running, `npm run demo:local` verifies that two users can share a
world through a one-time invitation. `npm run demo:transfer` sends synthetic ZIP
revisions in both directions using two fresh test directories. See
[backend/README.md](backend/README.md) for the API contract. Remote D1 and R2
resources are not provisioned yet.

## Windows client development

The client targets .NET 10 for Windows and will be published as a self-contained
application. From a Windows machine with the .NET 10 SDK:

```powershell
dotnet build client/FactorioSaveRelay.Client/FactorioSaveRelay.Client.csproj
```

The manual test client works with localhost or a private HTTPS test service and
only accepts copies outside the real Factorio saves folder. See
[client/README.md](client/README.md) for startup steps and file-safety limits.
The [remote service guide](backend/remote-test.md) prepares two-PC testing
without a personal domain; it is limited to small ZIPs until direct R2 upload
is implemented.

## Project status

- [x] Repository bootstrap
- [x] API health endpoint
- [x] Initial D1 schema
- [x] Windows client shell
- [x] Backend device registration and authentication (local)
- [x] Backend world creation and invitation flow (local)
- [x] Local Windows client registration and Windows Credential Manager storage
- [x] Backend host lease acquisition, renewal and release (local)
- [x] Local ZIP upload/finalize, revision history and verified transfer demo
- [x] Manual local Windows client with verified download and local backup
- [x] Portable Windows test build and HTTPS service connection
- [ ] Direct R2 upload and verified download
- [x] Backend five-revision retention and restore (local)
- [ ] End-to-end two-device test

## Trademark notice

Factorio Save Relay is an unofficial community project. It is not affiliated
with, sponsored by, or endorsed by Wube Software Ltd. Factorio is a trademark
of Wube Software Ltd.

## License

This repository is licensed under the terms in [LICENSE](LICENSE).
