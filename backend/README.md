# Backend

The backend coordinates identities, world membership, renewable host leases and
immutable save revisions. Large save files will move directly between the
Windows client and private R2 storage; the Worker will authorize the operation
and manage metadata in D1.

## Local commands

```bash
npm install
npm run check
npm run deploy:dry
npm run dev
```

The initial D1 schema is in `migrations/0001_initial.sql`. Bindings will be added
to `wrangler.jsonc` after the Cloudflare resources are provisioned.
