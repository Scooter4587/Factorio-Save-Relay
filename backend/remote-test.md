# Manually connect a private Cloudflare test service

The account flow documented below is implemented and verified locally on the
current development branch. It is not yet live at `scooteruniverse.eu`.
Before updating the existing service, apply migration `0004_account_login.sql`
to its existing D1 database and set `ACCOUNT_PEPPER` on the Worker; deploying
the new code without both would leave account login unavailable. Existing
token-only accounts can add a username and password with their original token.

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
2. On a new installation, create `factorio-save-relay-test` D1 and R2 resources
   with Wrangler. Keep the R2 bucket private and Standard; leave public `r2.dev`
   access disabled. On the existing pilot, reuse its D1 database and R2 bucket.
3. On a new installation, copy `wrangler.remote.example.jsonc` to
   `wrangler.remote.jsonc` and fill in the D1 database ID. The real config is
   ignored by Git. On the existing pilot, keep its current ignored config.
4. Run `npx wrangler d1 migrations apply factorio-save-relay-test --remote
   --config wrangler.remote.jsonc`. This creates tables in the **new remote**
   database migrations. It preserves existing users, worlds and save metadata;
   local Factorio saves are unaffected.
5. Generate a random account password pepper in PowerShell:

   ```powershell
   $bytes = [byte[]]::new(32)
   [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
   [Convert]::ToHexString($bytes)
   ```

   Save it privately, then run
   `npx wrangler secret put ACCOUNT_PEPPER --config wrangler.remote.jsonc`.
   Never put it in a repository file. On a new installation, separately
   generate and set `REGISTRATION_KEY` the same way. On the existing pilot,
   keep its current registration key; it is only needed when creating an account.
6. Run `npx wrangler deploy --config wrangler.remote.jsonc`. Wrangler connects
   only the `/factorio-relay` paths to this Worker; the existing Pages site
   continues to handle other paths. Open `<workers.dev URL>/health` and
   `https://scooteruniverse.eu/factorio-relay` to verify both. The browser
   panel lets each player create an account, create/join the world and manually
   exchange ZIP copies. Save each displayed emergency recovery code privately.
   The Windows app signs in to the same account using the `workers.dev` base URL.

The template schedules daily retention cleanup. A failed cleanup stays pending
for a later run. Existing device tokens continue to work after registration is
disabled. The R2 bucket must remain private.

This intermediary Worker relay is a **temporary small-save test path**. A
production-ready transfer requires direct signed R2 uploads, more failure
testing and the automatic game workflow. Cloudflare's [Worker request body
limits](https://developers.cloudflare.com/workers/platform/limits/) and
[R2 signed URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
explain why.
