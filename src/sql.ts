export function quoteIdent(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

export function quoteLiteral(value: string): string {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

const READ_RE = /^\s*(select|with|pragma|explain)\b/i;
const WRAPPABLE_RE = /^\s*(select|with)\b/i;

export function isReadQuery(query: string): boolean {
  return READ_RE.test(query);
}

export function isWrappable(query: string): boolean {
  return WRAPPABLE_RE.test(query);
}

export function stripTrailingSemicolon(query: string): string {
  return query.replace(/;\s*$/, '').trim();
}

export function normalizeParam(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

const RAW_DEFAULT_RE = /^(-?\d+(\.\d+)?|null|true|false|current_date|current_time|current_timestamp)$/i;

export function defaultLiteral(value: string): string {
  const trimmed = value.trim();
  if (RAW_DEFAULT_RE.test(trimmed)) return trimmed;
  if (trimmed.startsWith("'") || trimmed.startsWith('(')) return trimmed;
  return quoteLiteral(trimmed);
}

export function columnDefinitionSql(
  col: {
    name: string;
    data_type: string;
    is_nullable: boolean;
    is_pk: boolean;
    is_auto_increment: boolean;
    default_value?: string | null;
  },
  inlinePrimaryKey: boolean,
): string {
  let sql = `${quoteIdent(col.name)} ${col.data_type || 'TEXT'}`;
  const pkInline = inlinePrimaryKey && col.is_pk;
  if (pkInline) {
    sql += ' PRIMARY KEY';
    if (col.is_auto_increment && /int/i.test(col.data_type)) sql += ' AUTOINCREMENT';
  }
  if (!col.is_nullable && !pkInline) sql += ' NOT NULL';
  if (col.default_value != null && col.default_value !== '') {
    sql += ` DEFAULT ${defaultLiteral(col.default_value)}`;
  }
  return sql;
}

export function pkWhereClause(p: Record<string, unknown>): { sql: string; params: unknown[] } {
  const pkMap =
    p.pk_map && typeof p.pk_map === 'object'
      ? (p.pk_map as Record<string, unknown>)
      : p.pk_col != null
        ? { [String(p.pk_col)]: p.pk_val }
        : {};
  const cols = Object.keys(pkMap);
  if (cols.length === 0) {
    throw new Error('No primary key provided. Tables without a primary key cannot be edited.');
  }
  return {
    sql: cols.map((c) => `${quoteIdent(c)} = ?`).join(' AND '),
    params: cols.map((c) => normalizeParam(pkMap[c])),
  };
}
