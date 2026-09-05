# PRD propuesto — ApartaYa

Versión 0.1 · País confirmado: El Salvador · Alcance: piloto de ocho semanas.

## 1. Problema y resultado

El plan busca que un comerciante publique desde WhatsApp, comparta un enlace y permita que un comprador aparte un artículo con una seña. El pedido tiene código de retiro, recordatorios y vencimiento; un no-show libera el artículo y modifica el score. Se propone medir si este flujo reduce apartados incumplidos sin añadir trabajo excesivo al comerciante.

## 2. Usuarios y alcance

- Comerciante: recibe onboarding, envía foto/precio, comparte enlace, configura punto de retiro y confirma entregas.
- Comprador: abre enlace sin instalar una app, revisa precio/seña/plazo, paga y recibe código.
- Operador: incorpora comerciantes, resuelve pagos inciertos y consulta conciliación y métricas.

Confirmado: QR físico, WhatsApp, PWA Next.js, Supabase, Wompi, comandos ENTREGADO/PUNTO/VENTAS/AYUDA y 20 comerciantes en el piloto. Propuesto: un listing representa una unidad; múltiples unidades requieren publicaciones separadas. Fuera de esta versión: carrito multicomerciante, envíos a domicilio, marketplace navegable, crédito y liquidación automática sin contrato confirmado.

## 3. Publicación

Foto válida → solicitar precio → crear listing → devolver enlace y texto reenviable. El comerciante debe estar habilitado por operaciones; recibir un mensaje y existir en `merchants` no implica autorización para vender.

Propuesto: precio en centavos USD, de $1.00 a $1,000.00; nunca usar coma flotante para cálculos monetarios. Seña sugerida: redondear hacia arriba el 20 % en centavos, con mínimo $1.00 y sin superar precio. Ejemplo de prueba: precio $12.50, seña $2.50, saldo $10.00. Estos límites son configurables antes del piloto.

Aceptación: foto+precio válido produce un único listing aun con reentregas; texto inválido conserva la foto y vuelve a pedir precio; slug aleatorio no deriva del teléfono; ningún cliente obtiene teléfonos, score ni datos privados a través del listing.

## 4. Compra y estados

El comprador ve foto, precio, seña, saldo, lugar, plazo y condiciones de cancelación/no-show. El número de contacto debe verificarse antes de usar su historial para contraentrega; un número escrito en un formulario no prueba identidad.

Estados de pedido propuestos:

| Estado | Significado y salidas |
|---|---|
| pending_payment | Unidad bloqueada durante checkout; pasa a reserved, payment_failed o expired. |
| reserved | Seña confirmada o contraentrega autorizada; pasa a delivered, expired o cancelled. |
| payment_failed | Fallo definitivo confirmado; libera unidad si aún le pertenece. |
| expired | Checkout o retiro vencido; no se reactiva por un callback tardío. |
| delivered | Entrega confirmada una sola vez. |
| cancelled | Cancelación revisada; efecto económico se concilia por separado. |
| payment_review | Pago tardío, importe incorrecto o resultado ambiguo; no garantiza reserva. |

Propuesto: checkout dura 15 minutos; reserva, 24 horas desde confirmación. Usar reloj de base de datos. No considerar una redirección de navegador como pago confirmado. Un pago tardío no desplaza una reserva posterior: se abre revisión y se informa al comprador.

Aceptación: dos compras concurrentes solo consiguen una reserva; reintentar el mismo checkout devuelve la misma orden; cambio de importe/moneda/referencia impide confirmar; callback duplicado no duplica efectos ni notificaciones.

## 5. Retiro, expiración y score

Confirmado: recordatorio dos horas antes de vencer, aviso de expiración a ambas partes, reapertura de listing y resumen diario 19:30. Propuesto: zona `America/El_Salvador`; saltar recordatorio si el plazo ya venció; revalidar estado justo antes de enviarlo.

`ENTREGADO <código>` exige comerciante propietario y pedido reservado. Propuesto: código aleatorio de ocho caracteres, guardado como hash y enviado solo al comprador. Intentos de código limitados. Una entrega repetida devuelve la confirmación existente sin incrementar ventas o score. Una entrega posterior al vencimiento se deriva a operaciones.

