# Configuración para pasar de local a staging

1. Crear o seleccionar proyectos separados de staging y producción en Supabase y Vercel. Configurar repositorio GitHub. En Vercel usar raíz `apps/web`, build `npm run build`, framework Next.js. No asignar una misma base de datos a ambas ramas.
2. Aplicar `0001` a `0004` en orden mediante Supabase CLI. No ejecutar el snapshot `docs/kit-propuesto/03-supabase-schema.sql` junto con esas migraciones.
3. En Supabase Auth habilitar teléfono+OTP y configurar el proveedor SMS. Crear por canal administrativo una cuenta de operaciones y asignar `app_metadata.role=ops`; no usar `user_metadata` para privilegios.
4. Configurar secretos Edge desde `.env.example`. Generar `PICKUP_ENCRYPTION_KEY` como 32 bytes aleatorios codificados en 64 caracteres hexadecimales. Conservar esa clave al actualizar: cambiarla sin migrar cifrados inutiliza los códigos existentes. Configurar PUBLIC_APP_ORIGIN con dominio real, BOT_PHONE como 503 seguido de ocho dígitos y BOT_MODE=commerce.
5. Preparar OpenWA según `docs/despliegue.md`, vincular SIM, limitar API de operador a la sesión, habilitar HMAC y registrar `/functions/v1/webhooks/messages`. Comenzar con BOT_SEND_ENABLED=false; procesará reglas y guardará resultados, pero no enviará mensajes. Para habilitar probar con mensajes nuevos.
6. Publicar funciones `webhooks`, `worker`, `orders`, `listings`, `account`, `operations`. Configurar en Vercel las dos variables NEXT_PUBLIC de Supabase; nunca service_role.
7. En Vault crear apartaya_worker_url y apartaya_worker_secret. Ejecutar `supabase/scheduler.sql`. Revisar cron.job_run_details y respuestas de pg_net; no declarar sano un envío solo porque se encoló la llamada HTTP.
8. En el panel de operaciones habilitar el comerciante después del onboarding. Desde su WhatsApp: PUNTO → dirección → foto → precio. Abrir enlace, verificar SMS y enviar VINCULAR desde el mismo teléfono. Para `@lid` sin mapeo confiable, investigar la resolución del proveedor antes de habilitar compras.
9. Configurar Wompi con CLIENT_ID/API Secret del negocio de pruebas, WOMPI_LIVE=false y PAYMENTS_ENABLED=true solo cuando el ambiente y las condiciones del piloto estén listos. Probar callbacks reales, duplicados y pago tardío. Ver `docs/wompi-sv.md`.
10. Validar mediciones del plan, restauración, revisión de pagos inciertos y contacto de soporte visible antes de pasar a producción. El trabajo de campo y el cobro de prueba real no ocurrieron durante la implementación local.

Contraentrega inicia desactivada en pilot_settings; requiere activación explícita de configuración, número vinculado y score >=80 con >=3 entregas. Las reglas implementadas son las del kit propuesto.

## Comandos locales

```powershell
npm.cmd ci
npm.cmd ci --prefix apps/web
npm.cmd test
npm.cmd run demo
npm.cmd run dev:web
```

Generar tarjetas solo cuando exista un destino correcto:

```powershell
node scripts/qr-card.mjs https://tu-dominio/slug "Nombre del artículo"
```

Los archivos de artifacts son generados, no registros de producción. La demo incluye números ficticios y URLs de ejemplo.
