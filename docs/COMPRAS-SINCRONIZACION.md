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

- Al aprobar, escribe el estado en la columna correspondiente del master.
- Al guardar un cambio de compra, escribe en la pestaña del área: comparativa,
  proveedor, estado, costo + IVA y costo de envío.
- Si Sheets falla, el cambio ya quedó guardado: se avisa en pantalla pero la
  operación no se rompe.

### El alias de cada aprobador

La columna de aprobación del master tiene una lista desplegable **estricta**:

```
APROBADA (NICO) · APROBADA (MAXI) · DENEGADA · EN REVISIÓN
```

Al aprobar, la app tiene que escribir exactamente una de esas opciones. Por eso
cada aprobador lleva un **alias** —`NICO`, `MAXI`— que se carga en
`/compras/configuracion`, al lado de su nombre. No se deduce del nombre de pila:
`MAXI` no sale de `Maximiliano` sin adivinar, y adivinar mal deja la celda fuera
de la validación y rompe las fórmulas que dependen de esos textos exactos.

Las opciones se leen de la planilla, no están escritas en el código: si suman un
tercer aprobador allá, aparece solo como sugerencia acá.

**Si falta el alias, la aprobación no se escribe** y se avisa en la ficha del
requerimiento. Es preferible a escribir un valor que la planilla rechaza.

`DENEGADA` y `EN REVISIÓN` van sin sufijo: no llevan quién decidió.

### Celdas que la planilla no deja escribir

La planilla tiene un modelo de permisos propio y **la cuenta de servicio no
puede sortearlo**:

| Celda | Estado |
|---|---|
| Estado de aprobación en el master | **Bloqueada** — protección "APROBACIÓN DE GERENCIA", reservada a ciertas cuentas |
| Estado de compra de una fila ya aprobada | **Bloqueada** — hay 841 protecciones automáticas, una por fila, que pone un script de la planilla al aprobar |
| Proveedor, costos, comparativa | Se escriben sin problema |

Por eso **cada celda se escribe por separado y no en un solo lote**: con un batch
único, una celda protegida hacía fallar la escritura entera y no se guardaba
tampoco lo que sí estaba permitido.

Lo que no se pudo escribir aparece como aviso en la ficha del requerimiento, con
el detalle de qué campo fue. No se silencia: si se silenciara, alguien miraría
la planilla creyendo que está al día.

Para que la app también pueda escribir esas celdas hay que **agregar
`sheets-reader@mantenimientopp.iam.gserviceaccount.com` como editor de la
protección "APROBACIÓN DE GERENCIA"**, y contemplar que el script que crea las
protecciones automáticas la incluya. Es una decisión de gobierno, no técnica: el
control de quién aprueba pasa a estar en los permisos de la app.

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
funcionando por cron, con hasta un día de demora.

Hacen falta **dos activadores**, no uno:

| Función | Evento |
|---|---|
| `alEnviarFormulario` | De la hoja de cálculo → Al enviarse el formulario |
| `alEditar` | De la hoja de cálculo → Al editar |

"Al editar" **no se dispara** cuando entra una respuesta del formulario de
Google, y el formulario es por donde llegan los RI nuevos. Con un solo
activador de edición, un pedido recién cargado no se avisa hasta el cron del día
siguiente — justo el caso que la sincronización tiene que cubrir.

Los dos tienen que ser activadores **instalables**, creados desde el menú de
Activadores. Un activador simple (una función llamada `onEdit`) no puede hacer
llamadas externas y fallaría en silencio.

### 4. Verificación

1. Entrar a `/compras/configuracion` y tocar **Sincronizar ahora**.
2. Confirmar que informa filas leídas.
3. Cambiar el estado de compra de un RI y verificar que la celda cambió en la
   pestaña del área.
4. Cargar un RI desde el formulario y volver a sincronizar: tiene que aparecer.

## Cuándo apagar la planilla

`/compras/configuracion` muestra dos indicadores. El que decide es **por dónde
entran los pedidos nuevos** en los últimos 30 días: cuando esa barra sea toda
verde, la planilla dejó de usarse para cargar.

El segundo, *pedidos abiertos gestionados desde acá*, mide sólo lo que sigue en
circulación. Medir contra el total del histórico no serviría: los ~1800 RI
importados están cerrados hace meses y nadie los va a volver a tocar, así que
ese porcentaje se quedaría clavado cerca de cero y no diría nada.

Cuando los RI nuevos entren por `/mis-pedidos` en lugar del formulario:

1. Quitar el cron `compras-sync` de `vercel.json`.
2. Borrar el activador del Apps Script.
3. Dejar la planilla en solo lectura como archivo histórico.

No hace falta tocar código: sin `GOOGLE_SHEETS_COMPRAS_ID` la sincronización no
corre.
