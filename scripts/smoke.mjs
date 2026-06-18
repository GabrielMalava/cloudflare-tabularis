import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const envPath = join(root, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const host = process.env.CF_ACCOUNT_ID;
const database = process.env.CF_DATABASE_ID;
const password = process.env.CF_API_TOKEN;

if (!host || !database || !password) {
  console.error('Faltam credenciais. Crie .env.local (veja .env.local.example) ou exporte CF_ACCOUNT_ID, CF_DATABASE_ID, CF_API_TOKEN.');
  process.exit(1);
}

const conn = { host, database, password };

const requests = [
  { id: 1, method: 'test_connection', params: { params: conn } },
  { id: 2, method: 'get_databases', params: { params: conn } },
  { id: 3, method: 'get_tables', params: { params: conn, schema: null } },
  { id: 4, method: 'execute_query', params: { params: conn, query: 'SELECT 1 AS one, \'hello\' AS greeting', limit: 100, page: 1 } },
];

const bundle = join(root, 'dist', 'index.cjs');
if (!existsSync(bundle)) {
  console.error("dist/index.cjs não existe. Rode 'npm run build' primeiro.");
  process.exit(1);
}

const child = spawn('node', [bundle], { stdio: ['pipe', 'pipe', 'inherit'] });

let buffer = '';
const labels = Object.fromEntries(requests.map((r) => [r.id, r.method]));

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const label = labels[msg.id] ?? `id=${msg.id}`;
    if (msg.error) {
      console.log(`\n✗ ${label}\n  ERROR: ${msg.error.message}`);
    } else {
      console.log(`\n✓ ${label}\n  ${JSON.stringify(msg.result)}`);
    }
  }
});

child.on('exit', () => process.exit(0));

for (const req of requests) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...req }) + '\n');
}
child.stdin.end();
