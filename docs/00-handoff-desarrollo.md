# Handoff de Desarrollo — ApartaYa

Versión 1.0 · 4-sep-2026
Propósito: iniciar la conversación de implementación (con el equipo de desarrollo o un asistente de código) con todo el contexto necesario, sin filtrar credenciales.

---

## 1. Archivos a adjuntar

Adjuntar estos cuatro documentos del kit, en este orden de lectura:

| # | Archivo | Contenido |
|---|---|---|
| 1 | `01-prd-apartaya.md` | Requisitos funcionales con criterios de aceptación, alcance MVP, métricas |
| 2 | `02-arquitectura-apartaya.md` | Componentes, message router anti-lock-in, diagramas, variables de entorno |
| 3 | `03-supabase-schema.sql` | Migración inicial completa (tablas, enums, funciones, RLS) |
| 4 | `04-flujos-bot-apartaya.md` | Máquina de estados y copy exacto de todos los mensajes |

`05-plan-sprints-apartaya.md` es de gestión: opcional adjuntarlo, útil si se negocian plazos o prioridades.

## 2. Inventario de cuentas y recursos

Responder estas preguntas al inicio de la conversación de desarrollo. Solo **existencia y estado** de cada cuenta — nunca credenciales.

- [ ] **Supabase:** ¿proyecto ya creado o se arranca de cero? ¿Plan Free u otro? ¿Región elegida?
- [ ] **Vercel:** ¿cuenta existente vinculada a GitHub? ¿Monorepo nuevo o repo existente?
- [ ] **Wompi:** ¿cuenta de negocio ya verificada, en trámite, o sin iniciar? *(Cuello de botella del Sprint 1: la verificación es un trámite; iniciarlo en la semana 1 aunque el código aún no la use.)*
- [ ] **VPS:** ¿ya contratado (proveedor, vCPU/RAM, SO) o hay que provisionarlo? Mínimo recomendado: 1 vCPU / 2 GB RAM para OpenWA con motor `baileys`.
- [ ] **Número dedicado:** ¿SIM nueva ya disponible para el bot? (Requisito del protocolo anti-baneo; jamás un número personal.)

## 3. Reglas de seguridad (no negociables)

1. Nunca pegar claves, tokens, API keys ni secrets en el chat de desarrollo.
2. Las credenciales se configuran localmente en `.env`, siguiendo la plantilla de la sección 5 de `02-arquitectura-apartaya.md`.
3. El `.env` va en `.gitignore` desde el primer commit.
4. En Supabase: la `service_role` key solo vive en Edge Functions (variables de entorno del proyecto); la PWA usa exclusivamente la `anon` key + RLS.
5. Si una credencial se expone por accidente: rotarla de inmediato y registrar el incidente.

## 4. Mensaje listo para copiar

```
Para continuar, adjunto 01-prd-apartaya.md, 02-arquitectura-apartaya.md,
03-supabase-schema.sql y 04-flujos-bot-apartaya.md.

Antes de escribir código, decime qué cuentas y recursos tenés disponibles:

1. Supabase: ¿proyecto ya creado o arrancamos de cero? ¿Plan Free u otro?
2. Vercel: ¿cuenta existente vinculada a GitHub?
3. Wompi: ¿cuenta de negocio ya verificada o en trámite?
4. VPS: ¿ya tenés uno contratado (proveedor, vCPU/RAM) o hay que provisionarlo?
5. SIM nueva para el número dedicado del bot: ¿disponible?

⚠️ No compartás claves, tokens ni secrets en este chat. Las credenciales se
configurarán localmente en el archivo .env siguiendo la sección 5 de
02-arquitectura-apartaya.md; aquí solo necesito saber qué cuentas existen
y su estado.
```

## 5. Primer entregable esperado

Con los documentos adjuntos y el inventario respondido, el primer entregable de desarrollo es:

1. Edge Function `/webhooks/messages` (validación HMAC + normalizador OpenWA → `NormalizedMessage`).
2. Edge Function `/webhooks/wompi` (firma, idempotencia por `provider_ref`).
3. Migración `0001_init.sql` aplicada en el proyecto Supabase del piloto.

Corresponde a las tareas INF-03, INF-04 y PAY-02 del plan de sprints.
