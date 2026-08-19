# Compras — Sincronización con Google Sheets

Mientras dure la transición, la planilla y el módulo conviven. Acá está la regla
y cómo apagar la planilla cuando ya no haga falta.

## La regla

Para que no haya dos verdades sobre el mismo dato, cada lado manda en una cosa:

| | Manda en | Por qué |
|---|---|---|
| **Planilla** | El alta de RI nuevos | La gente sigue cargando por el formulario de Google |
| **Sistema** | Aprobación, proveedor, costos, estado de compra | Es donde están los permisos y el historial |

En la práctica: apenas alguien toca un requerimiento desde el sistema (lo
aprueba, le elige proveedor, le carga un costo), queda marcado con
`editado_en_app = true` y **la planilla ya no puede pisarlo**.

Lo hace un trigger de base (`compras_marcar_editado_en_app`, migración 017), no
el código de una ruta: así no depende de que alguien se acuerde de marcarlo.

Los RI que nadie tocó en el sistema se siguen actualizando desde la planilla con
normalidad.

## Los dos sentidos

**Planilla → sistema** (`importarDesdeSheets`)

- Lee la hoja master y todas las pestañas `RI *`, y las fusiona por N° de RI.
- Da de alta áreas y proveedores nuevos que aparezcan.
- Resuelve "dónde se necesita" contra sectores y equipos del núcleo.
- Omite los RI ya gestionados en el sistema.
- Se dispara por: el webhook del Apps Script cuando alguien edita la planilla,
  el botón de `/compras/configuracion`, y un cron diario a las 9 UTC (6 de la
  mañana en Argentina), para que el día arranque con los datos frescos.

  El cron es diario y no más seguido porque **el plan Hobby de Vercel sólo
  admite una ejecución por día**: una frecuencia mayor hace fallar el deploy
  entero, no sólo el cron. Con plan Pro se puede bajar a `0 */2 * * *`. Igual el
  webhook cubre la inmediatez, así que el cron es sólo la red de seguridad.

**Sistema → planilla** (`exportarRequerimiento`)

- Al guardar un cambio de compra, escribe de vuelta en la pestaña del área las
  columnas que gestiona Compras: comparativa, proveedor, estado, costo + IVA y
  costo de envío.
- Si Sheets falla, el cambio ya quedó guardado: la respuesta incluye un
  `aviso_sheets` pero la operación no se rompe.

## Puesta en marcha

### 1. Cuenta de servicio de Google

Se puede reutilizar la de Mantenimiento o crear una nueva. Hay que **compartir
la planilla PEDIDOS DE COMPRA con esa cuenta como Editor** — no como lector: el
sistema necesita escribir.

### 2. Variables en Vercel

| Variable | Si falta |
|---|---|
| `GOOGLE_SHEETS_COMPRAS_ID` | No hay sincronización (no es un error: se omite) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | No se puede firmar el token de Google |
| `CRON_SECRET` | `/api/cron/compras-sync` devuelve 503 |
| `SHEETS_WEBHOOK_SECRET` | `/api/compras/sheets/webhook` devuelve 503 |

Los dos últimos **fallan cerrado** a propósito: es preferible que la
sincronización no corra a dejar un endpoint abierto.

### 3. Apps Script

Instalar `docs/compras-apps-script.gs` en la planilla siguiendo las
instrucciones del propio archivo. Es opcional: sin él la sincronización sigue
funcionando por cron, con hasta 2 horas de demora.

### 4. Verificación

1. Entrar a `/compras/configuracion` y tocar **Sincronizar ahora**.
2. Confirmar que informa filas leídas.
3. Cambiar el estado de compra de un RI y verificar que la celda cambió en la
   pestaña del área.
4. Cargar un RI desde el formulario y volver a sincronizar: tiene que aparecer.

## Cuándo apagar la planilla

`/compras/configuracion` muestra qué porcentaje de los requerimientos ya se
gestiona desde el sistema. Cuando ese número se acerque al total y los RI nuevos
entren por `/mis-pedidos` en lugar del formulario:

1. Quitar el cron `compras-sync` de `vercel.json`.
2. Borrar el activador del Apps Script.
3. Dejar la planilla en solo lectura como archivo histórico.

No hace falta tocar código: sin `GOOGLE_SHEETS_COMPRAS_ID` la sincronización no
corre.
