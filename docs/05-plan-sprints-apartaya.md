# Plan de Sprints — ApartaYa (Piloto 8 semanas)

Versión 1.0 · Inicio sugerido: lunes 7-sep-2026 · Equipo: 1 dev full-stack + 1 ops/campo
Documentos base: `01-prd.md`, `02-arquitectura.md`, `03-supabase-schema.sql`, `04-flujos-bot.md`

---

## Sprint 0 — Infraestructura y canal (Semanas 1–2)

**Meta:** bot “eco” en producción sobre número dedicado, con datos persistiendo en Supabase.

| ID | Tarea | Est. | Dep. |
|---|---|---|---|
| INF-01 | Provisionar VPS + Docker Compose OpenWA (`ENGINE_TYPE=baileys`), dashboard :2785 detrás de auth | 1 d | — |
| INF-02 | Comprar SIM nueva, registrar número dedicado, vincular sesión OpenWA | 0.5 d | INF-01 |
| INF-03 | Crear proyecto Supabase; aplicar migración `0001_init.sql`; buckets Storage (fotos) | 1 d | — |
| INF-04 | Edge Function `/webhooks/messages`: validación HMAC + normalizador OpenWA → `NormalizedMessage` | 2 d | INF-01, INF-03 |
| INF-05 | Bot Engine skeleton: upsert merchant, eco de texto, recepción de imagen → Storage | 2 d | INF-04 |
| INF-06 | CI/CD: repo monorepo, Vercel + `supabase functions deploy` por rama | 1 d | — |
| OPS-01 | Warm-up del número: 10–30 chats manuales reales/día con 5 comerciantes semilla (toda la semana 1–2) | continuo | INF-02 |
| OPS-02 | Runbook de rotación de número (< 30 min) + respaldo diario verificado | 0.5 d | INF-03 |

**DoD Sprint 0:** mensaje → router → respuesta en < 5 s; foto guardada en Storage; `merchants` + `events` escribiendo; 0 errores HMAC en logs de 48 h.

## Sprint 1 — Flujo comerciante + checkout (Semanas 3–4)

**Meta:** del QR físico a seña pagada, extremo a extremo.

| ID | Tarea | Est. | Dep. |
|---|---|---|---|
| BOT-01 | Máquina de estados completa (IDLE/AWAITING_PRICE) con copy de `04-flujos-bot.md` | 2 d | INF-05 |
| BOT-02 | Creación de listing: slug, seña sugerida, enlace + texto reenviable | 1 d | BOT-01 |
| PWA-01 | Next.js PWA `/[slug]`: SSR < 100 KB, LCP < 2.5 s en 3G, estados no disponibles | 3 d | INF-06 |
| PAY-01 | `POST /api/orders`: crea orden + checkout Wompi; opción contraentrega por score | 2 d | PWA-01 |
| PAY-02 | `/webhooks/wompi`: firma, idempotencia por `provider_ref`, transiciones de orden | 2 d | PAY-01 |
| BOT-03 | Notificaciones de seña pagada a comerciante y código de retiro a comprador | 1 d | PAY-02 |

**DoD Sprint 1:** compra de prueba con tarjeta real ($1) completada; landing pasa presupuesto de performance; estados consistentes ante pago fallido.

## Sprint 2 — Entrega, recordatorios y score (Semanas 5–6)

**Meta:** ciclo de vida completo del pedido sin intervención manual.

| ID | Tarea | Est. | Dep. |
|---|---|---|---|
| BOT-04 | Comandos `ENTREGADO`, `PUNTO`, `VENTAS`, `AYUDA` (incl. idempotencia de entrega) | 2 d | BOT-03 |
| SCH-01 | pg_cron: expiración de órdenes (`expire_reserved_orders`) + envío de `reminders` | 1.5 d | PAY-02 |
| BOT-05 | Mensajes push: recordatorio 2 h, expiración (ambas partes), resumen diario 19:30 | 1.5 d | SCH-01 |
| PAY-03 | Score v1: recálculo en eventos terminales + regla de contraentrega en PWA | 1 d | SCH-01 |
| OPS-03 | Reporte de liquidación diario por comerciante (señas + compensaciones no-show) | 1 d | SCH-01 |
| OPS-04 | Tarjetas QR físicas (diseño + 500 impresas) + guion de demo de 10 min | 2 d | — |

**DoD Sprint 2:** pedido simulado con no-show expira solo, score baja, listing reabre; resumen `VENTAS` cuadra con `events`.

## Sprint 3 — Piloto en campo (Semanas 7–8)

**Meta:** 20 comerciantes activos en zona Metrogalerías/Mercado Central.

| ID | Tarea | Est. | Dep. |
|---|---|---|---|
| OPS-05 | Reclutamiento: 20 comerciantes (asociaciones afectadas por Fase 8 + semilla) | continuo | OPS-04 |
| OPS-06 | Onboarding en campo: time-to-first-link < 3 min medido con cronómetro | continuo | OPS-05 |
| OPS-07 | Incentivo: plataforma absorbe comisión Wompi de primeras 5 señas por comerciante | 0.5 d | OPS-05 |
| MTR-01 | Dashboard mínimo (consultas sobre `events`): métricas del PRD actualizadas a diario | 2 d | BOT-05 |
| QA-01 | Hardening: rate limits, alertas de caída/baneo OpenWA, revisión RLS | 2 d | — |

**DoD Sprint 3 (Go/No-Go):** criterios del PRD §9 medidos sobre datos reales; retro documentada; decisión de migración a Cloud API si se superan umbrales.

---

## Dependencias críticas y riesgos del plan

- **Warm-up del número (OPS-01) no es negociable:** habilitar el bot a volumen antes de la semana 3 eleva el riesgo de baneo justo antes del piloto.
- **Cuenta Wompi:** abrir y verificar la cuenta de negocio en semana 1 (trámite, no bloquea código pero sí PAY-02 en producción).
- **Un solo dev:** si PAY-02 se atrasa, recortar MTR-01 (dashboard) antes que SCH-01 (expiración) — el no-show es la promesa de valor.
- **Comerciantes semilla:** confirmar los 5 en semana 0; son el canal de warm-up y la primera evidencia.

## Ceremonias ligeras

- Daily async por chat (10 min escrito).
- Demo al cierre de cada sprint con 1 comerciante semilla presente.
- Retro de 30 min: una mejora de copy del bot por sprint (los textos son el producto).
