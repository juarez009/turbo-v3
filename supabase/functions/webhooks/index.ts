import { adapters, settings } from '../_shared/adapters.mjs';
import { createHandler } from '../_shared/handler.mjs';
import { appConfig, createApp } from '../_shared/app.mjs';

const config = settings((name: string) => Deno.env.get(name));
const messages = createHandler(config, adapters(config));
const app = createApp(appConfig((name: string) => Deno.env.get(name)));
Deno.serve((request: Request) => new URL(request.url).pathname.endsWith('/wompi') ? app(request) : messages(request));
