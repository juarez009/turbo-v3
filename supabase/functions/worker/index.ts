import { adapters, settings } from '../_shared/adapters.mjs';
import { processMessage } from '../_shared/handler.mjs';
import { drainNotices } from '../_shared/notifications.mjs';

const config = settings((name: string) => Deno.env.get(name));
const deps = adapters(config);
const notificationConfig = {...config, PICKUP_ENCRYPTION_KEY:Deno.env.get('PICKUP_ENCRYPTION_KEY')};
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  // Hash before comparing, so neither the secret length nor prefix affects comparison.
  const hash = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const a = new Uint8Array(await hash(request.headers.get('authorization') ?? ''));
  const b = new Uint8Array(await hash(`Bearer ${config.WORKER_SECRET}`));
  if (a.reduce((result, value, i) => result | (value ^ b[i]), 0) !== 0) return new Response(null, { status: 401 });
  try {
    const jobs = await deps.pending();
    const results = [];
    for (const job of jobs) results.push(await processMessage(job.id, deps, config.sendEnabled));
    const notices = config.botMode === 'commerce' ? await drainNotices(notificationConfig, deps, deps) : null;
    return Response.json({ processed: results.length, results, notices });
  } catch {
    console.error(JSON.stringify({ event: 'worker_failed' }));
    return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
  }
});
