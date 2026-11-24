# Cuelga para iPhone — app conectada (D60)

> **Desde la D88 (21-11-2026) la app no tiene compras:** 4 pestañas (Revisar, Llamadas, Desvío, Tus datos), sin StoreKit en
> ejecución y sin tope diario. `src/premium.tsx`, `src/apple-purchases.ts` y `CuelgaStoreKitPlugin.swift` se conservan sin
> uso. Lo que sigue sobre compras con Apple, la pantalla Premium, Restaurar, Gestionar y el cupo diario es histórico.

Aplicación Capacitor con interfaz React empaquetada. **Desde el 09-11-2026 ya no trae bandeja de ejemplo:** entra con
una cuenta de Cuelga y le pregunta al servidor (`https://cuelga-prototipo.vercel.app/api/movil/v1`) según el
[contrato app ↔ servidor](../innova/cuelga/app/CONTRATO-APP-SERVIDOR.md). El cliente del Plan H usa las rutas nuevas de
revisión y Llamadas: el servidor comprueba Premium y entrega el número compartido sin exigir una línea por cuenta.
El contrato anterior sigue disponible para los clientes antiguos. **Esta fase está implementada localmente; faltan
publicación y aceptación en dispositivo antes de enviarla a Apple.**

Qué hace (Plan H, fase 2): entrar y crear cuenta con correo y contraseña sin invitación; pegar un SMS, WhatsApp o link y
ver las señales del motor del servidor, con el mismo cupo de la web; con Premium comprobado por el servidor, mostrar el
código manual al número compartido, reclamar una llamada con el número que llamó y actualizar pendiente → resumen.
Incluye bandeja, duración, lectura y borrado, permiso de IA (Zadarma y Anthropic), salida, borrado de cuenta y registro
del aparato para avisos. Exige cuenta también para revisar. No ofrece Google ni compra externa. La fase 4 agrega
suscripción Apple desde la sección Premium, con precio localizado consultado en StoreKit.

Dónde guarda la sesión (Plan H, fase 3): Llavero de iOS mediante el plugin Swift local `CuelgaSessionPlugin`,
registrado en `CuelgaViewController` y en el proyecto Xcode. Usa `WhenUnlockedThisDeviceOnly`, sin sincronización
con iCloud ni traslado a otro equipo. Migra `cuelga.sesion.v1` desde Preferences una vez: guarda primero en Llavero
y después elimina el valor antiguo. Si falla, no degrada la sesión a Preferences. En navegador/pruebas usa sólo memoria;
recargar el navegador exige entrar de nuevo. Salir, borrar la cuenta y rechazo de renovación limpian la sesión.

Ambiente de avisos: por omisión `production` (TestFlight y App Store). Para instalar directo desde Xcode y recibir
avisos por sandbox: `VITE_APNS_ENV=development npm run ios:prepare`.

`server/` y `server/mailbox-local.ts` son el ingreso local del buzón (base de la fase 3) con sus pruebas; no entran a la
app.

## Probar en este computador

Desde `mobile/`, Node 22.12 o superior: `npm ci` y `npm run dev`, y abrir http://127.0.0.1:5178. Sin servidor local la
app dice "Sin conexión" (no inventa mensajes). Para apuntarla a otro servidor: `VITE_CUELGA_API=<base> npm run dev`.

## Comprobaciones

```powershell
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:ui
npm.cmd run ios:prepare
npm.cmd run release:check
```

`release:check` debe salir con código1 mientras falte evidencia para Apple. No firma ni envía nada aun si todas las filas se confirman. `ios:prepare` compila recursos web y sincroniza; **no compila Swift ni genera IPA**. El proyecto iOS ya está generado; no ejecutar `cap add ios` otra vez. Dependencias móviles tienen lock propio; la web Next no depende de ellas.

## Estructura

