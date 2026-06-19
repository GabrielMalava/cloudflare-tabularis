import {
  exec,
  listDatabases,
  queryObjects,
  queryRaw,
  type AccountAuth,
  type D1Config,
} from './d1Client.ts';
import {
  columnDefinitionSql,
  isWrappable,
  normalizeParam,
  quoteIdent,
  quoteLiteral,
  stripTrailingSemicolon,
} from './sql.ts';
import type {
  ColumnDefinition,
  ConnectionParams,
  ForeignKey,
  IndexInfo,
  QueryResult,
  TableColumn,
  TableInfo,
  TableSchema,
  ViewInfo,
} from './types.ts';

type Params = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nameToId = new Map<string, string>();

let pluginSettings: Record<string, unknown> = {};

interface ParsedDatabaseField {
  accountId: string;
  token: string;
  database: string;
}

function parseDatabaseField(raw: unknown): ParsedDatabaseField {
  const s = String(raw ?? '');
  if (!s.includes('|')) return { accountId: '', token: '', database: s };
  const parts = s.split('|');
  return {
    accountId: parts[0] ?? '',
    token: parts[1] ?? '',
    database: parts.slice(2).join('|'),
  };
}

function accountAuth(p: Params): AccountAuth {
  const cp = p.params as ConnectionParams | undefined;
  const parsed = parseDatabaseField(cp?.database);
  const accountId = String(parsed.accountId || cp?.host || pluginSettings.account_id || '').trim();
  const token = String(parsed.token || cp?.password || pluginSettings.api_token || '').trim();
  const missing: string[] = [];
  if (!accountId) missing.push('Account ID (connection or plugin settings)');
  if (!token) missing.push('API token (connection or plugin settings)');
  if (missing.length > 0) {
    throw new Error(`Missing Cloudflare D1 credentials: ${missing.join(', ')}.`);
  }
  return { accountId, token };
}

async function conn(p: Params): Promise<D1Config> {
  const auth = accountAuth(p);
  const database = parseDatabaseField((p.params as ConnectionParams | undefined)?.database).database.trim();
  if (!database) {
    throw new Error('No Cloudflare D1 database selected. Open the Databases tab and pick one.');
  }
  if (UUID_RE.test(database)) {
    return { ...auth, databaseId: database };
  }
  const cacheKey = `${auth.accountId}::${database.toLowerCase()}`;
  let databaseId = nameToId.get(cacheKey);
  if (!databaseId) {
    const match = (await listDatabases(auth)).find(
      (d) => d.name.toLowerCase() === database.toLowerCase(),
    );
    if (!match) throw new Error(`Cloudflare D1 database "${database}" not found in this account.`);
    databaseId = match.uuid;
    nameToId.set(cacheKey, databaseId);
  }
  return { ...auth, databaseId };
}

const SYSTEM_TABLE_FILTER =
  "name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_stat%' AND name <> 'sqlite_master'";

function mapColumns(rows: Record<string, unknown>[]): TableColumn[] {
  return rows.map((r) => {
    const type = String(r.type ?? '');
    const pk = Number(r.pk ?? 0) > 0;
    const col: TableColumn = {
      name: String(r.name),
      data_type: type || 'TEXT',
      is_pk: pk,
      is_nullable: Number(r.notnull ?? 0) === 0,
      is_auto_increment: pk && /^integer$/i.test(type),
    };
    if (r.dflt_value != null) col.default_value = String(r.dflt_value);
    return col;
  });
}

async function tableColumns(cfg: D1Config, table: string): Promise<TableColumn[]> {
  const { rows } = await queryObjects(
    cfg,
    `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${quoteLiteral(table)})`,
  );
  return mapColumns(rows);
}

async function tableForeignKeys(cfg: D1Config, table: string): Promise<ForeignKey[]> {
  const { rows } = await queryObjects(
    cfg,
    `SELECT id, "from" AS from_col, "table" AS ref_table, "to" AS ref_col, on_update, on_delete FROM pragma_foreign_key_list(${quoteLiteral(table)})`,
  );
  return rows.map((r) => ({
    name: `fk_${table}_${String(r.id)}`,
    column_name: String(r.from_col),
    ref_table: String(r.ref_table),
    ref_column: String(r.ref_col),
    on_delete: r.on_delete != null ? String(r.on_delete) : null,
    on_update: r.on_update != null ? String(r.on_update) : null,
  }));
}

