# Borde de ingreso D48, sólo preparación local

Contrato nuevo de prueba: `ingress.ts`. No se conecta a HTTP, P5, telefonía ni APNs. No modifica el contrato `CompletedMessage` que consume la interfaz. El ZIP preparado para San Miguel se conserva como entrega independiente y no se regenera en esta tanda.

El verificador inyectado pertenece al servidor: recibe bytes y cabeceras y sólo después de verificar firma/autenticidad del proveedor debe devolver un evento normalizado con `integrationId`, `eventId`, `destination`, `forwardedLine`, `caller`, `completedAt` y `transcript`. No se afirma un formato de firma Telnyx/Zadarma: requiere elegir proveedor y leer su contrato real. En esta preparación se usa exclusivamente un doble. Sin verificador no se acepta nada. Ninguna cabecera o campo del cliente elige un dueño.

Las asociaciones confiables se entregan por configuración local en memoria. Hay dos variantes, sin elegir la comercial:

- `dedicated`: un destino por persona. Un único dueño para ese destino; si llega línea desviada, debe coincidir. No se usa el llamante para decidir dueño.
- `shared`: un destino para varias personas. Exige línea desviada autenticada y una única asociación exacta. Ausente/desconocida/ambigua se rechaza sin guardar ni avisar. Una llamada directa no se asigna por parecido.

Los números se validan como E.164, sin asumir prefijo del proveedor no contratado. El evento se acota al límite ya usado por Mailbox y se convierte al contrato existente después de resolver dueño. La deduplicación incluye integración para no colisionar IDs de dos proveedores. Las notificaciones del núcleo siguen siendo genéricas y el análisis de prueba no afirma seguridad.

Verificaciones locales: firma inválida/no disponible, evento mal formado, destino desconocido, número compartido sin línea, asociación ambigua y cruce de cuentas; reintento concurrente y callback posterior al borrado; fallo del analizador. Los dobles no acreditan firma, autenticación, entrega ni retención productivas. No hay persistencia ni migración nueva, ni se instala una ruta desplegable.

Antes de conectar: grupo entrega resultado de prueba 5, León autoriza L3, equipo confirma retención; después se implementa verificador real, asociaciones autenticadas, almacenamiento, revocación, idempotencia durable y pruebas de cuenta. Si el plan no trae la migración concreta necesaria, se detiene ese borde y se deja su diseño para aprobación. Sólo entonces puede probarse aviso remoto con San Miguel. Un resultado sintético no sustituye las 20 llamadas de aceptación del plan del buzón.
