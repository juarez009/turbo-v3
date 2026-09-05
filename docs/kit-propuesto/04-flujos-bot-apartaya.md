# Flujos y copy propuestos — ApartaYa

Versión 0.1. Textos nuevos basados en las tareas del plan; no son el copy original ausente. Voz: español de El Salvador, trato de vos, instrucciones cortas. Variables entre llaves se sustituyen con valores del servidor, nunca con HTML arbitrario.

## Estados

Estados principales confirmados por el plan: IDLE y AWAITING_PRICE. Subflujo propuesto AWAITING_PICKUP_POINT para PUNTO; se representa como `intent` separado y conserva el borrador del listing. `CANCELAR` solo cancela el borrador o edición en curso, nunca un pedido pagado.

Procesar mensajes de un comerciante en serie. Un recibo duplicado recupera el resultado previo. Una foto nueva en AWAITING_PRICE reemplaza la foto del borrador y lo informa. Comandos globales se reconocen antes de parsear precio.

| Estado / entrada | Acción | Estado siguiente |
|---|---|---|
| IDLE + foto | Guardar foto y borrador | AWAITING_PRICE |
| AWAITING_PRICE + precio válido | Publicar atómicamente, emitir enlace | IDLE |
| AWAITING_PRICE + precio inválido | Mantener borrador, pedir corrección | AWAITING_PRICE |
| AWAITING_PRICE + nueva foto | Reemplazar foto pendiente | AWAITING_PRICE |
| Cualquier estado + AYUDA/VENTAS | Responder, conservar borrador | Sin cambio |
| Cualquier estado + PUNTO | Pedir dirección; conservar borrador | intent=pickup_point |
| intent=pickup_point + texto | Guardar punto; volver al flujo previo | intent=null |
| Cualquier estado + CANCELAR | Cancelar edición activa o borrador | IDLE o flujo previo |
| Cualquier estado + ENTREGADO código | Verificar propiedad/pedido/código | Sin alterar borrador |

Onboarding inicial solicita PUNTO antes de primera publicación. Comerciante no habilitado: `¡Hola! Para publicar con ApartaYa, primero completá el registro con nuestro equipo.` No crear enlaces vendibles por el simple upsert de un número.

## Crear publicación

Inicio/IDLE sin comando: `Para publicar, mandame una foto del artículo. También podés escribir AYUDA.`

Foto guardada: `¡Ya tengo la foto! ¿Cuál es el precio en dólares? Escribí, por ejemplo: 12.50.`

Precio inválido: `No pude leer el precio. Escribilo en dólares, por ejemplo: 12.50. Para salir, escribí CANCELAR.` Parser propuesto acepta `12`, `12.50`, `$12.50`; rechaza negativos, notación exponencial, separadores ambiguos y más de dos decimales.

Fuera de rango: `Para este piloto, el precio debe estar entre {min_price} y {max_price}. Mandame otro precio.`

Foto reemplazada: `Cambié la foto del borrador. Ahora mandame el precio en dólares.`

Falta punto: `Antes de publicar, indicá dónde se retira. Escribí PUNTO y seguí las instrucciones.` Conservar borrador y precio para no obligar a reenviar foto.

Publicación creada:

> ¡Listo! Tu artículo está publicado.
> Precio: {price}
> Seña: {deposit}
> Saldo al retirar: {balance}
> {listing_url}
>
> Reenviá este texto:
> Apartá este artículo por {deposit}. Precio total: {price}. Retiro en {pickup_point}. Mirá las condiciones y reservá aquí: {listing_url}

Si falla guardar, no generar una confirmación ni enlace de éxito. `No pude terminar la publicación. Conservé tu borrador; intentá de nuevo en un momento.` Solo afirmar conservación si la transacción correspondiente existe.

## PUNTO, VENTAS, AYUDA y CANCELAR

PUNTO: `Escribí la dirección y una referencia corta del lugar de retiro. Esta información aparecerá en tus publicaciones.`

