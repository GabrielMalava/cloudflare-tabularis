# tubularis-d1-plugin

A [Tabularis](https://github.com/TabularisDB/tabularis) database driver plugin for
**Cloudflare D1** (serverless SQLite), implemented in TypeScript and talking to the
[D1 HTTP API](https://developers.cloudflare.com/api/operations/cloudflare-d1-query-database).

The plugin is a standalone executable that speaks **JSON-RPC 2.0 over stdin/stdout** —
the protocol Tabularis uses for external drivers. It is stateless: every request carries
the full connection params, so each call maps to a D1 REST request.

## Setup (v0.2 — custom UI)

The driver is API-based (`no_connection_required`), so the standard host/port form is hidden.
Credentials live in the plugin's **Settings**, and each connection only picks a database:

1. **Settings → Plugins → Cloudflare D1 (gear icon)** — fill in:
   - **Account ID** — your Cloudflare Account ID
   - **API Token** — a token with the **D1 Edit** permission
2. **New connection → Cloudflare D1** — the form shows a single **D1 Database** field
   (rendered by `ui/dist/d1-db-field.js`). Enter the database **name** or its UUID.

Account ID + token are global (one Cloudflare account); the database is per-connection.
For headless testing, the plugin also falls back to `ConnectionParams` (Host = account id,
Password = token) — see `npm run smoke`.

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # unit tests for the SQL helpers
npm run build       # bundle src -> dist/index.cjs (esbuild)
```

Run the plugin loop directly and pipe a request to it:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"test_connection","params":{"params":{"host":"<account_id>","database":"<db_id>","password":"<token>"}}}' \
  | npm run -s dev
```

## Install locally

```bash
npm run install:local
```

This builds and copies `manifest.json`, `dist/index.cjs` and the `tubularis-d1` launcher to:

- macOS: `~/Library/Application Support/tabularis/plugins/tubularis-d1/`
- Linux: `~/.local/share/tabularis/plugins/tubularis-d1/`

Restart Tabularis; "Cloudflare D1" appears in the database type list. The launcher runs
the bundle with your local `node`, so Node must be on `PATH`.

## Supported operations

- Connection: `test_connection`, `ping`
- Schema discovery: tables, columns, foreign keys, indexes (via `sqlite_master` + `pragma_*` functions)
- Views: list / definition / columns / create / alter (drop+create) / drop
- Query execution with server-side pagination (`SELECT`/`WITH` wrapped + `COUNT(*)`)
- Row CRUD: insert / update / delete (parameterized)
- ER diagram batch methods: `get_schema_snapshot`, `get_all_columns_batch`, `get_all_foreign_keys_batch`
- DDL generation: create table, add column, rename column, create index, drop index

## SQLite/D1 limitations

These mirror SQLite's `ALTER TABLE` restrictions and surface as clear errors in the UI:

- Changing a column's type/nullability/default in place is not supported (only column rename).
- Adding or dropping a foreign key on an existing table is not supported.
- Stored routines do not exist in SQLite (`get_routines` returns `[]`).