- `server/mailbox-local.ts`: contrato local del buzón para el ingreso de la fase 3; no entra a la app.
- `src/api.ts`: cliente del contrato app ↔ servidor; valida cada respuesta y renueva la llave sólo ante `AUTH_REQUIRED`.
- `src/main.tsx`, `style.css`: ingreso, registro abierto, revisión, reclamo, aviso de IA, buzón, detalle, desvío, Tus datos, salida y borrado. Nunca `innerHTML` para mensajes. El texto pegado no se persiste.
- `src/native.ts`, `session-store.ts`: sesión en Llavero con migración serializada; avisos APNs y registro en `/aparato`.
- `src/forwarding.ts`: código de desvío como texto, sin enlaces `tel:`; se muestra sólo cuando el servidor entrega `forwardingNumber`.
- `server/`: harness loopback; sesión aleatoria de30min, dueño en servidor,200 eventos y50 mensajes máximos por buzón,300 solicitudes/minuto en total,20 sesiones; sin CORS abierto. No logs de contenido/tokens. No usar con datos o clientes reales.
- `ios/`: proyecto generado por Capacitor8.6, SPM, iOS15 mínimo en plantilla. Requiere macOS/Xcode26+ para verificar compilación. Sin Team, firma ni credenciales; la capability Push Notifications la agrega quien firma (guía v3). Identificador `cl.cuelga.buzon` provisional, no reservado.
- `store-readiness.json`: evidencia pendiente, no un mecanismo para simular aprobación.

## Reutilización de Pulso y seguridad

Se usó el patrón Capacitor/puente nativo de Pulso como referencia de lectura; no se copió su producto, backend, token, cuenta, dominio ni appId. Aquí los assets están empaquetados, sin `server.url`. Nada usa servicios de Pulso. `node_modules`, copias de assets web generados, certificados, perfiles y paquetes firmados se ignoran en Git. Assets base propios en `assets/icon.svg`; generador local `scripts/assets.py` requiere Pillow, sin servicios.

La app exige cuenta (D23) y manda identificador, contraseña y token del aparato: no cambiar la política a “datos no recopilados”.

### Pruebas de fase 2

`npm run typecheck`, `npm test` y `npm run build`. `tests/api.test.ts` prueba registro abierto, rutas nuevas con bearer,
errores de cupo/servicio/red/sesión, aislamiento del permiso y validación de respuestas. `tests/ui/mailbox.spec.ts`
recorre registro → revisión, errores y reintento, código manual, reclamo → pendiente → resumen y salida.
Las pruebas de las rutas del servidor viven en `src/lib/cuelga/mobile-features.test.ts` (Vitest de la raíz).
Las pruebas UI usan servidor simulado; no acreditan iPhone ni procesamiento real. La aceptación en dispositivo es fase 5.

### Privacidad y borrado de fase 3

La app ofrece sólo cuenta propia. Desde fase 4, iOS abre Privacidad, Términos y Soporte dentro del paquete para
mantener la navegación móvil sin precios ni enlaces de compra externa. El navegador conserva los enlaces públicos.
Los textos iOS nuevos son candidatos y León debe aprobarlos antes del envío. No se modifican las páginas web ni el
contestador. La operación de proveedores sigue pendiente de León.

El borrado llama a la ruta móvil existente y a `deleteOwnAccount`: contraseña → cancelación Mercado Pago → borrado
Auth y comprobación del recibo. Conserva sólo el identificador de operación junto a la sesión en Llavero, nunca la
contraseña. Si se pierde la respuesta, vuelve a consultar el mismo recibo antes de renovar el token; al reabrir retoma
la pantalla de borrado. El recibo dura una hora. Si vence, salir y volver a entrar permite una nueva solicitud.
Si el recibo no corresponde a la sesión actual o venció, la pantalla ofrece salir y volver a entrar con la misma
cuenta para una nueva solicitud; también cubre un borrado parcial que ya desactivó el perfil y no permite renovar.
Al salir se regenera el identificador, para que otra cuenta nunca reutilice el comprobante anterior.
La confirmación distingue datos borrados en Cuelga del audio/copias externas, cuyo borrado manual no se acredita aquí.
No requiere escribir a soporte para iniciar el borrado de la cuenta.

Revisión iOS: `CA92.1` sigue aplicando a UserDefaults propios (migración y Capacitor); el Llavero no agrega una categoría
de API con razón requerida. No se usan micrófono, cámara, fotos, contactos ni rastreo: no se agregan permisos ni textos
para esas funciones. Idioma base español; iOS administra su propio permiso de notificaciones. Logs de Capacitor
desactivados también en Debug para no imprimir argumentos/respuestas del puente. El selector de apps tapa su contenido.

