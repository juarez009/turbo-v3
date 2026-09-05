# Kit de desarrollo propuesto — ApartaYa

**Estado actual:** el usuario solicitó ejecutar este kit y ya existe implementación local. Consultar [el informe de ejecución](../ejecucion-documentos.md). Este directorio conserva el diseño v0.1 como referencia; el esquema vigente se aplica desde `supabase/migrations`, no desde el snapshot de este directorio.

Versión 0.1. Elaborado a partir de `05-plan-sprints-apartaya.md`, `00-handoff-desarrollo.md`, la confirmación de El Salvador y el código local del Sprint 0.

Estos documentos son una **propuesta nueva**, no una recuperación de los archivos originales mencionados en el handoff. Permiten continuar el diseño y desarrollo local sin esperar esos archivos. No acreditan un despliegue, validación comercial ni implementación completa.

1. [PRD](01-prd-apartaya.md): requisitos, reglas propuestas y aceptación.
2. [Arquitectura](02-arquitectura-apartaya.md): componentes, contratos y secretos.
3. [Esquema SQL](03-supabase-schema.sql): snapshot para una base vacía, con el Sprint 0 y tablas propuestas del MVP. No está en la carpeta de migraciones automáticas. Las operaciones transaccionales de pedidos se especifican en la arquitectura y faltan por implementar.
4. [Flujos del bot](04-flujos-bot-apartaya.md): estados y copy propuesto.

## Cómo interpretar las decisiones

- **Confirmado:** aparece en el plan o en una respuesta del usuario.
- **Propuesto:** decisión de diseño creada aquí para poder implementar y probar. Puede cambiar sin contradecir el plan.
- **Pendiente externo:** depende de cuentas, recursos de campo o contrato real del proveedor.

El esquema completo se puede probar en PostgreSQL local aislado. En una base donde ya se aplicó `0001_init.sql`, NO ejecutar este snapshot: preparar una migración incremental cuando se implemente el dominio. El código actual sigue siendo el Sprint 0.

Validación realizada: 19 pruebas aprobadas en el proyecto. El snapshot se ejecutó en PostgreSQL WASM y se comprobaron restricciones de reserva activa única, pertenencia del pedido al comerciante, referencia de pago única y tablas privadas. No se probaron cobros o transacciones de negocio aún no implementadas. `schema-dominio.sql` es la extensión propuesta usada para construir el snapshot; no ejecutar ambos archivos sobre la misma base.

## Decisiones que requieren definición antes de cobrar

La propuesta usa USD, una seña sugerida del 20 %, ventana de checkout de 15 minutos, retiro hasta 24 horas después de reservar y contraentrega desactivada inicialmente. Son parámetros de prueba, no reglas comerciales confirmadas. Deben mostrarse al comprador con términos claros antes de activar pagos.

Cancelaciones, devoluciones, compensación por no-show, comisión real y liquidación al comerciante quedan en revisión operativa hasta definir el contrato de negocio y las capacidades de Wompi El Salvador. No se supone que la plataforma pueda retener o distribuir dinero automáticamente.
