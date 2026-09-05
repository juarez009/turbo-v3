# Estado de ejecución — 2026-09-04

**Actualización vigente:** el usuario pidió implementar el kit y se ejecutaron los cuatro documentos como código local. Ver [ejecución y validaciones](ejecucion-documentos.md) y [configuración para staging](configuracion-piloto.md). Las secciones siguientes conservan el historial de la entrega anterior, no el estado actual de implementación.

País confirmado por el usuario: El Salvador. Fecha sugerida del plan: 7 de septiembre; no se han programado automatizaciones ni simulado semanas de operación.

## Actualización tras recibir el handoff

El handoff referencia los cuatro originales pero no los contiene. El usuario autorizó generarlos como alternativa y se creó [el kit propuesto](kit-propuesto/LEEME.md): PRD, arquitectura, SQL y copy del bot. Esto permite seguir con diseño e implementación local usando decisiones explícitas, sin presentar la propuesta como documentación original o reglas comerciales confirmadas. Las menciones a documentos faltantes abajo describen el estado de la primera entrega.

El nuevo SQL es un snapshot de revisión para base vacía, no una migración aplicada. Incluye tablas, RLS y restricciones del dominio; las RPC de reserva/pago/entrega/expiración siguen pendientes. Validación actual: 19 pruebas aprobadas, incluida ejecución del snapshot en PostgreSQL WASM y rechazo de reservas activas duplicadas, comerciante inconsistente y referencias de pago repetidas.

## Sprint 0

| Tarea | Estado | Evidencia / pendiente |
|---|---|---|
| INF-01 | Preparada parcialmente | Compose versionado con Baileys, persistencia, healthcheck y puerto local. Faltan VPS, Docker, dominio/TLS y validación real de auth del dashboard. |
| INF-02 | Pendiente externo | SIM, número dedicado y vinculación desde teléfono. |
| INF-03 | Implementación provisional | Migración de merchants, events, recibos y bucket privado. Falta esquema original, proyecto Supabase y aplicación real. |
| INF-04 | Implementado localmente | HMAC, normalización, rutas, límites y pruebas. Falta fixture real del número conectado y despliegue Edge. |
| INF-05 | Implementado localmente con alcance reducido | Eco y foto inline a Storage mediante adaptadores; recuperación con worker. Falta prueba real de API/Storage. Fotos omitidas solicitan reenvío; descarga por historial pendiente. |
| INF-06 | Parcial | CI preparada. No hay repositorio remoto ni pipeline de despliegue por rama; Vercel depende del frontend y cuentas. |
| OPS-01 | Pendiente externo | Chats manuales reales con cinco comerciantes y registro diario durante semanas 1–2. |
| OPS-02 | Borrador | Runbook escrito; no se han probado rotación <30 minutos, copias diarias ni restauración. |

**DoD Sprint 0 no cumplido:** no hay medición extremo a extremo <5 s ni evidencia de 48 h sin errores HMAC. El esquema y la integración requieren conciliación con los documentos base.

### Verificaciones realizadas

- `npm test`: 18 pruebas aprobadas; incluye migración ejecutada en PostgreSQL WASM, duplicados, leases, permisos de RPC, RLS declarada, bucket privado, firmas, fotos y fallos de servicios simulados.
- `npm run check`: sintaxis JavaScript correcta.
- `deno check supabase/functions/webhooks/index.ts supabase/functions/worker/index.ts`: correcto con Deno ejecutado mediante npm.
- Instalación reproducible en `package-lock.json`; auditoría npm de las dos entradas instaladas sin vulnerabilidades reportadas.
- No se ejecutó Docker Compose, Supabase real, Storage real ni una sesión real de OpenWA. El límite de tamaño y permisos de Storage requieren prueba contra Supabase, no solo PostgreSQL WASM.

## Sprints 1–3

| Tareas | Estado / dependencia |
|---|---|
| BOT-01, BOT-02, BOT-03 | Pendientes: flujos, copy, modelo de listing, seña y política de reserva. |
| PWA-01 | Pendiente: PRD/arquitectura, listings persistentes y requisitos de medición. |
| PAY-01, PAY-02 | Pendientes: cuenta y contrato Wompi El Salvador, credenciales sandbox, esquema original y reglas de pago. No se implementó una API de otro país por analogía. |
| BOT-04, SCH-01, BOT-05, PAY-03 | Pendientes: estados, plazos, score y reglas de expiración del PRD. |
| OPS-03 | Pendiente: reglas de liquidación, comisión, no-show y conciliación Wompi. |
| OPS-04 | Pendiente: identidad, destino QR definitivo y ejecución de impresión; no se compraron 500 tarjetas. |
| OPS-05, OPS-06, OPS-07 | Pendientes de campo y cuenta de negocio. No se reclutó ni contactó a terceros. |
| MTR-01 | Pendiente: métricas y criterios del PRD §9, más datos reales. |
| QA-01 | Parcial transversal: límites de entrada, privilegios mínimos y RLS en esquema inicial. Faltan rate limit distribuido, alertas de caída/baneo y auditoría real en Supabase. |

## Información necesaria para continuar

1. Los originales siguen sin estar disponibles, pero ya existe un kit propuesto generado para continuar. Antes de activar cobros deben cerrarse las condiciones comerciales señaladas en su LEEME.
2. Ubicación del repositorio remoto y proyectos Supabase/Vercel, si existen; VPS y dominio elegidos.
3. Confirmar cuenta Wompi El Salvador y acceso a su documentación/entorno de pruebas; configurar secretos en los servicios, nunca en este documento.
4. Responsable de operaciones, número dedicado, cinco comerciantes semilla y fechas reales del piloto.

## Decisiones provisionales

- El Sprint 0 no crea órdenes, listings, score ni liquidaciones sin conocer las reglas originales.
- Identidades WhatsApp se guardan como JID opaco. `@lid` no se convierte en un teléfono inventado.
- La firma de OpenWA no proporciona un timestamp firmado separado con tolerancia contractual. La protección contra repetición se basa en recibos persistentes por sesión/mensaje; no borrar esas claves sin diseñar retención.
- El sistema no promete entrega exactamente una vez a WhatsApp. Un envío incierto pasa a revisión para evitar una repetición automática; puede requerir recuperación manual.
- `held` es un estado final de pruebas con envío desactivado. Activar envíos no libera mensajes antiguos de forma masiva; las pruebas posteriores utilizan mensajes nuevos.
- Esqueleto del Sprint 0, no plataforma lista para atender comerciantes o cobrar.
