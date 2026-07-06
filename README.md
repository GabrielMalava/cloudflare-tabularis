# tubularis-d1-plugin

A [Tabularis](https://github.com/TabularisDB/tabularis) database driver plugin for
**Cloudflare D1** (serverless SQLite), implemented in TypeScript and talking to the
[D1 HTTP API](https://developers.cloudflare.com/api/operations/cloudflare-d1-query-database).

The plugin is a standalone executable that speaks **JSON-RPC 2.0 over stdin/stdout** —
the protocol Tabularis uses for external drivers. It is stateless: every request carries
the full connection params, so each call maps to a D1 REST request.

## Setup (v0.3 — per-connection credentials)

The driver is API-based (`no_connection_required`), so the standard host/port form is hidden.
Each connection carries its **own** credentials, so you can connect to multiple Cloudflare
accounts / databases at once:

1. **New connection → Cloudflare D1** — the form (rendered by `ui/dist/d1-db-field.js`) shows:
   - **Account ID** — the Cloudflare Account ID for this connection
   - **API Token** — a token with the **D1 Edit** permission
   - **D1 Database** — the database **name** or its UUID
2. Create as many connections as you like, each pointing at a different account or database.

**Optional defaults:** if you leave a connection's Account ID / API Token blank, the plugin
falls back to the global **Settings → Plugins → Cloudflare D1 (gear icon)** values. This keeps
older connections working and lets you avoid retyping shared credentials.

Internally the credentials map to `ConnectionParams` (Host = account id, Password = token,
Database = database name/UUID) — see `npm run smoke`.

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

Requires [bun](https://bun.sh) (`brew install bun`), which compiles `src` into a
self-contained native binary — no Node.js needed at runtime.

```bash
npm run install:local
```

This compiles the binary for your host platform and copies it together with
`manifest.json` and `ui/dist/` to:

- macOS: `~/Library/Application Support/com.debba.tabularis/plugins/tubularis-d1/`
- Linux: `~/.local/share/tabularis/plugins/tubularis-d1/`

Restart Tabularis; "Cloudflare D1 (HTTP API)" appears in the database type list.

## Package & publish

`bun` cross-compiles every platform from a single machine:

```bash
npm run package   # -> release/tubularis-d1-<platform>.zip for all 5 platforms
```

Each zip extracts to a folder containing the native binary (`tubularis-d1`, or
`tubularis-d1.exe` on Windows), `manifest.json` and `ui/dist/` — the exact layout
Tabularis expects.

Releases are automated: pushing a `vX.Y.Z` tag runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds all
zips and attaches them to the GitHub Release. To list the driver in the official
Plugin Center, open a PR adding an entry to
[`plugins/registry.json`](https://github.com/TabularisDB/tabularis/blob/main/plugins/registry.json)
pointing at those release assets.

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