San Miguel debe compilar Swift y probar en iPhone: actualizar desde una versión con sesión en Preferences, abrir sin
volver a entrar, comprobar que `CapacitorStorage/cuelga.sesion.v1` desapareció de UserDefaults (sin copiar el token),
salir/entrar, cerrar y reabrir, reinstalar y restaurar respaldos en el mismo y en otro equipo. `ThisDeviceOnly` evita
trasladar la sesión a otro equipo; no promete que reinstalar borre el Llavero. Revisar el manifiesto combinado del archive,
avisos denegados, captura del selector de apps y borrado con contraseña incorrecta/red interrumpida usando cuenta desechable.

## Apple In-App Purchase — Plan H, fase 4

`CuelgaStoreKitPlugin.swift` implementa StoreKit 2 y está agregado al proyecto y a `CuelgaViewController`. No agrega
SDK de pago ni dependencia. Consulta el producto que entrega el servidor; no fija un precio en el código. Comprar
usa el `appAccountToken` opaco del servidor. Compra cancelada y pendiente se informan sin activar acceso. El recibo JWS
se entrega a las rutas móviles con bearer; sólo una respuesta válida del servidor permite terminar la transacción.
El cliente vuelve a consultar Premium antes de abrir la compra: una cuenta Premium existente no recibe otra oferta.

El listener de `Transaction.updates` empieza al cargar el plugin. Al entrar y volver del segundo plano se consultan
`Transaction.unfinished` y `currentEntitlements` sin pedir autenticación de Apple. Restaurar, sólo por acción de la
persona, ejecuta `AppStore.sync()`. Otro Apple ID/cuenta Cuelga no puede adjudicarse el recibo: el cliente omite cuentas
ajenas y el servidor vuelve a comprobar la vinculación. Fallos de red/verificación no terminan la compra; se reintenta
al abrir o restaurar. Salir invalida respuestas pendientes y retira el listener del cliente.

La pantalla Premium muestra nombre, precio localizado y período de StoreKit, renovación automática, Restaurar,
Gestionar y documentos locales. No muestra un precio de respaldo. Una cuenta Premium por el canal web muestra
«Ya tienes Premium» y no ofrece comprar. Gestionar abre `AppStore.showManageSubscriptions(in:)`; borrar la cuenta
recuerda que Apple exige cancelar la renovación por separado. No bloquea el borrado por esa cancelación.
El navegador no registra un StoreKit falso ni inventa productos: muestra la disponibilidad exclusiva de la app iOS.

Servidor esperado, aditivo: `GET /apple/config` devuelve `appAccountToken`, `productId`, `premium` y `source`
(`mp`, `apple`, `none`); `POST /apple/transaccion` y `/apple/restaurar` reciben sólo `signedTransaction` y devuelven
`premium`. Todas bajo la base móvil del contrato. Con Apple apagado responden 503; ese estado no impide usar la app.
`APPLE_IAP_ENABLED` se mantiene apagado por defecto en el servidor. Las demás variables y migración se configuran en
el servidor por León; el paquete móvil no lleva certificados raíz, claves ni recibos guardados. No hace falta una
variable Vite para el producto: lo entrega el servidor autorizado.

**San Miguel:** crear el grupo/producto de suscripción y sus metadatos/acuerdos en App Store Connect con el precio
aprobado por León; confirmar Bundle ID y Product ID al operador del servidor. Compilar el proyecto en Xcode antes de
dar Swift por acreditado. Con una cuenta de prueba autorizada en `APPLE_IAP_SANDBOX_USERS`, probar compra cancelada,
pendiente, completada, renovación, restauración en otro equipo con la misma cuenta Cuelga, expiración y reembolso.
Comprobar que una cuenta real rechace sandbox y que una compra de A no se restaure en B. Verificar precio/moneda,
período, documentos locales, VoiceOver y Gestionar en iPhone/iPad. No ejecutar una compra real para esta aceptación.
StoreKit local sirve para ensayar el puente; sus firmas de prueba no reemplazan la verificación sandbox del servidor.

### Configuración del servidor y activación pendiente

Todas estas variables son del servidor; ninguna se incorpora al paquete de iPhone:

