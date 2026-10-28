# Supabase Recordings Database

The hosted database for shared recordings (#116). Live playing never uses
it: camera, CV, audio and MIDI stay in the browser (see
[architecture](architecture.md)). Only server routes on Vercel talk to
Supabase, using a secret key that bypasses row level security.

| Piece | Where |
| :--- | :--- |
| Supabase project | `MakeShift`, ref `xaghnmxcdgdmpfzflnsj`, region `us-east-1` |
| Schema | [`supabase/migrations/`](../supabase/migrations/) |
| Secrets | Infisical project `makeshift`, environments `dev` and `prod` |
| Hosting | Vercel project `make-shift`, env vars synced from Infisical |
| Server access | [`frontend/src/server/supabase.ts`](../frontend/src/server/supabase.ts), route handlers in [`frontend/src/server/recordings.ts`](../frontend/src/server/recordings.ts) |
| API contract | [`frontend/src/lib/recordings.ts`](../frontend/src/lib/recordings.ts): request/response types and upload validation shared by routes and client |
| Health check | `GET /api/health`: `200 {"database":{"status":"ok"}}` when connected |

## Recordings routes

The share UI calls these through
[`shareApi.ts`](../frontend/src/app/share/shareApi.ts). Append `?mock=1`
(or `?mock=empty`, `?mock=error`) to a page URL to use the mock fixtures
instead, for example without Infisical access.

| Route | Result |
| :--- | :--- |
| `GET /api/recordings?cursor=` | `200` visible summaries, newest first, 6 per page; `nextCursor` is an opaque keyset cursor; `400` bad cursor |
| `GET /api/recordings/:id` | `200` with notes; `404` when missing, hidden or not a UUID |
| `POST /api/recordings` | `201 {id, deleteToken}`; `400` with `issues`; `413` over 1 MB; `503` on any Vercel deployment unless `RECORDING_UPLOADS=1` |
| `DELETE /api/recordings/:id` | `200 {deleted: true}` when the token's SHA-256 matches; `403` wrong or missing token; `404` already gone |

Every route returns `503` when Supabase is unconfigured and `502` when the
database fails, without echoing database messages. Uploads have no rate
limit yet, so they are refused on Vercel (production and preview) unless
`RECORDING_UPLOADS=1`; local `npm run dev` accepts them. Keep it unset in
`prod` until rate limiting lands (#122).

A shared take keeps its delete token in the browser. Deleting the take stops
its share first and keeps the take if that fails, so the token is never lost
while the share is up. Shares made under `?mock=` are marked and only stopped
in the mock store, and their links keep `?mock=1`.

## `recordings` table

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `uuid` | Primary key, `gen_random_uuid()` |
| `title` | `text` | 1-100 characters |
| `author_name` | `text` | Display name, 1-50 characters |
| `device_id` | `text` | Anonymous per-browser ID, 1-128 characters |
| `bpm` | `integer` | 20-400, quarter-note BPM |
| `meter` | `jsonb` | Numerator integer 1-32; denominator 1/2/4/8/16/32; legacy default 4/4 (#207) |
| `duration_ms` | `integer` | Non-negative |
| `note_count` | `integer` | Non-negative |
| `notes` | `jsonb` | Note-list JSON; must be an array |
| `delete_token_hash` | `text` | SHA-256 hex of the delete token, never the token |
| `hidden` | `boolean` | Moderation flag, default `false` |
| `created_at` | `timestamptz` | Default `now()` |

Row level security is enabled with no policies, and `anon`/`authenticated`
have no grants. Browsers therefore cannot read or write the table with the
publishable key; every access goes through a server route.

## Secrets

| Name | Used by | Notes |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Server routes | `https://<ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Server routes | `sb_secret_...`. Server only; never prefix with `NEXT_PUBLIC_` |
| `RECORDING_UPLOADS` | Upload route | `1` opens uploads on Vercel (production and preview); leave unset in `prod` until rate limiting lands |
| `SUPABASE_DB_PASSWORD` | Migrations | Postgres password for `supabase db push` when not using `supabase login` |

Nothing is committed. `frontend/.env.example` lists the names only, and
`.env*` files are git-ignored.

## Local setup

1. Install the CLIs: `brew install infisical/get-cli/infisical` and use
   `npx supabase` (no install needed).
2. Ask Jadden for access (Harry's invite is still pending) to the Infisical project `makeshift`
   (Infisical > project > Access Control > Invite members, role Developer).
3. Log in: `infisical login`.
4. Run the app with secrets injected (from `frontend/`; the repo's
   `.infisical.json` selects the project):

   ```sh
   infisical run --env=dev -- npm run dev
   ```

5. Open <http://localhost:3000/api/health>. `"status":"ok"` means the app
   reached the `recordings` table.

Without Infisical access the app still runs; `/api/health` returns
`503 {"database":{"status":"unconfigured"}}` and playing is unaffected.

## Running migrations

```sh
npx supabase login                                 # once per machine, real terminal
npx supabase link --project-ref xaghnmxcdgdmpfzflnsj
npx supabase migration new <name>                  # adds supabase/migrations/<ts>_<name>.sql
npx supabase db push --linked                      # applies pending migrations
npx supabase migration list --linked               # local and remote should match
npx supabase db advisors --linked                  # security/performance lints
```

`supabase login` needs an interactive terminal; the `!` prefix in agent
sessions is not one. Test a migration first against a throwaway database
(`npx supabase start` with Docker, then `npx supabase db reset`).
Never edit a migration that has already been pushed; add a new one.

## Vercel sync

Infisical pushes secrets to Vercel with a Secret Sync, so Vercel never holds
values that are missing from Infisical:

| Infisical environment | Vercel environment |
| :--- | :--- |
| `prod` | Production |
| `dev` | Preview |

Set up (done 2026-09-30): Infisical > Integrations > App Connections > Add >
Vercel, using a Vercel access token (a Full Account token if a team-scoped
token fails validation). Then
Secret Syncs > Add > Vercel, pick project `make-shift`, map the
environments above and enable auto-sync. Redeploy after the first sync
(`vercel deploy` or push a commit), because env changes apply to new builds.

## Rotating secrets

1. **Secret key:** Supabase > Project Settings > API Keys > create a new
   secret key. Update `SUPABASE_SECRET_KEY` in Infisical (`dev` and `prod`),
   let the sync run, redeploy, confirm `/api/health` is `ok`, then delete
   the old key in Supabase.
2. **Database password:** Supabase > Project Settings > Database > Reset
   password. Update `SUPABASE_DB_PASSWORD` in Infisical.
3. **Vercel token used by Infisical:** create a new token in Vercel, update
   the Infisical App Connection, then revoke the old token.
4. Remove a person's access by removing them from the Infisical project, then
   rotate any secret they could read.

## Meter migration (#207)

Apply `20261027000000_recording_meter.sql` with `npx supabase db push --linked`
before deploying the updated API. The new routes select/insert `meter`; an
unmigrated database will return route errors. Upload omission uses 4/4, explicit
invalid meter returns 400, and list/read return validated meter. Existing rows
receive 4/4. [Meter semantics](meter.md) apply to previews and MIDI downloads.
Local migration execution is pending: Supabase CLI/project credentials are not
available in this checkout. Mocked API tests are not evidence of live migration.
