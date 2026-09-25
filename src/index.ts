import { createInterface } from 'node:readline';
import { handlers } from './handlers.ts';

interface RpcRequest {
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;

  let req: RpcRequest;
  try {
    req = JSON.parse(text) as RpcRequest;
  } catch {
    send({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    return;
  }

  const id = req.id ?? null;
  const method = req.method ?? '';
  const handler = handlers[method];

  if (!handler) {
    send({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id });
    return;
  }

  try {
    const result = await handler(req.params ?? {});
    send({ jsonrpc: '2.0', result: result === undefined ? null : result, id });
  } catch (e) {
    const err = e as Error;
    process.stderr.write(`[cloudflare-d1-http] ${method} failed: ${err.stack ?? err.message}\n`);
    send({ jsonrpc: '2.0', error: { code: -32603, message: err.message ?? String(e) }, id });
  }
});
