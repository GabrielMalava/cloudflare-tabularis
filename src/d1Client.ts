import type { ConnectionParams } from './types.ts';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export interface D1Config {
  accountId: string;
  databaseId: string;
  token: string;
}

export interface D1Meta {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
}

export interface AccountAuth {
  accountId: string;
  token: string;
}

export function accountAuthFromParams(params: ConnectionParams | undefined): AccountAuth {
  const accountId = (params?.host ?? '').trim();
  const token = (params?.password ?? '').trim();
  const missing: string[] = [];
  if (!accountId) missing.push('Account ID (Host field)');
  if (!token) missing.push('API token (Password field)');
  if (missing.length > 0) {
    throw new Error(`Missing Cloudflare D1 credentials: ${missing.join(', ')}.`);
  }
  return { accountId, token };
}

interface D1Envelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message: string }>;
  result?: T;
}

async function d1Post<T>(cfg: D1Config, endpoint: 'query' | 'raw', sql: string, params: unknown[]): Promise<T[]> {
  const url = `${API_BASE}/accounts/${encodeURIComponent(cfg.accountId)}/d1/database/${encodeURIComponent(cfg.databaseId)}/${endpoint}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });
  } catch (e) {
    throw new Error(`Network error contacting Cloudflare D1: ${(e as Error).message}`);
  }

  let json: D1Envelope<T[]>;
  try {
    json = (await res.json()) as D1Envelope<T[]>;
  } catch {
    throw new Error(`Cloudflare D1 returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok || !json.success) {
    const msg = (json.errors ?? [])
      .map((e) => (e.code ? `${e.code}: ${e.message}` : e.message))
      .join('; ');
    throw new Error(msg || `Cloudflare D1 request failed (HTTP ${res.status}).`);
  }
  return json.result ?? [];
}

export interface QueryObjectsResult {
  rows: Record<string, unknown>[];
  meta: D1Meta;
}

export interface QueryRawResult {
  columns: string[];
  rows: unknown[][];
  meta: D1Meta;
}

export async function queryObjects(cfg: D1Config, sql: string, params: unknown[] = []): Promise<QueryObjectsResult> {
  const result = await d1Post<{ results: Record<string, unknown>[]; meta: D1Meta }>(cfg, 'query', sql, params);
  const last = result[result.length - 1];
  return { rows: last?.results ?? [], meta: last?.meta ?? {} };
}

export async function queryRaw(cfg: D1Config, sql: string, params: unknown[] = []): Promise<QueryRawResult> {
  const result = await d1Post<{ results: { columns: string[]; rows: unknown[][] }; meta: D1Meta }>(cfg, 'raw', sql, params);
  const last = result[result.length - 1];
  return {
    columns: last?.results?.columns ?? [],
    rows: last?.results?.rows ?? [],
    meta: last?.meta ?? {},
  };
}

export async function exec(cfg: D1Config, sql: string, params: unknown[] = []): Promise<D1Meta> {
  const { meta } = await queryObjects(cfg, sql, params);
  return meta;
}

export interface D1Database {
  uuid: string;
  name: string;
}

export async function listDatabases(auth: AccountAuth): Promise<D1Database[]> {
  const url = `${API_BASE}/accounts/${encodeURIComponent(auth.accountId)}/d1/database`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
  } catch (e) {
    throw new Error(`Network error contacting Cloudflare D1: ${(e as Error).message}`);
  }
  let json: D1Envelope<D1Database[]>;
  try {
    json = (await res.json()) as D1Envelope<D1Database[]>;
  } catch {
    throw new Error(`Cloudflare D1 returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok || !json.success) {
    const msg = (json.errors ?? [])
      .map((e) => (e.code ? `${e.code}: ${e.message}` : e.message))
      .join('; ');
    throw new Error(msg || `Cloudflare D1 request failed (HTTP ${res.status}).`);
  }
  return json.result ?? [];
}
