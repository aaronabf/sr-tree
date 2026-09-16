# Sustain-Release Family Tree

Who brought you? A single-page site where festival-goers enter who invited them
each year and explore the full invite lineage as a draggable, zoomable family
tree. Neon-on-black, Win95 windows, scanlines. Netscape 4.0 recommended.

**Stack:** Next.js 16 (App Router) · React 19 · d3-force / d3-hierarchy / d3-zoom / d3-drag · Postgres on Neon via `pg` · Vercel.

## How it works

- **People** have one name, unique across the tree (case-insensitive). Most people
  will just use a first name; if "Alice" is taken by someone else, the form asks
  you to go by "Alice K" or a nickname. The type-ahead shows each match's years,
  who brought them and who they brought, so you can confirm it's really you (or
  really them) before picking.
- **Attendances** are one row per (person, year) with an optional `invited_by_id`.
  `NULL` means they got in on their own (founders, artists, staff), they came
  back on their own in a later year, or nobody has filled it in yet. The UI
  tells the first two apart by whether it's the person's first year ("got in on
  their own" vs "came back"). The year is _the year you were invited / attended_;
  people who went several times add one entry per year.
- **Years** are shown as editions: `Year 10 (2024)`. 2014 is Year 1; 2020 (no
  festival) is skipped and not selectable. See `SKIPPED_YEARS` in `lib/config.ts`.
- **Festival rules** are enforced in the database and surfaced as friendly errors:
  one entry per person per year, one guest per inviter per year, unique names,
  and you can't bring yourself. If you say Bob brought you in 2024, Bob is also
  recorded as attending 2024, and if Bob has nothing earlier he's pencilled in
  for 2023 too so he sits in the row above you rather than beside you (guests
  rarely know their host's real first year; Bob can fix it). Two more rules live
  in `lib/mutations.ts`: you can't be brought and bring a guest in the same
  year, and someone whose first year is later than yours can't have brought you
  (the usual sign the invite was entered backwards). Both come back as errors
  that name the people involved and suggest the fix.
- **Graph:** a layered family tree. Each row is a festival year, labelled on the
  left; a person sits in the row of their first year, placed under whoever
  brought them (tidy-tree layout), with a light force simulation keeping nodes
  apart. Solid edges are the invite that put someone on the tree; dashed edges
  are later-year invites of returning attendees. Node size = how many people
  they've brought; white ring = never invited by anyone (OG). Click a node to
  light up its full lineage up and down. Drag pins a node, double-click unpins
  it. Year chips at the bottom solo/toggle years; the find box flies to a name.
- **Editing:** click a person to open their panel. From there you can rename
  them, edit any year (the year itself, who brought them, and who they brought),
  delete a year, add another year, or delete the person. Deleting a person is a
  soft delete: they disappear from the tree and their invite links are cut both
  ways (people they brought show as brought by nobody), but their rows stay so
  an admin can bring them back with
  `UPDATE people SET deleted_at = NULL WHERE id = …` in the Neon console. The
  same rules apply as when adding. A person with no remaining entries who
  brought nobody is removed automatically. Changing a year moves the guest they
  brought along with it. To fix an invite entered backwards, set one side to
  "Nobody" and save, then re-enter it the right way round.
- **Rate limiting:** writes are limited to 30 per IP per minute, counted in
  Postgres so the limit holds across serverless instances (`lib/rate-limit.ts`).
  Over the limit returns a 429 with a friendly message. Reads aren't limited.
  It's only active in production by default, since every local request shares
  one IP; `RATE_LIMIT=on|off` overrides that and `RATE_LIMIT_PER_MINUTE` the
  limit.
- **Next year:** the year pickers stop at the current year until
  `NEXT_PUBLIC_ALLOW_NEXT_YEAR=true` is set, so nobody pre-registers for an
  edition that hasn't been announced. Rows that already hold a future year can
  still be edited.
- **Phones** (≤ 760px): the windows stack at the bottom and only one is open at
  a time. Selecting a person collapses the add form; expanding the add form
  closes the person window.
- **Sharing:** `app/opengraph-image.png` / `twitter-image.png` provide the link
  preview, `app/icon.svg` and `app/apple-icon.png` the favicons. Next.js picks
  these up by filename. Set `NEXT_PUBLIC_SITE_URL` if you use a custom domain so
  absolute preview URLs are right; on Vercel it falls back to the production URL.
- **Demo mode:** with no `DATABASE_URL` the app serves a fictional tree so the UI
  can be previewed; writes are disabled.

## Local development

```bash
npm install
cp .env.example .env.local   # paste your Neon pooled connection string
npm run db:migrate           # creates tables (idempotent)
npm run db:seed              # optional: fictional demo data into an EMPTY db
npm run dev                  # http://localhost:3000
```

Skip the `.env.local` step to run in demo mode without a database.

## Deploy to Vercel + Neon

1. Push this folder to a Git repo and import it into Vercel as a new project.
   Framework preset: Next.js. No build settings needed.
2. In the Vercel project, open **Storage → Create Database → Neon** (or connect an
   existing Neon project via the Neon integration). This sets `DATABASE_URL` on the
   project automatically. If you set it by hand, use the **pooled** connection
   string from the Neon console (host contains `-pooler`).
3. Create the tables once. Either run locally against the Neon URL:
   ```bash
   DATABASE_URL="postgresql://…-pooler…/neondb?sslmode=require" npm run db:migrate
   ```
   or paste `db/schema.sql` into the Neon SQL editor.
4. Deploy. Any later push redeploys.

Re-run `npm run db:migrate` whenever `db/schema.sql` changes; it's idempotent.
The app expects the current schema (`people.deleted_at`, `rate_limits`) and the
graph won't load without it.

Optional: `npm run db:seed -- --force` wipes and loads the demo tree; don't run it
against a database people have already added themselves to.

## Scripts

| Command                | What it does                                           |
| ---------------------- | ------------------------------------------------------ |
| `npm run dev`          | Next dev server                                        |
| `npm run build`        | Production build                                       |
| `npm run typecheck`    | `tsc --noEmit`                                         |
| `npm run lint`         | ESLint over the project (`lint:fix` applies fixes)     |
| `npm run format`       | Prettier over the project (`format:check` reports)     |
| `npm test`             | Rule tests against `TEST_DATABASE_URL` (see Testing)   |
| `npm run test:docker`  | Same, against a throwaway Postgres 16 in Docker        |
| `npm run check`        | lint + typecheck + format:check + test                 |
| `npm run check:docker` | Same, with the Docker-backed tests                     |
| `npm run db:migrate`   | Apply `db/schema.sql` (safe to re-run)                 |
| `npm run db:seed`      | Load demo data into an empty db (`-- --force` to wipe) |

## Testing

`test/rules.test.ts` runs every festival rule, the guest handling, soft delete
and the rate limiter against a real Postgres, using the same functions the API
routes call. The harness (`test/db.ts`) creates a throwaway schema, applies
`db/schema.sql` into it, runs each transaction with `search_path` pointed
there, and drops the schema afterwards, so nothing outside it is touched.

Two ways to give it a database:

- **Docker:** `npm run test:docker` starts a `postgres:16-alpine` container on a
  free port, runs the tests, and removes it. No configuration needed.
- **Neon branch:** create a branch of the production project in the Neon
  console, copy its connection string into `.env.test.local` as
  `TEST_DATABASE_URL`, and run `npm test`. The harness refuses to run if that
  URL equals `DATABASE_URL`.

`npm run check` (or `check:docker`) chains lint, typecheck, format check and the
tests; that's the pre-merge gate.

## Code style

Prettier owns formatting: no semicolons, double quotes, trailing commas, 110
columns (`.prettierrc`). ESLint (`eslint.config.mjs`) runs the Next.js
core-web-vitals and TypeScript rule sets plus `eslint-config-prettier` so the two
never disagree, and adds `curly: all` so every `if`/`else`/loop body has braces
on its own lines. `.vscode/settings.json` formats with Prettier and applies
ESLint fixes on save; `.vscode/extensions.json` recommends both extensions.
Before handing work over, `npm run check` (or `npm run check:docker`) should be
clean.

## API

- `GET /api/graph` → `{ people: [{ id, name }], attendances: [{ id, personId, year, invitedById }], demo }`
- `POST /api/attendances` → `{ person, year, inviter, guest? }` where `person`,
  `inviter` and `guest` are `{ id }` for an existing person or `{ name }` for a
  new one; `inviter` may be `null` ("got in on my own"). `guest` is who `person`
  brought that year: omit to leave alone, `null` for nobody. Returns
  `{ ok: true, personId, inviterId }` or `{ ok: false, error }` with a message
  meant to be shown to the user.
- `PATCH /api/attendances/:id` → `{ year?, inviter?, guest? }` (omit to keep,
  `inviter: null` for "on my own", `guest: null` for "brought nobody"). If
  `year` changes and `guest` is omitted, the current guest moves to the new
  year. `DELETE /api/attendances/:id` removes the entry, unless that person
  brought someone that year (set the guest to nobody first).
- `PATCH /api/people/:id` → `{ name }` renames a person (must stay unique).
  `DELETE /api/people/:id` soft-deletes them (see Editing above).
- All mutations return `{ ok: true }` or `{ ok: false, error }`; 429 when the
  per-IP write limit is hit. Request bodies are validated with the zod schemas
  in `lib/schemas.ts`, which the TypeScript request types are inferred from.

## Layout

```
app/
  api/graph/route.ts             read the whole tree
  api/attendances/route.ts       add / complete an entry
  api/attendances/[id]/route.ts  edit or delete an entry
  api/people/[id]/route.ts       rename or delete a person
  layout.tsx, page.tsx, globals.css
  icon.svg, apple-icon.png, opengraph-image.png, twitter-image.png
components/
  App.tsx          page shell: top bar, HUD windows, year legend, find box, phone layout
  InviteGraph.tsx  layered tree (d3-hierarchy) + force collision, zoom, pan, drag, lineage highlight
  AddForm.tsx      the four-step "add yourself" form (who, year, who brought you, who you brought)
  PersonPicker.tsx type-ahead that finds people / creates new unique names
  PersonPanel.tsx  selected person's history + per-year editor (inviter and guest)
  ConfirmDialog.tsx themed confirm dialog (useConfirm hook) replacing window.confirm
  Win95Window.tsx  bevelled window chrome
lib/
  db.ts          pg pool + transaction helper
  mutations.ts   all festival rules, guest handling, soft delete, error mapping for writes
  rate-limit.ts  per-IP write limiter backed by the rate_limits table
  schemas.ts     zod request schemas (single source of truth for the API)
  api-client.ts  browser-side fetch helpers shared by the form and the panel
  demo.ts        fictional lineage for demo mode and seeding
  names.ts       name tidying + case-insensitive key
  config.ts      first year, skipped years, "Year N (YYYY)" labels, palette
  types.ts       shared types; request shapes inferred from schemas.ts
test/
  db.ts            throwaway-schema harness for a real Postgres
  rules.test.ts    every rule, guest flow, soft delete and the rate limiter
db/schema.sql, db/migrations/
scripts/migrate.ts, scripts/seed.ts, scripts/test-docker.sh
eslint.config.mjs, .prettierrc, .prettierignore, .vscode/
```

## Notes

- There is no auth. Anyone can add anyone. That's the point for a community
  tree. Vandalism is slowed by the per-IP rate limit and undone by restoring
  soft-deleted people or, for anything worse, Neon's point-in-time restore. If
  it gets bad, put the site behind Vercel password protection or add a shared
  passphrase check to the write routes.
- Corrections (wrong inviter, wrong year, misspelled name, duplicate person) are
  all done from the person panel; nothing needs a SQL edit. The API still
  refuses to silently overwrite an existing inviter through the add form, so a
  typo can't rewrite someone's history without an explicit edit.
- The Neon SQL editor runs one statement per submission. Paste multi-statement
  scripts one statement at a time, or use `psql -f`.
- The selectable year range is 2014 through next year, minus skipped years
  (`lib/config.ts`).
