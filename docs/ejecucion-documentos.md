# Ejecución de los cuatro documentos

La propuesta pasó a código local. Esto no equivale a poner el piloto en producción.

| Documento | Implementación |
|---|---|
| 01 PRD | PWA de artículo, SMS, vinculación WhatsApp, checkout, pedido con código, panel de operaciones y condiciones; reglas de seña, plazos, score y contraentrega. |
| 02 Arquitectura | Edge Functions separadas, normalizadores y adaptadores, JWT verificado por Supabase Auth, firma Wompi SV, outbox, worker y fachada Next `/api/orders` sin service_role. |
| 03 SQL | Migraciones incrementales `0002_domain.sql`, `0003_workflows.sql`, `0004_operations.sql`; se ejecutaron en PostgreSQL WASM local, no en Supabase remoto. |
| 04 Flujos | Foto/precio, borrador, PUNTO, VENTAS, AYUDA, CANCELAR, ENTREGADO, vinculación de comprador y mensajes de pago/recordatorio/expiración. |

## Verificación

- 33 pruebas automatizadas aprobadas: firma de los dos proveedores, casos de entrada, migraciones, privilegios, reserva única, callbacks repetidos/tardíos, entrega idempotente, no-show, score, subsidio de comisión, vinculación del número, recuperación de notificaciones, privacidad de proyecciones y reintento de checkout sin pago incierto.
- `npm run demo`: recorrido ficticio con 1 publicación, 1 pago simulado, 1 entrega y callback duplicado ignorado. Evidencia generada en `artifacts/demo-result.md` y `.json`.
- Web Next.js compila para producción. Rutas de inicio, artículo, pedido, operaciones, condiciones y fachada `/api/orders`.
- Deno comprueba puntos de entrada de funciones. Las extensiones reales de Supabase no están en PostgreSQL WASM.

## Diferencias y límites concretos

- El snapshot original del kit conserva la propuesta v0.1; para desplegar usar exclusivamente `supabase/migrations` en orden. No aplicar también el snapshot.
- Las mutaciones del dominio usan un lock transaccional compartido para el piloto. Evita carreras sin llamadas externas bajo lock; limita el volumen y deberá particionarse si crece la demanda.
- La vinculación automática admite JID con teléfono verificable. Un `@lid` se conserva como identidad opaca, pero no se asocia automáticamente a un comprador sin un mapeo confiable del proveedor.
- El OTP SMS requiere proveedor configurado en Supabase. No hay bypass local de autenticación en la PWA. La demo usa datos ficticios aislados y no comparte endpoints con producción.
- Reembolsos, compensaciones y transferencias requieren revisión operativa; no se automatizó movimiento de dinero. El reporte distingue conceptos; la comisión real se registra con referencia y aplica subsidio de las primeras cinco señas.
- Las fotos tienen almacenamiento privado, validación MIME/tamaño y optimización WebP responsive en Next.js, restringida al bucket de fotos configurado y sin redirecciones. No se acredita LCP <2.5 s en 3G ni HTML de producto <100 KB sin una publicación real y medición reproducible.
- La métrica de primer enlace usa habilitación del comerciante como inicio técnico; la medición con cronómetro en campo sigue siendo necesaria.
- La PWA tiene manifiesto y aviso offline; no cachea pedidos, códigos o inventario. La instalación móvil y accesibilidad visual no se verificaron en dispositivo.
- WebMCP expone lectura del artículo si el navegador lo soporta; no se verificó en un contexto compatible y no puede crear pagos.
- Las notificaciones con resultado incierto pasan a revisión. El worker recupera pendientes, pero no promete entrega exactamente una vez por parte de WhatsApp.
- La sonda `scripts/healthcheck.mjs` está preparada; conectar un monitor con aviso sigue pendiente. No se enviaron notificaciones a terceros.

## Preparado para provisionar

- `supabase/scheduler.sql`: expiración cada minuto y llamada al worker con secreto desde Vault. [Patrón oficial de Cron](https://supabase.com/docs/guides/cron/quickstart). Aún sin ejecutar en Supabase.
- `.github/workflows/ci.yml`: pruebas, Deno y build web.
- `.github/workflows/deploy.yml`: ramas `develop` → staging, `main` → production; cada entorno debe apuntar a proyectos Supabase/Vercel distintos. Configurar protección del entorno production en GitHub.
- `scripts/qr-card.mjs`: genera cuatro tarjetas QR por hoja con el enlace definitivo. Impresión de 500 tarjetas y validación con cámara pendientes.
- Runbook existente: respaldo diario, restauración y rotación de número por ensayar.

No hay `.env`, remoto Git ni proyecto Vercel vinculado en este workspace. Tampoco se encontraron Docker, Supabase CLI o Vercel CLI instalados globalmente. Esto impide ejecutar el despliegue remoto y las pruebas con cuentas reales sin configuración adicional.

## Continuación — 5 de septiembre de 2026

Se añadieron límites compartidos para consultas públicas y autenticadas, validación de configuración antes de activar pagos, imágenes optimizadas, mantenimiento de la sesión durante renovación del JWT y aislamiento de datos de UI al cambiar de cuenta. El reintento de checkout solo se ofrece tras estado terminal sin transacciones pendientes/aprobadas/en revisión.

La web volvió a compilar correctamente y Deno validó las seis funciones. El servidor de producción local está preparado en `http://127.0.0.1:3000`. Las comprobaciones HTTP se guardan en `artifacts/http-smoke.json`; no representan navegación con comprador autenticado ni una medición LCP.