async function listTableNames(cfg: D1Config): Promise<string[]> {
  const { rows } = await queryObjects(
    cfg,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND ${SYSTEM_TABLE_FILTER} ORDER BY name`,
  );
  return rows.map((r) => String(r.name));
}

export const handlers: Record<string, (p: Params) => Promise<unknown>> = {
  async initialize(p) {
    const settings = (p.settings ?? {}) as Record<string, unknown>;
    pluginSettings = settings;
    return null;
  },

  async test_connection(p) {
    await queryObjects(await conn(p), 'SELECT 1');
    return { success: true };
  },

  async ping(p) {
    await queryObjects(await conn(p), 'SELECT 1');
    return null;
  },

  async get_databases(p) {
    const databases = await listDatabases(accountAuth(p));
    return databases.map((d) => d.name);
  },

  async get_schemas() {
    return [];
  },

  async get_tables(p): Promise<TableInfo[]> {
    const names = await listTableNames(await conn(p));
    return names.map((name) => ({ name }));
  },

  async get_columns(p): Promise<TableColumn[]> {
    return tableColumns(await conn(p), String(p.table));
  },

  async get_foreign_keys(p): Promise<ForeignKey[]> {
    return tableForeignKeys(await conn(p), String(p.table));
  },

  async get_indexes(p): Promise<IndexInfo[]> {
    const cfg = await conn(p);
    const table = String(p.table);
    const { rows: indexes } = await queryObjects(
      cfg,
      `SELECT name, "unique" AS is_unique, origin FROM pragma_index_list(${quoteLiteral(table)})`,
    );
    const out: IndexInfo[] = [];
    for (const idx of indexes) {
      const indexName = String(idx.name);
      const { rows: cols } = await queryObjects(
        cfg,
        `SELECT seqno, name AS col FROM pragma_index_info(${quoteLiteral(indexName)}) ORDER BY seqno`,
      );
      for (const c of cols) {
        if (c.col == null) continue;
        out.push({
          name: indexName,
          column_name: String(c.col),
          is_unique: Number(idx.is_unique ?? 0) === 1,
          is_primary: String(idx.origin ?? '') === 'pk',
          seq_in_index: Number(c.seqno ?? 0),
        });
      }
    }
    return out;
  },

  async get_views(p): Promise<ViewInfo[]> {
    const { rows } = await queryObjects(
      await conn(p),
      "SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name",
    );
    return rows.map((r) => ({ name: String(r.name), definition: r.sql != null ? String(r.sql) : null }));
  },

  async get_view_definition(p): Promise<string> {
    const { rows } = await queryObjects(
      await conn(p),
      "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?",
      [String(p.view_name)],
    );
    return rows[0]?.sql != null ? String(rows[0].sql) : '';
  },

  async get_view_columns(p): Promise<TableColumn[]> {
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
    return '';
  },

  async execute_query(p): Promise<QueryResult> {
    const cfg = await conn(p);
    const query = String(p.query);
    const limit = p.limit == null ? null : Number(p.limit);
    const page = Math.max(1, Number(p.page ?? 1));

    if (isWrappable(query)) {
      const inner = stripTrailingSemicolon(query);
      if (limit != null && limit > 0) {
        const offset = (page - 1) * limit;
        let totalRows: number | null = null;
        try {
          const { rows } = await queryObjects(cfg, `SELECT COUNT(*) AS c FROM (${inner})`);
          totalRows = Number(rows[0]?.c ?? 0);
        } catch {
          totalRows = null;
        }
        const { columns, rows } = await queryRaw(cfg, `SELECT * FROM (${inner}) LIMIT ${limit} OFFSET ${offset}`);
        const hasMore = totalRows != null ? offset + rows.length < totalRows : rows.length === limit;
        return {
          columns,
          rows,
          affected_rows: 0,
          truncated: false,
          pagination: { page, page_size: limit, total_rows: totalRows, has_more: hasMore },
        };
      }
      const { columns, rows } = await queryRaw(cfg, inner);
      return { columns, rows, affected_rows: 0, truncated: false, pagination: null };
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
      pagination: null,
    };
  },

  async insert_record(p): Promise<number> {
    const cfg = await conn(p);
    const table = String(p.table);
    const data = (p.data ?? {}) as Record<string, unknown>;
    const cols = Object.keys(data);
    if (cols.length === 0) throw new Error('No columns provided to insert.');
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`;
    const meta = await exec(cfg, sql, cols.map((c) => normalizeParam(data[c])));
    return Number(meta.changes ?? 1);
  },

  async update_record(p): Promise<number> {
    const cfg = await conn(p);
    const sql = `UPDATE ${quoteIdent(String(p.table))} SET ${quoteIdent(String(p.col_name))} = ? WHERE ${quoteIdent(String(p.pk_col))} = ?`;
    const meta = await exec(cfg, sql, [normalizeParam(p.new_val), normalizeParam(p.pk_val)]);
    return Number(meta.changes ?? 0);
  },

  async delete_record(p): Promise<number> {
    const cfg = await conn(p);
    const sql = `DELETE FROM ${quoteIdent(String(p.table))} WHERE ${quoteIdent(String(p.pk_col))} = ?`;
    const meta = await exec(cfg, sql, [normalizeParam(p.pk_val)]);
    return Number(meta.changes ?? 0);
  },

  async get_create_table_sql(p): Promise<string[]> {
    const tableName = String(p.table_name);
    const columns = (p.columns ?? []) as ColumnDefinition[];
    const pkColumns = columns.filter((c) => c.is_pk);
    const singlePk = pkColumns.length === 1;
    const lines = columns.map((c) => columnDefinitionSql(c, singlePk));
    if (pkColumns.length > 1) {
      lines.push(`PRIMARY KEY (${pkColumns.map((c) => quoteIdent(c.name)).join(', ')})`);
    }
    return [`CREATE TABLE ${quoteIdent(tableName)} (\n  ${lines.join(',\n  ')}\n)`];
  },

  async get_add_column_sql(p): Promise<string[]> {
    const column = p.column as ColumnDefinition;
    return [`ALTER TABLE ${quoteIdent(String(p.table))} ADD COLUMN ${columnDefinitionSql(column, false)}`];
  },

  async get_alter_column_sql(p): Promise<string[]> {
    const oldColumn = p.old_column as ColumnDefinition;
    const newColumn = p.new_column as ColumnDefinition;
    if (oldColumn.name !== newColumn.name) {
      return [
        `ALTER TABLE ${quoteIdent(String(p.table))} RENAME COLUMN ${quoteIdent(oldColumn.name)} TO ${quoteIdent(newColumn.name)}`,
      ];
    }
    throw new Error(
      'SQLite/D1 cannot change a column type, nullability or default in place. Recreate the table to apply those changes.',
    );
  },

  async get_create_index_sql(p): Promise<string[]> {
    const columns = (p.columns ?? []) as string[];
    const unique = p.is_unique ? 'UNIQUE ' : '';
    return [
      `CREATE ${unique}INDEX ${quoteIdent(String(p.index_name))} ON ${quoteIdent(String(p.table))} (${columns.map(quoteIdent).join(', ')})`,
    ];
  },

  async get_create_foreign_key_sql(): Promise<string[]> {
    throw new Error(
      'SQLite/D1 cannot add a foreign key to an existing table. Define foreign keys when creating the table.',
    );
  },

  async drop_index(p) {
    await exec(await conn(p), `DROP INDEX IF EXISTS ${quoteIdent(String(p.index_name))}`);
    return null;
  },

  async drop_foreign_key(): Promise<null> {
    throw new Error(
      'SQLite/D1 cannot drop a foreign key from an existing table. Recreate the table without it.',
    );
  },

  async get_schema_snapshot(p): Promise<TableSchema[]> {
    const cfg = await conn(p);
    const names = await listTableNames(cfg);
    const out: TableSchema[] = [];
    for (const name of names) {
      out.push({
        name,
        columns: await tableColumns(cfg, name),
        foreign_keys: await tableForeignKeys(cfg, name),
      });
    }
    return out;
  },

  async get_all_columns_batch(p): Promise<Record<string, TableColumn[]>> {
    const cfg = await conn(p);
    const names = await listTableNames(cfg);
    const out: Record<string, TableColumn[]> = {};
    for (const name of names) out[name] = await tableColumns(cfg, name);
    return out;
  },

  async get_all_foreign_keys_batch(p): Promise<Record<string, ForeignKey[]>> {
    const cfg = await conn(p);
    const names = await listTableNames(cfg);
    const out: Record<string, ForeignKey[]> = {};
    for (const name of names) out[name] = await tableForeignKeys(cfg, name);
    return out;
  },
};
