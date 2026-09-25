# Manually connect a private Cloudflare test service

This prepares a two-PC test with **copies** of a Factorio save. The service
also has a `workers.dev` HTTPS fallback. The browser panel is routed to
`https://scooteruniverse.eu/factorio-relay`. Do not
use the only copy of an existing world. The current Worker relay accepts at
most 90,000,000-byte ZIPs remotely; larger saves need direct R2 upload. The
app does not yet watch or replace the live game save.

## Cost limits for this test service

Keep the bucket **private** and in the **Standard** storage class, and keep the
Workers plan on **Free**. The Worker reserves the declared size of every pending
upload and restore before writing to R2. It rejects new reservations once all
non-deleted revisions would exceed **1,000,000,000 bytes (1 GB)** across the
entire service. It also stops this Worker's R2 operations at 10,000 Class A and
500,000 Class B reservations per UTC calendar month. Failed operations still
consume a reservation, so the limits fail closed. They are intentionally far
below R2 Standard's monthly free allowances.

These are **application limits, not a Cloudflare account spending cap**. R2's
free storage allowance is 10 GB-month, not a hard 10 GB bucket limit; Class A
and B operations have separate free allowances. Cloudflare budget alerts notify
after spending begins and do not stop usage. The guards only cover objects and
operations made through this Worker. Dashboard uploads, other API credentials,
other R2 buckets, future direct-to-R2 uploads, pricing changes or a Workers plan
upgrade are outside them. Do not create R2 API tokens or enable public bucket
access for this test. Check Cloudflare's Billable Usage dashboard during testing.
If a strict account-wide guarantee of a $0 invoice is required, do not deploy
the remote test service: Cloudflare does not provide that guarantee through
these application limits.
See Cloudflare's [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
and [budget alert behavior](https://developers.cloudflare.com/billing/manage/budget-alerts/).

The remote template also enables `PRIVATE_PILOT`. It allows at most **two
registered players and one world** in this service. Both limits are checked
inside database transactions, including simultaneous requests. The second
player joins the first world by invitation; they do not create another world.
Keep the registration key private. Once both players have registered, disable
registration in the config and redeploy to close enrollment completely.

1. Install Node.js 22+, open PowerShell in `backend/`, run `npm ci` and
   `npx wrangler login` with your Cloudflare account. Do this yourself; do
   not share Cloudflare credentials or API tokens.
2. Run `npx wrangler d1 create factorio-save-relay-test` and
   `npx wrangler r2 bucket create factorio-save-relay-test`. Keep the R2 bucket
   private and Standard; leave public `r2.dev` access disabled.
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
6. Run `npx wrangler deploy --config wrangler.remote.jsonc`. Wrangler connects
   only the `/factorio-relay` paths to this Worker; the existing Pages site
   continues to handle other paths. Open `<workers.dev URL>/health` and
   `https://scooteruniverse.eu/factorio-relay` to verify both. The browser
   panel lets each player register, create/join the world and manually exchange
   ZIP copies. Save each displayed device token privately. The Windows app
   remains available at the `workers.dev` base URL for its separate test flow.

The template schedules daily retention cleanup. A failed cleanup stays pending
for a later run. Existing device tokens continue to work after registration is
disabled. The R2 bucket must remain private.

This intermediary Worker relay is a **temporary small-save test path**. A
production-ready transfer requires direct signed R2 uploads, more failure
testing and the automatic game workflow. Cloudflare's [Worker request body
limits](https://developers.cloudflare.com/workers/platform/limits/) and
[R2 signed URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
explain why.
