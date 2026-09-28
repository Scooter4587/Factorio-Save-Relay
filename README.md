# Factorio Save Relay

Self-hosted save synchronization for alternating Factorio multiplayer hosts.

> [!WARNING]
> This project is a private pilot. Keep the original Factorio save until the
> two-computer RELAY workflow has been validated with the real game.

Factorio Save Relay is intended for small multiplayer groups that want to rotate
the host without manually sending save files after every session. A Windows
client coordinates through a Cloudflare-hosted API, stores save
revisions in R2, and keep multiplayer worlds from silently splitting into two
conflicting histories.

## Safety principles

- Never overwrite a local save until the download and SHA-256 hash are verified.
- Never promote an upload unless it is based on the current cloud revision.
- Only the device holding the renewable host lease may publish a new revision.
- Preserve conflicts for recovery without ever installing them automatically.
- Keep exactly the current revision plus four recent recoverable revisions.
- Never commit credentials, access tokens, or real save files.

## Planned architecture

| Component | Technology | Responsibility |
| --- | --- | --- |
| Windows client | C# / .NET WPF | Host workflow, save detection, validation, upload and download |
| API | Cloudflare Workers / TypeScript | Authentication, membership, leases and revision coordination |
| Metadata | Cloudflare D1 | Users, devices, worlds, invites and revision history |
| Save storage | Cloudflare R2 | Private immutable Factorio save archives |
| Browser panel | Worker-hosted Web UI | Account sign-in, pairing, members and emergency manual ZIP handoff |

See [docs/architecture.md](docs/architecture.md) for the initial technical design.

## Repository layout

```text
backend/     Cloudflare Worker API and D1 migrations
client/      Windows desktop client
backend/src/web*   Private browser panel served by the Worker
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
[backend/README.md](backend/README.md) for the API contract. Remote deployment
requires separate D1 and private R2 resources; GitHub updates alone do not
deploy the Worker.

## Windows client development

The client targets .NET 10 for Windows and will be published as a self-contained
application. From a Windows machine with the .NET 10 SDK:

```powershell
dotnet build client/FactorioSaveRelay.Client/FactorioSaveRelay.Client.csproj
```

The app signs in to an account already created and paired on the web. Its first
setup creates a separate `<original name> RELAY.zip` in the Factorio saves
folder, while the original stays untouched. See [client/README.md](client/README.md)
for the exact host handoff and file-safety rules.
The [remote service guide](backend/remote-test.md) covers the private Worker
and browser panel at `scooteruniverse.eu/factorio-relay`. It is limited to
small ZIPs until direct R2 upload is implemented.

Account registration and sign-in are deployed on the private pilot URL. The
Windows download is presented only after browser sign-in; the app itself still
requires the user's account before it can access a world or save.

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
- [x] Automatic upload of stable changes to a selected test ZIP while hosting
- [x] Private manual browser panel for two players, with verified ZIP handoff
- [x] Local private-pilot account registration, password sign-in and recovery
- [x] Local web onboarding for creating or joining the shared world
- [x] Deploy account onboarding to the private test service
- [x] Authenticated Windows app download endpoint (local; deployment pending)
- [x] Copy-based RELAY save naming and verified automatic synchronization (local)
- [ ] Direct R2 upload and verified download
- [x] Backend five-revision retention and restore (local)
- [ ] Deploy the current Worker migration and Windows build
- [ ] End-to-end two-device Factorio test

## Trademark notice

Factorio Save Relay is an unofficial community project. It is not affiliated
with, sponsored by, or endorsed by Wube Software Ltd. Factorio is a trademark
of Wube Software Ltd.

## License

This repository is licensed under the terms in [LICENSE](LICENSE).