| Variable | Uso |
|---|---|
| `APPLE_IAP_ENABLED` | Sólo `true` habilita Apple. Ausente o cualquier otro valor lo deja apagado: rutas Apple 503 y cero consultas Apple al calcular Premium. |
| `APPLE_ROOT_CA_PEM` | Raíz Apple auténtica en PEM, obtenida de [Apple PKI](https://www.apple.com/certificateauthority/). No copiar un certificado inventado. Sin raíz, las rutas Apple responden 503. |
| `APPLE_BUNDLE_ID` | Bundle ID definitivo, igual al proyecto firmado. |
| `APPLE_PRODUCT_ID` | Producto mensual creado en App Store Connect. |
| `APPLE_IAP_SANDBOX_USERS` | IDs de cuentas Cuelga de prueba reservadas, separados por coma. Sandbox sólo da acceso en esas cuentas; ellas rechazan producción. Nunca incluir cuentas de clientes. |
| `APPLE_IAP_ISSUER_ID` | Issuer ID para App Store Server API. |
| `APPLE_IAP_KEY_ID` | Identificador de la clave de In-App Purchase. |
| `APPLE_IAP_PRIVATE_KEY_PEM` | Clave privada de In-App Purchase en PEM, cargada directamente al almacén seguro del servidor. |

Notificaciones V2: `POST /api/apple/aviso`, tanto en configuración sandbox como producción de App Store Connect.
La verificación usa ES256, cadena X.509 y extensiones Apple contra la raíz configurada; comprueba fechas a `signedDate`
en modo offline, sin OCSP. La relectura autenticada de App Store Server API decide vigencia y gracia firmada; no basta
con el recibo del cliente. Se ejecuta al registrar/restaurar, recibir avisos y comprobar acceso Apple, para recuperar
avisos perdidos. La observación de la API se ordena por separado del JWS para conservar gracia y rechazar respuestas viejas.

La migración aditiva `supabase/migrations/20261113130000_apple_iap_derechos.sql` supera la anterior
`20261113121000`. No cambia tablas, funciones ni estados MP existentes: incluso con Apple habilitado, el reclamo
intenta primero la RPC original y sólo usa Apple ante `not_premium`. Los errores Apple no quitan acceso MP.
Las tablas Apple quedan privadas con RLS y operaciones únicamente mediante RPC `SECURITY DEFINER` para `service_role`.
Al borrar la cuenta queda el vínculo opaco sin dueño para impedir que una compra anterior se adjudique a otra cuenta.

**No aplicada en ninguna base.** El workflow manual P5 ya incluye `scripts/p5/apple-iap-real.test.mjs` y
`scripts/p5/apple-iap.sql` al elegir `comprobar_app=true`. El arnés sólo acepta el Supabase local efímero del runner
Linux, verifica destinos y retira sus fixtures con rollback. Prueba MP, Apple vigente/vencida/revocada, gracia,
desorden/repetición, cuenta ajena, sandbox, borrado, RLS y permisos. Primero acreditar ese temporal con costo cero
confirmado; después León da su OK para aplicar la migración en producción. Mantener Apple apagado hasta entonces.

La web conserva sus páginas. Queda para otra fase mostrar el origen Apple en Mi cuenta y ajustar la oferta de Planes
para una cuenta que ya pagó por Apple; el servidor ya rechaza otra suscripción vigente, pero la presentación web sigue
mostrando sólo información MP. No encender ventas Apple sin revisar ese pendiente de presentación con León.

Documentación técnica consultada el 13-11-2026: [productos](https://developer.apple.com/documentation/storekit/product/products(for:)),
[compra](https://developer.apple.com/documentation/storekit/product/purchase(options:)),
[token de cuenta](https://developer.apple.com/documentation/storekit/product/purchaseoption/appaccounttoken(_:)),
[actualizaciones](https://developer.apple.com/documentation/storekit/transaction/updates),
[restauración](https://developer.apple.com/documentation/storekit/appstore/sync()),
[vigencias](https://developer.apple.com/documentation/storekit/transaction/currententitlements),
[finalización](https://developer.apple.com/documentation/storekit/transaction/finish()) y
[gestión](https://developer.apple.com/documentation/storekit/appstore/showmanagesubscriptions(in:)).
