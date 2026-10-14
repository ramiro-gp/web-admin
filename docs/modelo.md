# Modelo de V1

La unidad recurrente es un período de un plan. Su importe esperado y su único pago completo viven en la misma fila. Las ventas originales y los trabajos adicionales registran sus propios pagos, sin un motor común de cargos.

## Entidades y relaciones

| Entidad | Responsabilidad |
| --- | --- |
| Cliente | Contacto, empresa, notas y estado activo/inactivo; tiene varios sitios |
| Tipo de sitio | Catálogo editable; se desactiva cuando deja de utilizarse |
| Sitio | Cliente, tipo vendido, URL, información del proyecto y venta original |
| Plan | Condiciones de un sitio: frecuencia, calendario, moneda, hosting, mantenimiento y finalización |
| Precio del plan | Importe total del período y vigencia de cada versión |
| Período | Cobertura, vencimiento, importe esperado y pago completo opcional |
| Dominio | Registrador, vencimiento real, autorrenovación y notas |
| Dominio incluido | Relación plan–dominio del mismo sitio; conserva asociaciones de planes históricos |
| Renovación de dominio | Fecha, vencimiento anterior y nuevo vencimiento |
| Trabajo adicional | Pedido, estado, precio, finalización y pago independiente |

Un sitio conserva varios planes históricos, con como máximo uno vigente por fecha. Hosting y mantenimiento son booleanos del plan; la inclusión de dominios se deriva de su relación, evitando indicadores duplicados. Las tablas de Better Auth están separadas del dominio comercial.

## Dinero y fechas

Los importes son `bigint` en centavos y se calculan con enteros. Se serializan como strings cuando corresponde; los formularios admiten hasta dos decimales. ARS es predeterminada y USD tiene soporte simple: los totales permanecen separados, sin conversiones.

Las fechas comerciales usan PostgreSQL `date`; creación, edición y archivo usan `timestamptz`. “Hoy” y los cierres mensuales se interpretan en `America/Argentina/Buenos_Aires`. Una fecha de pago es la fecha efectiva de recepción, aunque el vencimiento pertenezca a otro mes.

## Planes, períodos y precios

Frecuencias de 1, 6 o 12 meses. La cobertura es `[inicio, fin)` y el vencimiento coincide con el inicio, por cobro anticipado.

```text
Semestral: 01/10/2026 → 01/04/2027, ARS 108.000
Pago:      03/10/2026
Siguiente: 01/04/2027 → 01/10/2027
```

El pago tardío no mueve el calendario. Cada límite se calcula desde el mes original y el día ancla: `31/01 → 28/02 → 31/03 → 30/04`. Febrero y los años bisiestos no hacen perder el ancla.

El inicio histórico del servicio y el primer período administrado son distintos. La generación comienza en ese corte explícito, crea solamente períodos cuyo inicio llegó y se detiene al finalizar el plan. Volver a sincronizar no duplica filas gracias a la unicidad de plan e inicio.

Cada período generado toma el precio vigente en su inicio y conserva el importe como snapshot. Un aumento se programa para el siguiente período todavía no iniciado, después de sincronizar hasta hoy. No recalcula períodos anteriores. El equivalente mensual divide el importe total por la cantidad de meses y redondea solamente para presentación.

La antigüedad del precio usa su vigencia comercial. Si la fecha histórica es desconocida, se conserva esa condición y no se inventa una antigüedad. Los precios utilizados no se sobrescriben.

Para cargar un período conocido anterior al corte se indica inicio, importe y una nota; la fecha real de pago es opcional. Conserva la misma ancla, puede tener `price_id = null` y no crea una versión de precio ficticia ni cambia el corte. La base sólo permite omitir el precio en este caso.

Cambiar frecuencia, moneda o calendario requiere finalizar el plan y crear su sucesor. Finalizar detiene nuevos períodos y conserva los impagos.

## Pagos, estados y correcciones

| Estado derivado | Condición |
| --- | --- |
| Pagado | Importe pagado y fecha presentes, por el total esperado |
| Vencido | Impago y vencimiento anterior a hoy |
| Pendiente | Impago sin vencimiento pasado |

Un vencimiento de hoy pasa a vencido mañana. “Vence pronto” es una señal visual, no otro estado guardado. El próximo vencimiento de un plan es el impago más antiguo; si no hay deuda, es el siguiente inicio calculado.

Los pagos parciales se rechazan. Un descuento acordado se registra ajustando explícitamente el importe esperado del período con una nota, sin modificar el precio del plan. Para corregir un importe ya pagado se quita primero el pago, se ajusta y se vuelve a registrar. La fecha de pago puede corregirse; la caja mensual se recalcula usando esa fecha.

Las correcciones actualizan `updated_at`. No existen cadenas de reemplazos, aplicaciones de dinero ni event sourcing. Los períodos anteriores, precios utilizados, planes, trabajos y renovaciones se conservan; clientes se inactivan y sitios se archivan.

## Ventas, trabajos y dominios

Una venta original conserva precio y fecha aunque luego aparezcan trabajos adicionales. “Sin seguimiento de cobro” permite guardar una venta histórica sin fabricar deuda. Al activar el seguimiento se registra un pago completo o queda pendiente; el vencimiento de venta es opcional.

Los trabajos pasan por solicitado, en curso, completado o cancelado. Precio sin definir no integra deuda; cero significa gratuito y no fabrica un pago. Un trabajo con precio puede pagarse antes o después de finalizarse. Cancelar uno impago lo excluye del pendiente; un pago ya registrado continúa contando como cobro. Su vencimiento también es opcional.

El vencimiento del dominio es independiente del pago del plan. Registrar una renovación guarda el vencimiento anterior y el nuevo, y actualiza el actual en una transacción. Autorrenovación no confirma que se renovó ni oculta alertas.

## Dashboard e invariantes

La deuda suma períodos impagos, ventas con seguimiento y trabajos acordados pendientes. Inactivar un cliente o archivar un sitio no borra sus deudas. La caja mensual y los últimos pagos reúnen períodos, ventas y trabajos por fecha real de pago. Los próximos inicios proyectados se distinguen de la deuda ya emitida.

Alertas predeterminadas: siete días para cobros, treinta para dominios y seis meses calendario para precios sin actualizar. Los vencidos permanecen visibles; una vigencia desconocida no genera una alerta de antigüedad inventada.

Las restricciones de PostgreSQL y las acciones protegen rangos de períodos, anclas, unicidad, parejas de campos de pago, importes completos, relaciones del mismo sitio y planes sin solapamientos. Un sitio con historial no se transfiere a otro cliente en V1. Lecturas y mutaciones privadas requieren sesión e identidad GitHub autorizadas.