Guardado: `Punto de retiro actualizado: {pickup_point}.` El cambio afecta publicaciones futuras; pedidos existentes conservan snapshot y requieren coordinación explícita si cambia el lugar.

VENTAS: `Hoy, {date}: {reserved_count} apartados, {delivered_count} entregados y {expired_count} vencidos. Señas confirmadas: {paid_deposits}. Pagos en revisión: {review_count}. El reporte de liquidación muestra lo pendiente de transferir.` No llamar ganancias a toda la seña cobrada.

AYUDA:

> Mandá una foto y después el precio para publicar.
> PUNTO: cambiar lugar de retiro.
> VENTAS: ver el resumen del día.
> ENTREGADO código: confirmar un retiro.
> CANCELAR: salir del borrador actual.

CANCELAR con borrador: `Borrador cancelado. Cuando quieras publicar, mandame otra foto.` Sin borrador: `No tenés un borrador pendiente.` No usar este comando para devolución o cancelación económica.

## Pago y retiro

Solo tras confirmación autenticada y transacción finalizada:

- Comerciante: `¡Tenés un apartado! Artículo: {listing_label}. Seña confirmada: {deposit}. Retiro antes de {deadline_local}. Al entregar, pedile el código al comprador y escribí ENTREGADO seguido del código.`
- Comprador: `Tu apartado está confirmado. Código de retiro: {pickup_code}. Retirá en {pickup_point} antes de {deadline_local}. Saldo al retirar: {balance}. Mostrá el código al recibir el artículo.`
- Contraentrega autorizada: reemplazar “Seña confirmada” por `Reserva sin seña autorizada` y mostrar saldo total. Nunca afirmar pago en este caso.
- Pago pendiente: `Todavía estamos verificando el pago. No hagás otro pago por este pedido; revisá su estado en {order_url}.`
- Pago tardío/inconsistente: `Tu pago requiere revisión y el apartado todavía no está confirmado. Consultá el estado en {order_url}.` No prometer reembolso ejecutado.

El código se entrega únicamente al comprador; no incluirlo en páginas públicas o mensajes al comerciante. El comerciante lo obtiene físicamente al retiro.

## ENTREGADO

Sin código: `Escribí ENTREGADO seguido del código que te muestre el comprador.`

Correcto: `Entrega confirmada. Ya quedó registrada en tus ventas.`

Repetido: `Esta entrega ya estaba confirmada. No la registré otra vez.`

Inválido o pedido ajeno: `No pude confirmar una reserva tuya con ese código. Revisalo con el comprador.` No revelar si existe para otro comerciante.

Vencido: `El apartado ya venció. Contactá a operaciones para revisar este retiro.`

## Mensajes programados

Recordatorio comprador dos horas antes: `Tu apartado vence a las {deadline_time}. Retirá en {pickup_point}. Saldo: {balance}. Código: {pickup_code}.`

Expiración comprador: `Venció el plazo de tu apartado de {listing_label}. El artículo puede volver a estar disponible. Revisá el estado de tu seña y las condiciones en {order_url}.`

Expiración comerciante: `Venció el apartado de {listing_label}. {availability_message}. Revisá la seña en el reporte de conciliación.` Usar “El artículo volvió a estar disponible” solo si la transacción efectivamente lo reabrió.

Resumen diario comerciante 19:30: reutilizar VENTAS calculado para el día local. No incluir recordatorios o código después de entrega/cancelación. Cada mensaje programado tiene clave de deduplicación por pedido+tipo o comerciante+fecha.

## Errores de canal y evidencia

Si una foto fue omitida por OpenWA, solicitar reenvío comprimido como hace el eco actual; no afirmar que está guardada. Ante timeout de envío, conservar revisión y evitar reenvío ciego. Probar cada copy con un comerciante semilla al cierre del sprint; registrar cambios de versión.
