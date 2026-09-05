# Integración Wompi El Salvador implementada

El adaptador está en `supabase/functions/_shared/wompi.mjs`. Se contrastó con documentación oficial, no con la API colombiana:

- [Autenticación](https://docs.wompi.sv/autenticacion/autenticacion): OAuth client credentials; token en memoria hasta vencimiento.
- [Enlace de pago](https://docs.wompi.sv/metodos-api/enlace-de-pago): seña inmutable, cantidad uno, vigencia del pedido y máximo un pago exitoso.
- [Firma del webhook](https://docs.wompi.sv/webhook/validar-webhook): `wompi_hash`, HMAC-SHA256 de los bytes originales con API Secret.
- [Payload](https://docs.wompi.sv/webhook/definicion-webhook): valida aplicación, ambiente productivo/prueba, cantidad, monto, transacción y referencia del enlace.
- [Consulta de transacción](https://docs.wompi.sv/metodos-api/obtener-transaccion-compra-por-id): método de lectura disponible en el adaptador para conciliación.

Se procesan automáticamente los callbacks `ExitosaAprobada`; otros resultados no documentados como definitivos se ignoran. No se interpreta un redirect como confirmación. La RPC admite fallos definitivos, pero no inventa su mapeo desde callbacks desconocidos. Checkout sin aprobación vence y libera inventario; un pago tardío entra en revisión.

Si crear un enlace tiene resultado incierto, `checkout_state=review` evita volver a crearlo automáticamente. Operaciones debe conciliar con el proveedor y recuperar la referencia; no hay conciliación automática de enlaces huérfanos en esta versión. El método de consulta implementado no se ejecuta por sí solo.

No se realizaron solicitudes autenticadas a Wompi, cobros ni prueba real de tarjeta. Falta comprobar que la cuenta esté habilitada para el modelo de negocio del piloto, configurar credenciales y validar fixtures reales. `PAYMENTS_ENABLED=false` y `WOMPI_LIVE=false` son los valores iniciales.
