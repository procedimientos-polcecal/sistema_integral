# Ventas — CRM

El decimocuarto módulo del SdG, y su primer frente. Registra **el tramo anterior
a Odoo**: el prospecto, el llamado, el precio que se pasó, la visita y lo que
había que hacer después.

Diseño acordado: [spec](superpowers/specs/2026-11-12-ventas-crm-design.md).

## Qué reemplaza

Nada que esté escrito en ningún lado. Hoy el cliente aparece en Odoo recién
cuando hay algo que facturarle, y en `despacho_ordenes_carga.cliente_raw` como
texto cacheado del remito. Lo de antes —a quién se llamó, qué se le dijo, cuándo
había que volver a llamarlo— vivía en el cuaderno de cada uno.

## Las cuatro pantallas

| Pantalla | Qué es |
|---|---|
| `/ventas` | El tablero. Abre con **lo vencido**, no con la cantidad de clientes |
| `/ventas/crm/seguimiento` | Qué hay que hacer, en tres bloques: vencido, hoy, lo que viene |
| `/ventas/crm/clientes` | El padrón con su semáforo, y la ficha de cada uno |
| `/ventas/crm/oportunidades` | El embudo, con las seis etapas siempre a la vista |

**«Seguimiento» va antes que «Clientes» en el menú**, y no es un detalle: un CRM
cuya puerta es el padrón se convierte en una agenda de teléfonos. Lo que hace
que alguien lo abra a la mañana es que le diga qué tiene pendiente.

## Las siete cosas que hay que saber antes de tocarlo

**El cliente no es el `res.partner` de Odoo, y no se importa.** Odoo tiene los
facturables; el CRM tiene además los **prospectos**, que todavía no están allá y
no tienen por qué entrar. El enlace vive aparte en `ventas_clientes_odoo` —por
empresa, calcada de `proveedores_odoo`— y **lo hace una persona**. La tabla está
creada y vacía a propósito: es lo que va a permitir cruzar con Despacho y con
Facturación por id y no por texto.

**Por eso la ficha del cliente todavía no muestra sus cargas.**
`despacho_ordenes_carga` guarda el cliente como texto del remito, así que cruzar
«la última vez que cargó» pide comparar texto libre contra razón social — que es
exactamente «enlazar al que se le parece», y acá el precio sería facturarle a
otro. Cuando `ventas_clientes_odoo` esté cargado el cruce es exacto.

**Tres cosas no son columnas y no deben serlo**: la probabilidad de una
oportunidad, si está abierta, y hace cuánto que no se toca a un cliente. Las dos
primeras salen de la etapa (`lib/ventas/crm/etapas.ts`); guardarlas permitiría
una oportunidad «Ganada» con probabilidad 30. La tercera sale de
`ventas_actividades`: una columna `ultima_actividad_el` se desincroniza en cuanto
alguien corrija la fecha de una actividad vieja, y nada avisaría.

**`estado` del cliente sí es una columna, y es la excepción.** Prospecto /
activo / inactivo no se deduce de los datos: es un juicio de quien vende. Un
cliente que no compra hace seis meses puede estar «activo» porque hay una orden
en camino, e «inactivo» puede querer decir que se fue a la competencia.

**Los números del semáforo y de la probabilidad son supuestos, y está escrito
dónde.** 30 y 60 días (`DIAS_AL_DIA`, `DIAS_A_DESTIEMPO` en
`lib/ventas/crm/seguimiento.ts`) y 10/25/50/75 (`ETAPAS` en `etapas.ts`). **No
hay histórico todavía**: no salen de ninguna medición. Por eso el embudo muestra
siempre el monto **sin ponderar** al lado —el único número que no depende del
supuesto— y por eso **el semáforo no manda notificaciones** (ver abajo).

**El monto no se convierte nunca.** Se suma por moneda y se muestran las dos.
Una cotización del día haría que el embudo del mes pasado cambie cada vez que se
lo mira; guardada junto al monto, envejece sin avisar. Compras ya resolvió esto
igual (`040_cotizaciones_en_dolares`).