Score v1 propuesto: comienza en 50; suma 5 por entrega, resta 15 por no-show de una reserva; acotar 0–100. No penalizar checkout abandonado, pago fallido ni cancelación atribuible al comerciante. Recalcular desde eventos únicos para poder auditar. Contraentrega: flag desactivado inicialmente; cuando se active, exige identidad verificada, score >=80 y al menos tres entregas. Esta fórmula es una hipótesis, no está en el plan recibido.

## 6. Dinero y conciliación

Separar precio, seña cobrada, saldo en retiro, comisión proveedor, subsidio y monto liquidado. Confirmado: plataforma absorbe comisión de primeras cinco señas por comerciante; propuesto: contar transacciones confirmadas únicas en orden temporal, no intentos de checkout. Registrar comisión real del proveedor; no inventar un porcentaje.

No-show abre un caso de conciliación; cualquier compensación requiere política publicada y revisión. No equiparar `expired` con dinero ganado por el comerciante. Un reporte separa cobrado, pendiente, reembolsado, en revisión y liquidado. Las transferencias no se ejecutan como consecuencia implícita de un cambio de estado.

## 7. Requisitos no funcionales

Confirmado por el plan: respuesta del bot <5 s, presupuesto SSR <100 KB y LCP <2.5 s en 3G. Propuesto para medir: reportar HTML transferido comprimido por separado del JavaScript inicial y assets; probar móvil con perfil de red/CPU documentado, caché fría y cinco ejecuciones. No declarar cumplido sin resultados. La interpretación exacta del presupuesto SSR debe quedar explícita en cada informe.

HMAC antes de efectos, deduplicación persistente, operaciones críticas atómicas, bucket privado, secretos solo servidor, logs sin cuerpos/tokens, alertas de canal caído y rate limits compartidos. Respaldo diario con restauración probada. Publicaciones deshabilitadas y pagos no disponibles deben ser estados comprensibles, no errores genéricos.

## 8. Criterios por sprint

0: mensaje real autenticado → comerciante/evento → respuesta y foto privada; 48 h observadas sin errores HMAC. 1: checkout real de prueba y consistencia ante fallo. 2: reserva expira sin intervención, artículo reabre, score correcto y VENTAS conciliable. 3: veinte comerciantes, onboarding medido, métricas reales y retro con decisión de continuidad.

## 9. Métricas y Go/No-Go propuestos

El §9 original no fue recibido. Los siguientes umbrales son nuevos y deben tratarse como hipótesis:

| Métrica | Definición | Meta propuesta |
|---|---|---|
| Comerciantes activos | Habilitados con >=1 publicación en últimos 7 días | 20 al cierre, conforme al plan |
| Time-to-first-link | Desde inicio de demo hasta primera publicación | Mediana <3 minutos; reportar p90 |
| Conversión | Reservas pagadas / sesiones de checkout válidas | Reportar sin umbral hasta obtener línea base |
| No-show | Reservas vencidas sin entrega / reservas que ya llegaron a estado terminal | Comparar con línea base de comerciantes |
| Entregas | Pedidos delivered / reservas terminales | >=80 %, con al menos 30 reservas terminales |
| Consistencia | Dobles reservas, dobles cobros atribuibles a la app, descuadres inexplicados | 0 incidentes sin resolver |
| Estabilidad | Disponibilidad del receptor y del canal, medidas por separado | >=99 % durante ventanas de piloto |

Eventos mínimos: merchant_enabled, listing_created, checkout_started, payment_confirmed, order_reserved, reminder_sent, order_delivered, order_expired, payment_review. Mantener identificador único, hora servidor y correlación de orden; evitar datos de tarjeta. El esquema propuesto incluye un registro de eventos de dominio separado de los recibos del bot.

Con muestra insuficiente: extender observación. Con errores de dinero o privacidad sin resolver: pausar cobros. La migración a Cloud API se evalúa por restricciones/incidentes reales y requisitos de proveedor; no hay umbral original recibido que se pueda afirmar como acordado.
