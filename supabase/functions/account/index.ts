import { appConfig, createApp } from '../_shared/app.mjs';
Deno.serve(createApp(appConfig((name: string)=>Deno.env.get(name))));
