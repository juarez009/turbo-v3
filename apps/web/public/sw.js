// Never cache identity, inventory, payment state or pickup codes.
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Sin conexión · ApartaYa</title><body style="font:18px system-ui;padding:32px"><h1>Necesitás conexión</h1><p>Volvé a conectarte para consultar disponibilidad y pagos actualizados.</p><button onclick="location.reload()">Intentar de nuevo</button></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}})))});
