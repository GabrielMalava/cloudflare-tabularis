"use strict";

// src/index.ts
var import_node_readline = require("node:readline");

// src/d1Client.ts
var API_BASE = "https://api.cloudflare.com/client/v4";
async function d1Post(cfg, endpoint, sql, params) {
  const url = `${API_BASE}/accounts/${encodeURIComponent(cfg.accountId)}/d1/database/${encodeURIComponent(cfg.databaseId)}/${endpoint}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sql, params })
    });
  } catch (e) {
    throw new Error(`Network error contacting Cloudflare D1: ${e.message}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Cloudflare D1 returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok || !json.success) {
    const msg = (json.errors ?? []).map((e) => e.code ? `${e.code}: ${e.message}` : e.message).join("; ");
    throw new Error(msg || `Cloudflare D1 request failed (HTTP ${res.status}).`);
  }
  return json.result ?? [];
}
async function queryObjects(cfg, sql, params = []) {
  const result = await d1Post(cfg, "query", sql, params);
  const last = result[result.length - 1];
  return { rows: last?.results ?? [], meta: last?.meta ?? {} };
}
async function queryRaw(cfg, sql, params = []) {
  const result = await d1Post(cfg, "raw", sql, params);
  const last = result[result.length - 1];
  return {
    columns: last?.results?.columns ?? [],
    rows: last?.results?.rows ?? [],
    meta: last?.meta ?? {}
  };
}
async function exec(cfg, sql, params = []) {
  const { meta } = await queryObjects(cfg, sql, params);
  return meta;
}
async function listDatabases(auth) {
  const url = `${API_BASE}/accounts/${encodeURIComponent(auth.accountId)}/d1/database`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
  } catch (e) {
    throw new Error(`Network error contacting Cloudflare D1: ${e.message}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Cloudflare D1 returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok || !json.success) {
    const msg = (json.errors ?? []).map((e) => e.code ? `${e.code}: ${e.message}` : e.message).join("; ");
    throw new Error(msg || `Cloudflare D1 request failed (HTTP ${res.status}).`);
  }
  return json.result ?? [];
}

// src/sql.ts
function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}
function quoteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
var WRAPPABLE_RE = /^\s*(select|with)\b/i;
function isWrappable(query) {
  return WRAPPABLE_RE.test(query);
}
function stripTrailingSemicolon(query) {
  return query.replace(/;\s*$/, "").trim();
}
function normalizeParam(value) {
  if (value === void 0 || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}
var RAW_DEFAULT_RE = /^(-?\d+(\.\d+)?|null|true|false|current_date|current_time|current_timestamp)$/i;
function defaultLiteral(value) {
  const trimmed = value.trim();
  if (RAW_DEFAULT_RE.test(trimmed)) return trimmed;
  if (trimmed.startsWith("'") || trimmed.startsWith("(")) return trimmed;
  return quoteLiteral(trimmed);
}
function columnDefinitionSql(col, inlinePrimaryKey) {
  let sql = `${quoteIdent(col.name)} ${col.data_type || "TEXT"}`;
  const pkInline = inlinePrimaryKey && col.is_pk;
  if (pkInline) {
    sql += " PRIMARY KEY";
    if (col.is_auto_increment && /int/i.test(col.data_type)) sql += " AUTOINCREMENT";
  }
  if (!col.is_nullable && !pkInline) sql += " NOT NULL";
  if (col.default_value != null && col.default_value !== "") {
    sql += ` DEFAULT ${defaultLiteral(col.default_value)}`;
  }
  return sql;
}

// src/handlers.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var nameToId = /* @__PURE__ */ new Map();
var pluginSettings = {};
function parseDatabaseField(raw) {
  const s = String(raw ?? "");
  if (!s.includes("|")) return { accountId: "", token: "", database: s };
  const parts = s.split("|");
  return {
    accountId: parts[0] ?? "",
    token: parts[1] ?? "",
    database: parts.slice(2).join("|")
  };
}
function accountAuth(p) {
  const cp = p.params;
  const parsed = parseDatabaseField(cp?.database);
  const accountId = String(parsed.accountId || cp?.host || pluginSettings.account_id || "").trim();
  const token = String(parsed.token || cp?.password || pluginSettings.api_token || "").trim();
  const missing = [];
  if (!accountId) missing.push("Account ID (connection or plugin settings)");
  if (!token) missing.push("API token (connection or plugin settings)");
  if (missing.length > 0) {
    throw new Error(`Missing Cloudflare D1 credentials: ${missing.join(", ")}.`);
  }
  return { accountId, token };
}
async function conn(p) {
  const auth = accountAuth(p);
  const database = parseDatabaseField(p.params?.database).database.trim();
  if (!database) {
    throw new Error("No Cloudflare D1 database selected. Open the Databases tab and pick one.");
  }
  if (UUID_RE.test(database)) {
    return { ...auth, databaseId: database };
  }
  const cacheKey = `${auth.accountId}::${database.toLowerCase()}`;
  let databaseId = nameToId.get(cacheKey);
  if (!databaseId) {
    const match = (await listDatabases(auth)).find(
      (d) => d.name.toLowerCase() === database.toLowerCase()
    );
    if (!match) throw new Error(`Cloudflare D1 database "${database}" not found in this account.`);
    databaseId = match.uuid;
    nameToId.set(cacheKey, databaseId);
  }
  return { ...auth, databaseId };
}
var SYSTEM_TABLE_FILTER = "name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_stat%' AND name <> 'sqlite_master'";
function mapColumns(rows) {
  return rows.map((r) => {
    const type = String(r.type ?? "");
    const pk = Number(r.pk ?? 0) > 0;
    const col = {
      name: String(r.name),
      data_type: type || "TEXT",
      is_pk: pk,
      is_nullable: Number(r.notnull ?? 0) === 0,
      is_auto_increment: pk && /^integer$/i.test(type)
    };
    if (r.dflt_value != null) col.default_value = String(r.dflt_value);
    return col;
  });
}
async function tableColumns(cfg, table) {
  const { rows } = await queryObjects(
    cfg,
    `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${quoteLiteral(table)})`
  );
  return mapColumns(rows);
}
async function tableForeignKeys(cfg, table) {
  const { rows } = await queryObjects(
    cfg,
    `SELECT id, "from" AS from_col, "table" AS ref_table, "to" AS ref_col, on_update, on_delete FROM pragma_foreign_key_list(${quoteLiteral(table)})`
  );
  return rows.map((r) => ({
    name: `fk_${table}_${String(r.id)}`,
    column_name: String(r.from_col),
    ref_table: String(r.ref_table),
    ref_column: String(r.ref_col),
    on_delete: r.on_delete != null ? String(r.on_delete) : null,
    on_update: r.on_update != null ? String(r.on_update) : null
  }));
}
async function listTableNames(cfg) {
  const { rows } = await queryObjects(
    cfg,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND ${SYSTEM_TABLE_FILTER} ORDER BY name`
  );
  return rows.map((r) => String(r.name));
}
var handlers = {
  async initialize(p) {
    const settings = p.settings ?? {};
    pluginSettings = settings;
    return null;
  },
  async test_connection(p) {
    await queryObjects(await conn(p), "SELECT 1");
    return { success: true };
  },
  async ping(p) {
    await queryObjects(await conn(p), "SELECT 1");
    return null;
  },
  async get_databases(p) {
    const databases = await listDatabases(accountAuth(p));
    return databases.map((d) => d.name);
  },
  async get_schemas() {
    return [];
  },
  async get_tables(p) {
    const names = await listTableNames(await conn(p));
    return names.map((name) => ({ name }));
  },
  async get_columns(p) {
    return tableColumns(await conn(p), String(p.table));
  },
  async get_foreign_keys(p) {
    return tableForeignKeys(await conn(p), String(p.table));
  },
  async get_indexes(p) {
    const cfg = await conn(p);
    const table = String(p.table);
    const { rows: indexes } = await queryObjects(
      cfg,
      `SELECT name, "unique" AS is_unique, origin FROM pragma_index_list(${quoteLiteral(table)})`
    );
    const out = [];
    for (const idx of indexes) {
      const indexName = String(idx.name);
      const { rows: cols } = await queryObjects(
        cfg,
        `SELECT seqno, name AS col FROM pragma_index_info(${quoteLiteral(indexName)}) ORDER BY seqno`
      );
      for (const c of cols) {
        if (c.col == null) continue;
        out.push({
          name: indexName,
          column_name: String(c.col),
          is_unique: Number(idx.is_unique ?? 0) === 1,
          is_primary: String(idx.origin ?? "") === "pk",
          seq_in_index: Number(c.seqno ?? 0)
        });
      }
    }
    return out;
  },
  async get_views(p) {
    const { rows } = await queryObjects(
      await conn(p),
      "SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name"
    );
    return rows.map((r) => ({ name: String(r.name), definition: r.sql != null ? String(r.sql) : null }));
  },
  async get_view_definition(p) {
    const { rows } = await queryObjects(
      await conn(p),
      "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?",
      [String(p.view_name)]
    );
    return rows[0]?.sql != null ? String(rows[0].sql) : "";
  },
  async get_view_columns(p) {
    return tableColumns(await conn(p), String(p.view_name));
  },
  async create_view(p) {
    await exec(await conn(p), `CREATE VIEW ${quoteIdent(String(p.view_name))} AS ${String(p.definition)}`);
    return null;
  },
  async alter_view(p) {
    const cfg = await conn(p);
    const name = quoteIdent(String(p.view_name));
    await exec(cfg, `DROP VIEW IF EXISTS ${name}`);
    await exec(cfg, `CREATE VIEW ${name} AS ${String(p.definition)}`);
    return null;
  },
  async drop_view(p) {
    await exec(await conn(p), `DROP VIEW IF EXISTS ${quoteIdent(String(p.view_name))}`);
    return null;
  },
  async get_routines() {
    return [];
  },
  async get_routine_parameters() {
    return [];
  },
  async get_routine_definition() {
    return "";
  },
  async execute_query(p) {
    const cfg = await conn(p);
    const query = String(p.query);
    const limit = p.limit == null ? null : Number(p.limit);
    const page = Math.max(1, Number(p.page ?? 1));
    if (isWrappable(query)) {
      const inner = stripTrailingSemicolon(query);
      if (limit != null && limit > 0) {
        const offset = (page - 1) * limit;
        let totalRows = null;
        try {
          const { rows: rows4 } = await queryObjects(cfg, `SELECT COUNT(*) AS c FROM (${inner})`);
          totalRows = Number(rows4[0]?.c ?? 0);
        } catch {
          totalRows = null;
        }
        const { columns: columns3, rows: rows3 } = await queryRaw(cfg, `SELECT * FROM (${inner}) LIMIT ${limit} OFFSET ${offset}`);
        const hasMore = totalRows != null ? offset + rows3.length < totalRows : rows3.length === limit;
        return {
          columns: columns3,
          rows: rows3,
          affected_rows: 0,
          truncated: false,
          pagination: { page, page_size: limit, total_rows: totalRows, has_more: hasMore }
        };
      }
      const { columns: columns2, rows: rows2 } = await queryRaw(cfg, inner);
      return { columns: columns2, rows: rows2, affected_rows: 0, truncated: false, pagination: null };
    }
    const { columns, rows } = await queryRaw(cfg, query);
    if (columns.length > 0 || rows.length > 0) {
      return { columns, rows, affected_rows: 0, truncated: false, pagination: null };
    }
    const meta = await exec(cfg, query);
    return {
      columns: [],
      rows: [],
      affected_rows: Number(meta.changes ?? 0),
      truncated: false,
      pagination: null
    };
  },
  async insert_record(p) {
    const cfg = await conn(p);
    const table = String(p.table);
    const data = p.data ?? {};
    const cols = Object.keys(data);
    if (cols.length === 0) throw new Error("No columns provided to insert.");
    const placeholders = cols.map(() => "?").join(", ");
    const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders})`;
    const meta = await exec(cfg, sql, cols.map((c) => normalizeParam(data[c])));
    return Number(meta.changes ?? 1);
  },
  async update_record(p) {
    const cfg = await conn(p);
    const sql = `UPDATE ${quoteIdent(String(p.table))} SET ${quoteIdent(String(p.col_name))} = ? WHERE ${quoteIdent(String(p.pk_col))} = ?`;
    const meta = await exec(cfg, sql, [normalizeParam(p.new_val), normalizeParam(p.pk_val)]);
    return Number(meta.changes ?? 0);
  },
  async delete_record(p) {
    const cfg = await conn(p);
    const sql = `DELETE FROM ${quoteIdent(String(p.table))} WHERE ${quoteIdent(String(p.pk_col))} = ?`;
    const meta = await exec(cfg, sql, [normalizeParam(p.pk_val)]);
    return Number(meta.changes ?? 0);
  },
  async get_create_table_sql(p) {
    const tableName = String(p.table_name);
    const columns = p.columns ?? [];
    const pkColumns = columns.filter((c) => c.is_pk);
    const singlePk = pkColumns.length === 1;
    const lines = columns.map((c) => columnDefinitionSql(c, singlePk));
    if (pkColumns.length > 1) {
      lines.push(`PRIMARY KEY (${pkColumns.map((c) => quoteIdent(c.name)).join(", ")})`);
    }
    return [`CREATE TABLE ${quoteIdent(tableName)} (
  ${lines.join(",\n  ")}
)`];
  },
  async get_add_column_sql(p) {
    const column = p.column;
    return [`ALTER TABLE ${quoteIdent(String(p.table))} ADD COLUMN ${columnDefinitionSql(column, false)}`];
  },
  async get_alter_column_sql(p) {
    const oldColumn = p.old_column;
    const newColumn = p.new_column;
    if (oldColumn.name !== newColumn.name) {
      return [
        `ALTER TABLE ${quoteIdent(String(p.table))} RENAME COLUMN ${quoteIdent(oldColumn.name)} TO ${quoteIdent(newColumn.name)}`
      ];
    }
    throw new Error(
      "SQLite/D1 cannot change a column type, nullability or default in place. Recreate the table to apply those changes."
    );
  },
  async get_create_index_sql(p) {
    const columns = p.columns ?? [];
    const unique = p.is_unique ? "UNIQUE " : "";
    return [
      `CREATE ${unique}INDEX ${quoteIdent(String(p.index_name))} ON ${quoteIdent(String(p.table))} (${columns.map(quoteIdent).join(", ")})`
    ];
  },
  async get_create_foreign_key_sql() {
    throw new Error(
      "SQLite/D1 cannot add a foreign key to an existing table. Define foreign keys when creating the table."
    );
  },
  async drop_index(p) {
    await exec(await conn(p), `DROP INDEX IF EXISTS ${quoteIdent(String(p.index_name))}`);
    return null;
  },
  async drop_foreign_key() {
    throw new Error(
      "SQLite/D1 cannot drop a foreign key from an existing table. Recreate the table without it."
    );
  },
  async get_schema_snapshot(p) {
    const cfg = await conn(p);
    const names = await listTableNames(cfg);
    const out = [];
    for (const name of names) {
      out.push({
        name,
        columns: await tableColumns(cfg, name),
        foreign_keys: await tableForeignKeys(cfg, name)
      });
    }
    return out;
  },
  async get_all_columns_batch(p) {
    const cfg = await conn(p);
    const names = await listTableNames(cfg);
    const out = {};
    for (const name of names) out[name] = await tableColumns(cfg, name);
    return out;
  },
  async get_all_foreign_keys_batch(p) {
    const cfg = await conn(p);
    const names = await listTableNames(cfg);
    const out = {};
    for (const name of names) out[name] = await tableForeignKeys(cfg, name);
    return out;
  }
};

// src/index.ts
function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}
var rl = (0, import_node_readline.createInterface)({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  let req;
  try {
    req = JSON.parse(text);
  } catch {
    send({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    return;
  }
  const id = req.id ?? null;
  const method = req.method ?? "";
  const handler = handlers[method];
  if (!handler) {
    send({ jsonrpc: "2.0", error: { code: -32601, message: `Method not found: ${method}` }, id });
    return;
  }
  try {
    const result = await handler(req.params ?? {});
    send({ jsonrpc: "2.0", result: result === void 0 ? null : result, id });
  } catch (e) {
    const err = e;
    process.stderr.write(`[cloudflare-d1-http] ${method} failed: ${err.stack ?? err.message}
`);
    send({ jsonrpc: "2.0", error: { code: -32603, message: err.message ?? String(e) }, id });
  }
});
