<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project notes for agents

Read `README.md` first; it explains the domain (people, attendances, festival
rules) and the layout. This file covers what's easy to get wrong.

## Before you finish

```bash
npm run check:docker   # lint + typecheck + format:check + tests in a throwaway Postgres
```

Everything must pass. Prettier formats on save in the editor, but run `npm run
format` yourself after bulk edits. If Docker isn't available, `npm run check`
runs the tests against `TEST_DATABASE_URL` (a Neon branch, never production).

## Tests

`test/rules.test.ts` exercises `lib/mutations.ts` against a real database via
the harness in `test/db.ts`, which isolates everything in a throwaway schema.
When you change a rule, add or adjust a scenario there. Remember the API
convention inside tests: `{ name }` creates a person, so reference an existing
one with `{ id }` (the `ref()` helper).

## Style

- Prettier decides formatting: no semicolons, double quotes, trailing commas,
  110 columns. Don't hand-format; don't add semicolons back.
- ESLint enforces `curly: all`. Every `if`/`else`/loop body gets braces on its
  own lines, even one-liners.
- Avoid statements that start with `(` or `[`, which would need a leading `;`
  without semicolons. Assign to a variable or use a helper instead.
- React hooks rules are strict (React Compiler era): no `setState` directly in
  an effect body, no refs read during render. Derive state during render, key
  a component to reset it, or use `useSyncExternalStore` for browser state.

## Domain rules live in one place

`lib/mutations.ts` holds every festival rule and is used by all write routes.
Add or change rules there, not in route handlers or components. Request body
shapes live in `lib/schemas.ts` (zod); the TypeScript types in `lib/types.ts`
are inferred from them, so change the schema, not the type. Current rules:

- One entry per person per year; one guest per inviter per year; unique names
  (case-insensitive); you can't bring yourself.
- You can't be brought and bring a guest in the same year.
- Someone whose first year is later than yours can't have brought you. This
  catches invites entered backwards, which is the most common data mistake.
- Naming a host records the host as attending that year, and if they have
  nothing earlier, the previous festival year too (2020 skipped) so they sit
  above their guest.

Errors thrown as `UserError` are shown verbatim to the person filling in the
form. Name the people involved and say what to do instead.

## Data model gotchas

- `invited_by_id = NULL` has three meanings: OG, came back on their own, or not
  filled in yet. The UI distinguishes the first two by first year only.
- "Who they brought" is not a column. It's the guest's own attendance row
  pointing back at the inviter. `setGuest()` in `lib/mutations.ts` manages it.
- Deleting a person is a soft delete (`people.deleted_at`). `softDeletePerson()`
  also nulls `invited_by_id` on their guests' rows and on their own rows, so
  their hosts' guest slots free up. Every people lookup must filter
  `deleted_at IS NULL`; `getPerson()` / `resolvePerson()` already do. The name
  uniqueness index is partial on live people, so a deleted name can be reused.
- Deleting an attendance is refused while that person is recorded as bringing
  someone that year (the guest link would dangle). It may also hard-remove an
  orphaned person via `deleteIfOrphan()`.
- Changing a row's year moves that person's guest with it (`moveGuest()`),
  unless the request also changes the guest.
- All write routes call `assertRateLimit(req)` before the transaction. It's
  per IP per minute, stored in `rate_limits`, and counts failed attempts too.
- Schema changes go in `db/schema.sql` as idempotent statements such as
  `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`. The migrate
  script runs the whole file. Also add a numbered, one-statement-per-block
  copy under `db/migrations/` for people applying it through the Neon editor.

## Environment

- No `DATABASE_URL` means demo mode: fictional data, writes return 503.
- Feature flags (see `.env.example`): `NEXT_PUBLIC_ALLOW_NEXT_YEAR` opens next
  year's edition in the pickers; `RATE_LIMIT` / `RATE_LIMIT_PER_MINUTE` control
  the write limiter, which is off outside production by default.
- The write flows live in `lib/mutations.ts` as `addAttendance`,
  `updateAttendance`, `deleteAttendance`, `renamePerson` and
  `softDeletePerson`. Routes only parse, rate-limit and call them.
- `.env.local` points at the production Neon database. Never run migrations,
  seeds or ad-hoc SQL against it without the user asking; use a scratch local
  database for verification.
- Client components share `lib/api-client.ts` (`request`, `mutate`, `toRef`)
  and confirm destructive actions through `useConfirm()` from
  `components/ConfirmDialog.tsx`, not `window.confirm`.
- Never run `npm run db:seed -- --force` against the production Neon database;
  it wipes it.
- The Neon SQL editor accepts one statement per run.
- Phone breakpoint is 760px, used in both `globals.css` and `App.tsx`.
- The social preview images in `app/` are hand-edited PNGs, not generated.
