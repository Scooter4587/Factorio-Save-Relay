# Windows client — manual test

This .NET 10 WPF client connects to localhost or an HTTPS test service. For the
hosted private pilot, create and pair accounts on the web first, then use
**Sign in on this PC** with the same account name and password. The app stores
its device credential in Windows Credential Manager, not the password.
The legacy local test registration remains for the two-window development demo.
The client can create/join a shared world, acquire and renew the host
lease, upload a stable selected ZIP automatically while hosting, download the
current revision and restore a
retained revision. Credentials are stored in Windows Credential Manager under
the current Windows user, keyed by service URL and profile name. A registration
token is not written to the repository or displayed in the interface. A hosted
service requires a separate registration key only when creating an account on
the web; the key is not saved by the app. See [the remote service guide](../backend/remote-test.md)
when ready for a two-PC test.

## Start the local service

From `backend/`:

```powershell
npm ci
npm run db:migrate:local
npm run dev
```

This uses an emulated D1 database and a private local R2 bucket. The service
listens on `http://127.0.0.1:8787`; no domain or Cloudflare account is needed.

In a second PowerShell window at the repository root:

```powershell
dotnet run --project client/FactorioSaveRelay.Client/FactorioSaveRelay.Client.csproj
```

Open a second client window for a second profile if you want to see both users
at once. The service and both windows must run on the same PC for this test.

To create a portable Windows test build, run `client/publish-test.ps1` from
PowerShell at the repository root. It produces a self-contained ZIP in ignored
`artifacts/`; copy the archive to the second Windows PC and extract it before
running `FactorioSaveRelay.exe`. GitHub CI also attaches a short-lived Windows
test build to each PR run. The executable is not signed or installed as a
Windows service and must be opened manually.

## Test with copies

1. Create two separate folders outside `%APPDATA%\Factorio\saves`, such as
   `backend/artifacts/manual-test/adam` and `backend/artifacts/manual-test/friend`.
   Only use ZIP copies here. The client refuses to select the real Factorio
   saves folder, a linked path or a junction.
2. In the first window enter profile `Adam` and register. Create a world and
   invitation; copy the one-time code.
3. Select an existing valid ZIP **copy** in Adam's test folder. Acquire host
   lease and wait for the automatic upload status, then release the lease.
4. In the second window register profile `Friend`, paste the invitation and
   join. Choose a ZIP target in Friend's test folder, then download latest.
   If a target exists, its previous bytes are saved as a sibling
   `.relay-backup-*.zip` before atomic replacement.
5. Friend can acquire the lease. After changing only the test ZIP copy to a
   different valid archive, wait for its automatic upload and release. Adam
   can then download the newer revision and keep a local backup.

The client checks downloaded size, SHA-256 and ZIP readability before any local
replacement. A download is staged as a `.download-*` file in the same folder.
If Factorio is running, the file stays pending until you close the game and
click **Apply pending download**. The client does not close or control Factorio.
Keep the client open until applying a pending download; recovery of a pending
file after restarting the app is not implemented yet.
The client watches the selected ZIP while holding the host lease and also polls
its size and modified time every five seconds. It waits for a stable file,
validates a separate upload snapshot and sends only changed content. Releasing
the lease attempts one final upload and refuses to release while Factorio is
running or the file is changing. The selected source file is never edited by
the transfer. An active lease renews every minute; losing it blocks publishing.

**This is still a test-copy workflow.** The client does not launch Factorio or
watch the real game's save folder. It intentionally blocks that folder, and
remote testing needs your own private Cloudflare service. The current remote
Worker relay accepts only ZIPs up to 90,000,000 bytes. Automatic download,
real-game integration, direct R2 uploads and a production installer are
still pending. A ZIP can pass archive checks yet be incompatible with your
installed Factorio version or mods. Do not treat this stage as a production
save synchronizer.

The service has a synthetic file demo that never reads a Factorio save:

```powershell
cd backend
npm run demo:transfer
```

The client safety test creates only temporary ZIPs and validates backup,
checksum and game-running guards. With the local service running, `--api` also
tests the client's actual HTTP code with two disposable users:

```powershell
dotnet run --project client/FactorioSaveRelay.SafetyTests/FactorioSaveRelay.SafetyTests.csproj --configuration Release -- --api
```
