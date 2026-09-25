# Manually connect a private Cloudflare test service

This prepares a two-PC test with **copies** of a Factorio save. The service
uses a `workers.dev` HTTPS address, so no personal domain is needed. Do not
use the only copy of an existing world. The current Worker relay accepts at
most 90,000,000-byte ZIPs remotely; larger saves need direct R2 upload. The
app does not yet watch or replace the live game save.

1. Install Node.js 22+, open PowerShell in `backend/`, run `npm ci` and
   `npx wrangler login` with your Cloudflare account. Do this yourself; do
   not share Cloudflare credentials or API tokens.
2. Run `npx wrangler d1 create factorio-save-relay-test` and
   `npx wrangler r2 bucket create factorio-save-relay-test`. Keep the R2 bucket
   private; leave public `r2.dev` access disabled.
3. Copy `wrangler.remote.example.jsonc` to `wrangler.remote.jsonc` and replace
   `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the ID from step 2. The real config
   file is ignored by Git. If you chose another bucket/database name, update
   the names in the copied config.
4. Run `npx wrangler d1 migrations apply factorio-save-relay-test --remote
   --config wrangler.remote.jsonc`. This creates tables in the **new remote**
   test database; local data and Factorio saves are unaffected.
5. Generate a random registration key in PowerShell:

   ```powershell
   $bytes = [byte[]]::new(32)
   [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
   [Convert]::ToHexString($bytes)
   ```

   Save it privately, then run
   `npx wrangler secret put REGISTRATION_KEY --config wrangler.remote.jsonc`
   and enter the key at the prompt. Never put it in a repository file. Anyone
   with this key can register another test user, so share it only with the
   second player through a private channel.
6. Run `npx wrangler deploy --config wrangler.remote.jsonc`. Wrangler prints
   a `https://...workers.dev` URL. Open `<URL>/health` to verify the service.
   Enter the base URL in both Windows apps. Each player enters the registration
   key once and registers their own profile. The app keeps each device token
   in Windows Credential Manager; the registration key is not stored.

The template schedules daily retention cleanup. A failed cleanup stays pending
for a later run. After both profiles exist, set `ALLOW_REGISTRATION` to
`"false"` in the copied config and redeploy. Existing device tokens continue
to work. The R2 bucket must remain private.

This intermediary Worker relay is a **temporary small-save test path**. A
production-ready transfer requires direct signed R2 uploads, more failure
testing and the automatic game workflow. Cloudflare's [Worker request body
limits](https://developers.cloudflare.com/workers/platform/limits/) and
[R2 signed URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
explain why.
