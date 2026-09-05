# ApartaYa — piloto El Salvador

Implementación local de los cuatro documentos propuestos: bot comerciante, reservas/pagos, entrega/expiración, PWA y operaciones. **No está desplegada ni conectada a WhatsApp o pagos reales.**

El workspace estaba vacío. El único documento recibido fue `05-plan-sprints-apartaya.md`; faltan `01-prd.md`, `02-arquitectura.md`, `03-supabase-schema.sql` y `04-flujos-bot.md`. La migración incluida es provisional y debe conciliarse con el esquema original antes de producción.

Actualización: se recibió `00-handoff-desarrollo.md` y se generó el [kit propuesto](docs/kit-propuesto/LEEME.md). El usuario pidió implementarlo y su ejecución está documentada en [ejecucion-documentos.md](docs/ejecucion-documentos.md). La configuración pendiente está en [configuracion-piloto.md](docs/configuracion-piloto.md).

## Implementado

- Migraciones 0002–0004 con flujos atómicos de publicación, reserva, pago, entrega y no-show; score, contraentrega controlada, outbox y conciliación.
- Bot con PUNTO, VENTAS, AYUDA, CANCELAR, ENTREGADO y vinculación de compradores.
- Adaptador Wompi El Salvador con OAuth, enlaces de pago y firma `wompi_hash`; habilitación por configuración.
- Next.js en `apps/web`: artículo, OTP SMS, checkout, consulta de pedido, condiciones y panel privado de operaciones.
- Cron SQL, CI/CD por entorno, generador de tarjetas QR y demostración local sin servicios externos.

- Receptor `POST /functions/v1/webhooks/messages` para Supabase Edge Functions.
- HMAC-SHA256 sobre bytes originales, validación de sesión y entrada acotada.
- Normalización de texto y fotos OpenWA; ignora mensajes propios, grupos y tipos no soportados.
- Alta de comerciantes y registro de eventos en una transacción PostgreSQL.
- Deduplificación por sesión y mensaje, leases y recuperación de procesos interrumpidos.
- Fotos JPEG/PNG/WebP de hasta 5 MiB en bucket privado; comprobación de cabecera y MIME, sin descargar URLs del remitente. No es un decodificador antivirus ni una recodificación de imágenes.
- Bot eco, con envío desactivado por defecto. Fotos omitidas por OpenWA solicitan reenvío; la descarga desde historial aún no está implementada.
- Worker autenticado de recuperación y Compose de OpenWA/Baileys con puerto ligado a localhost.
- CI y pruebas del receptor y de SQL mediante PostgreSQL WASM.

## Estructura

`supabase/functions/_shared` contiene lógica reutilizable por Deno y Node. `supabase/functions` contiene los puntos de entrada Edge. `supabase/migrations` contiene persistencia. `infra` contiene OpenWA. `tests` y `scripts` soportan desarrollo local. `apps/web` contiene Next.js preparado para Vercel.

## Verificación local

Requiere Node 22 o posterior.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run demo
npm.cmd ci --prefix apps/web
npm.cmd run dev:web
```

Las pruebas no envían mensajes ni necesitan credenciales. Las pruebas SQL usan PGlite y sustituyen únicamente roles y tabla `storage.buckets` administrados por Supabase; no equivalen a una validación del servicio Storage o de la plataforma Edge.

Para ejecutar el receptor contra servicios configurados:

```powershell
Copy-Item .env.example .env
# Completar .env en un editor local, sin compartir claves por chat.
npm.cmd run dev
```

El servidor escucha solo en `127.0.0.1:8787`. Nunca se inicia con credenciales faltantes. Para Supabase local se necesitan además Docker y Supabase CLI; no estaban instalados al iniciar esta ejecución. La función Edge `webhooks` enruta el sufijo `/messages`.

## Puesta en marcha y estado

Consultar [estado por tarea](docs/estado-ejecucion.md), [despliegue](docs/despliegue.md) y [operación y recuperación](docs/runbook.md). No hay cuentas provisionadas, migraciones remotas aplicadas, cobros, envíos reales ni compras realizadas.

Los contratos utilizados se contrastaron con la [documentación de webhooks OpenWA](https://docs.open-wa.org/guides/webhooks/), su [SDK](https://docs.open-wa.org/sdk/usage/), [instalación](https://docs.open-wa.org/getting-started/installation/) y [configuración de funciones Supabase](https://supabase.com/docs/guides/functions/function-configuration). Se seleccionó provisionalmente OpenWA `rmyndharis/openwa:0.23.3`, que corresponde a `ENGINE_TYPE=baileys` y puerto 2785; confirmar en la arquitectura pendiente que se refiere a este proyecto y versión.
