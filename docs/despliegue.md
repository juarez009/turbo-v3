# Despliegue Sprint 0 — procedimiento pendiente de ejecución

## Antes de aplicar

Conciliar `0001_init.sql` con `03-supabase-schema.sql`. Usar primero un proyecto de staging vacío. Instalar Docker y Supabase CLI. Preparar un secreto HMAC y uno del worker de 32 caracteres aleatorios o más; no reutilizar las claves API como secretos HMAC.

## OpenWA

1. En el VPS, copiar `infra/.env.example` a `infra/.env` y configurar `OPENWA_MASTER_KEY` con una clave fuerte.
2. Ejecutar `docker compose --env-file infra/.env -f infra/compose.yaml config --quiet` y luego `docker compose --env-file infra/.env -f infra/compose.yaml up -d`.
3. Acceder al dashboard mediante túnel SSH al puerto local 2785, autenticar con la clave administrativa y crear una clave de operador limitada a la sesión para el bot. No publicar el dashboard sin control de acceso.
4. Vincular el teléfono con la SIM dedicada. Guardar el ID real de sesión.
5. Exponer únicamente la API necesaria detrás de un proxy HTTPS autenticado por OpenWA para que Supabase pueda enviar respuestas. Restringir el dashboard al túnel o a una capa de autenticación adicional. Esa configuración depende del dominio/VPS y aún no está provisionada.

## Supabase

1. Configurar secretos `OPENWA_BASE_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `OPENWA_WEBHOOK_SECRET`, `WORKER_SECRET`, `BOT_SEND_ENABLED=false`. Supabase suministra URL y service role en funciones hospedadas; comprobar el entorno.
2. Vincular el CLI al proyecto staging correcto, revisar la migración con `supabase db push --dry-run` y aplicar `supabase db push` después de conciliar el esquema.
3. Ejecutar `supabase functions deploy webhooks` y `supabase functions deploy worker`. Ambas tienen JWT de plataforma desactivado porque implementan autenticación propia; no eliminar esa validación del código.
4. Registrar en la sesión OpenWA un webhook con `events: ["message.received"]`, el secreto configurado y URL `https://<proyecto>.supabase.co/functions/v1/webhooks/messages`.
5. Enviar desde el dashboard el evento de prueba. Luego probar texto e imagen desde un contacto autorizado. Con envíos desactivados deben aparecer registros `held` y, para la imagen, objeto privado en `merchant-photos`.
6. Habilitar `BOT_SEND_ENABLED=true` para la prueba acordada y usar mensajes nuevos. Medir ida/vuelta real y comprobar una sola respuesta ante reentrega.
7. Configurar un scheduler cada minuto que haga POST a `/functions/v1/worker` con `Authorization: Bearer <WORKER_SECRET>`. Guardar el secreto en Vault si se usa pg_cron + pg_net; no incrustarlo en SQL versionado. Este scheduler NO fue configurado. Sin él, una caída tras aceptar un mensaje depende de la reentrega de OpenWA o de ejecutar manualmente el worker.

## Aceptación

- Repetir una misma entrega: un recibo, un evento de recepción, una respuesta.
- Firma incorrecta: HTTP 401 y ninguna escritura.
- Foto válida: objeto privado y evento con ruta; acceso anónimo denegado.
- Storage caído: 503/retry y ninguna confirmación falsa de foto guardada.
- Fallo incierto de envío: `needs_review`, sin reenvío automático.
- Worker: 401 sin secreto y procesamiento acotado a cinco recibos con autorización.
- Medir respuesta <5 s. El código usa presupuestos de timeout para fallos, no garantiza este SLO.
- Observar 48 h, verificar respaldos mediante restauración y documentar evidencia antes de cerrar Sprint 0.

## CI/CD restante

La CI versionada corre pruebas de Node y comprobación de Deno. Falta crear el remoto y configurar despliegue por rama con proyectos separados para staging/producción. No se creó un workflow que aplique un esquema provisional automáticamente. Vercel y presupuesto SSR corresponden al frontend Next.js aún pendiente.
