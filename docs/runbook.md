# Operación — borrador a ensayar

## Revisión diaria del Sprint 0

1. Comprobar healthcheck del contenedor y estado `ready` de la sesión.
2. Revisar recibos `retry`, `needs_review` y leases vencidos. Revisar entregas fallidas de OpenWA.
3. Probar texto y foto con un comerciante semilla y medir tiempo total.
4. Registrar errores HMAC sin almacenar tokens ni cuerpos en logs.
5. Registrar chats manuales reales del warm-up; no se automatizan ni inventan contactos.

## Recuperación de envíos inciertos

Un timeout puede ocurrir después de que WhatsApp aceptó el envío. Por eso `sending` vencido se transforma en `needs_review`. Comparar hora, destinatario e historial de OpenWA; si el envío está confirmado, corregir el registro y documentar el incidente. Si se confirma que no hubo envío, reponer a `pending` mediante un procedimiento administrativo revisado y conservar auditoría. Nunca vaciar la tabla de recibos para forzar reintentos.

Después de cinco intentos fallidos se requiere revisión. El worker no reenvía registros `held`. El eco almacena texto del remitente en el recibo: acordar retención antes del piloto y conservar claves de deduplicación aunque se elimine contenido.

## Rotación de número — objetivo <30 minutos, aún sin ensayo

Requisitos: SIM de respaldo registrada, teléfono accesible, secretos disponibles al operador, listado de responsables y respaldo verificado.

1. Minutos 0–5: identificar si hay caída temporal o bloqueo; pausar el envío del bot y el webhook antiguo. Registrar inicio e incidente.
2. Minutos 5–15: crear y vincular una nueva sesión con el teléfono de respaldo. No mantener dos instancias activas con las mismas credenciales de sesión.
3. Minutos 15–20: configurar ID de sesión y clave de operador en Supabase. Registrar webhook firmado para la nueva sesión. Mantener merchants y recibos originales.
4. Minutos 20–25: habilitar envíos y probar texto/foto con un contacto autorizado. Revisar persistencia y respuesta única.
5. Minutos 25–30: el responsable de campo comunica el cambio a comerciantes autorizados y actualiza material que contenga el número. Registrar tiempo total y prueba.

Si el número no está previamente registrado o no hay acceso al teléfono, el objetivo no está garantizado. No borrar la sesión anterior hasta resolver los mensajes pendientes y preservar evidencia.

## Respaldo diario verificado

El respaldo no está programado todavía. Al disponer del VPS, implementar un job diario con almacenamiento cifrado fuera del VPS y alertas de fallo.

- Supabase: respaldo de base de datos y comprobación de restauración en un proyecto aislado. Incluir permisos, funciones y claves de deduplicación.
- Storage: copia de objetos de `merchant-photos` y manifiesto con checksums; un dump SQL no contiene los archivos de Storage.
- OpenWA: copia consistente de `infra/data` incluyendo SQLite, sesiones y medios. Detener brevemente OpenWA o usar el mecanismo de snapshot/backup consistente de SQLite; no copiar una base viva de forma arbitraria.
- Secretos: respaldo en gestor de secretos con acceso limitado; no incluirlos en el repositorio ni en informes.

La verificación requiere restaurar, arrancar en aislamiento, cotejar conteos y recuperar una imagen por checksum. No conectar simultáneamente la sesión restaurada y la original a WhatsApp. Registrar fecha, duración, checksum, resultado y operador. Definir retención con el PRD antes de producción.

## Registro de evidencia

| Fecha/hora | Operador | Prueba o incidente | Resultado | Duración | Evidencia sin secretos |
|---|---|---|---|---|---|
| Pendiente | | | | | |