**De una oportunidad cerrada no se vuelve.** Es la única transición prohibida, y
no por purismo: `cerrada_el` ya alimentó el informe del mes. La pantalla tampoco
la ofrece — el desplegable se dibuja con `sePuedePasarDe`, la misma función que
la ruta usa para rechazar.

## Permisos

| Nivel | Puede |
|---|---|
| `lectura` | ver clientes, contactos, oportunidades y el registro de actividades |
| `edicion` | además cargar y corregir todo eso, y mover una oportunidad de etapa |
| `admin` | además borrar, reasignar el vendedor y enlazar con Odoo |

En la base los espejan `tiene_acceso_ventas()`, `puede_editar_ventas()` y
`es_admin_ventas()`; del lado de la app, `lib/ventas/auth.ts`. **Las dos mitades
tienen que decir lo mismo**: cuando no coincidieron, en la 029, un
`admin_sistema` veía los botones y RLS le devolvía listas vacías.

**No hay cartera por vendedor.** Todo el que tiene Ventas ve todos los clientes:
son catorce personas y dos plantas, y esconder datos de los compañeros hace que
el que atiende el teléfono no sepa con quién está hablando. `vendedor_id` dice
quién atiende, no quién puede ver. Si algún día hace falta cerrarlo, se cierra en
la policy de SELECT y en un solo lugar.

## Lo que se audita y lo que no

**Borrar un cliente se audita** con el verbo `borrar`. Se lleva en cascada sus
contactos, sus oportunidades y todo su registro de actividades: es el segundo
`borrar` que escribe una persona —el primero fue sacar un renglón del cuaderno
de un contratista, el 03/11/2026— y hay una diferencia que importa. **Allá el
archivo de origen seguía en el bucket**, así que «qué decía» se contestaba sin la
tabla. Acá no hay archivo de origen: el registro de auditoría es lo único que va
a quedar, y por eso lleva la razón social, el CUIT y cuántas filas colgaban.

El registro se escribe **antes** del borrado: si no entra, no se borra.

**Borrar una oportunidad o una actividad no se audita.** Lo que desaparece ahí es
una previsión o una nota, no un agujero en un número; y las actividades de una
oportunidad borrada **no se van con ella** (`on delete set null`), así que el
registro de la conversación queda.

## No hay planilla, y no hay notificaciones

**No hay planilla de Google**, como Ensayos y Seguridad e Higiene: el SdG es el
único lugar, así que acá no existen `sheets_fila` ni `sheets_pendiente`.

**Y no hay avisos ni push, a propósito.** Los dos cortes del semáforo son un
supuesto sin medir. Un aviso en `lib/home/avisos.ts` ya no es una campanita de
más: va también al resumen diario por push. El spec del 18/10/2026 midió adónde
lleva un aviso que se repite —de 13 personas, las dos únicas que probaron las
notificaciones en serio tenían los 13 avisos descartados—. Primero que los cortes
se midan contra datos reales; después se decide si alguno merece interrumpir.

Por lo mismo `ventas` entra a `FUENTES_POR_MODULO` de `lib/home/ritmo.ts` **con
la lista vacía**: el CRM no tiene una carga periódica que pueda atrasarse. Que
pasen cinco días sin registrar una actividad puede ser una semana tranquila.

## Lo que falta antes de usarlo

1. **Aplicar las dos migraciones**, en orden y en dos pasadas:
   `20261112105021_ventas_enum_del_modulo.sql` primero, confirmado, y recién
   después `20261112105023_ventas_crm_schema.sql`. Un valor de enum nuevo no se
   puede usar en la misma transacción en que se agrega (55P04).
2. **Conceder el módulo** desde `/administracion/usuarios`. Hasta que alguien lo
   tenga, las cuatro pantallas redirigen a la portada.
3. **Abrirlas en un navegador.** Todo está detrás del login, así que ninguna se
   vio corriendo: lo que se verificó son los tests, `tsc`, el build y los dos
   escaneos (responsive y exportaciones).
