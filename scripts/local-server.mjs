import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { adapters, settings } from '../supabase/functions/_shared/adapters.mjs';
import { createHandler } from '../supabase/functions/_shared/handler.mjs';

const config = settings(name => process.env[name]);
const handler = createHandler(config, adapters(config));
const port = Number(process.env.PORT || 8787);
const server = createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method, headers: req.headers,
      ...(['GET','HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end(); }
});
server.requestTimeout = 15000;
server.listen(port, '127.0.0.1', () => console.log(`ApartaYa webhook: http://127.0.0.1:${port}/webhooks/messages`));
