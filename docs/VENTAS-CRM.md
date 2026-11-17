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

## Cargar el padrón desde un Excel

`/ventas/crm/clientes` → **Importar Excel**. Existe porque el padrón no empieza
vacío: cuando esto se estrene va a haber una lista en la computadora de alguien,
y cargar trescientos clientes de a uno no se hace.

### Las columnas

Se buscan **por el nombre del encabezado y nunca por la letra**, así que el
orden no importa, las columnas de más se ignoran y las que faltan se nombran.
El nombre se compara sin acentos, sin mayúsculas y sin espacios de más, porque
quien arma la planilla escribe «Razón Social», «RAZON SOCIAL» o «razon social».
**La primera fila es el encabezado** y los datos arrancan en la segunda.

| Columna | ¿Obligatoria? | Qué acepta | También se acepta como |
|---|---|---|---|
| Razón social | **Sí** | El nombre de la empresa | Cliente, Empresa, Nombre |
| Nombre de fantasía | no | Cómo se la conoce | Fantasía |
| CUIT | no | Con guiones o sin ellos | CUIT/CUIL, C.U.I.T. |
| Estado | no | Prospecto, Activo o Inactivo. Vacío es Prospecto | Situación |
| Localidad | no | Texto libre | Ciudad |
| Provincia | no | Texto libre | — |
| Rubro | no | A qué se dedica | Actividad |
| Teléfono | no | Entra como está escrito | Tel, Celular |
| Correo | no | Un correo | Email, E-mail, Mail |
| Sitio web | no | Texto libre | Web, Página web, Sitio |
| Origen | no | Referido, feria, llamó… | De dónde salió, Procedencia |
| Vendedor | no | Nombre y apellido de un usuario del SdG | Quién lo atiende, Responsable |
| Notas | no | Texto libre | Observaciones, Comentarios |

**Sólo la razón social es obligatoria**, igual que en el alta a mano y por el
mismo motivo: un prospecto nace de un llamado donde lo único claro es el nombre
de la empresa. Pedir más termina en que la lista no se arma.

La plantilla se baja desde el mismo modal y **sus encabezados salen de
`COLUMNAS`**, el mismo arreglo contra el que el importador reconoce las
columnas: la plantilla no puede quedar diciendo una cosa y el lector aceptando
otra. Trae una fila de ejemplo obviamente falsa, para poder borrarla sin dudar.

### Cuatro cosas que no se deducen del código

**Nada se escribe hasta que alguien confirma.** La ruta que previsualiza
(`/api/ventas/clientes/importar`) **no inserta**, y la que escribe es otra. Que
sean dos rutas y no un `?dry_run=0` es deliberado: un parámetro que se manda mal
carga trescientos clientes, y no hay forma de equivocarse llamando a una ruta
que no inserta.

**La importación no pisa nada.** Un cliente que ya está se informa y se saltea;
nunca se actualiza. El Excel es una carga puntual y no un espejo —la misma
distinción que CLAUDE.md hace entre RRHH y las planillas de Sheets—, así que no
tiene autoridad para corregir lo que alguien ya cargó en el sistema. Eso además
la vuelve **idempotente**: volver a subir el mismo archivo no crea nada, que es
lo que hace seguro reintentar después de un corte.

**«Ya está» se decide por CUIT cuando lo hay, y por razón social cuando no.** El
segundo caso tiene un límite que conviene conocer: dos empresas distintas con el
mismo nombre y sin CUIT se leen como la misma, y la segunda queda sin entrar.
Es el lado seguro del error — una fila que no entró se ve en la pantalla y se
carga a mano; dos fichas del mismo cliente no se ven nunca, y a partir de ahí
las actividades de una no aparecen en la otra.

**Nada se descarta en silencio.** Lo que no se puede usar tal cual sale como
aviso diciendo qué decía la celda: un CUIT que no cierra entra igual, un correo
que no es correo deja el campo vacío y lo dice, un estado que no se reconoce cae
en Prospecto y lo dice. El **vendedor es la excepción que confirma la regla del
repo**: se cruza por nombre exacto o queda sin asignar, porque enlazar al que se
le parece no se nota nunca y el que tenía que atender al cliente no lo ve.

### Permisos y topes

Importar es de `edicion`, igual que cargar un cliente a mano: nunca sobrescribe,
así que no hace falta más. **Si el archivo trae columna Vendedor con nombres que
se reconocen, pide `admin`**, porque asignar vendedor ya era de `admin` en la
ficha — el mensaje dice que se puede sacar esa columna e importar igual.

El tope es de 2000 filas por confirmación y 4 MB de archivo. Ninguno es técnico:
un archivo más grande que eso es casi siempre el archivo equivocado, y es mejor
que falle diciendo el número a que entre.

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

## Cómo se comprueba que quedó bien aplicado

```bash
npx tsx scripts/probar-el-crm.mts              # sólo lee
npx tsx scripts/probar-el-crm.mts --escribir   # además hace un ida y vuelta
```

Existe porque **el editor SQL de Supabase dice «Success» igual cuando algo quedó
a medias**: un `create table if not exists` sobre una tabla que ya estaba no
agrega las columnas nuevas, y una policy escrita sin envolver su función no
rompe nada y no avisa. Lo que hay que poder contestar después de correr las
migraciones no es «¿dio error?» sino «¿quedó lo que la migración dice?».

Sin la bandera no toca nada. Con `--escribir` crea un cliente marcado, ejercita
los `check`, el trigger de `actualizado_en` y las dos cascadas, y **borra todo
lo que creó**, también si algo falla en el medio: se guarda los ids y borra por
id, así que nunca toca una fila que no haya creado él.

**Si las llamadas de las policies están envueltas no lo contesta este script
sino `node scripts/simular-rls.mjs`**, que las mira todas. La primera versión
traía su propia expresión regular y daba las dieciséis mal: Postgres no guarda
el texto como se escribió sino normalizado —`( SELECT tiene_acceso_ventas() AS
tiene_acceso_ventas)`, en mayúsculas y con alias—, así que una expresión en
minúsculas acusa a código que está bien.

## Lo que falta antes de usarlo

Las dos migraciones **ya se aplicaron el 13/11/2026**, y se comprobó contra la
base: las cinco tablas, el valor del enum, las tres funciones de permiso, las
dieciséis policies con RLS encendida, los cinco triggers, los `check` de etapa,
moneda y próximo paso, el `unique` del CUIT, las dos cascadas y el importador de
Excel leyendo un archivo de verdad. `simular-rls.mjs` da OK sobre las 336
policies del repo.

Queda:

1. **Conceder el módulo** desde `/administracion/usuarios`. Al 13/11/2026 lo
   tiene una persona, con nivel `edicion`.
2. **Abrir las pantallas en un navegador.** Todo está detrás del login, así que
   ninguna se vio corriendo: lo verificado es el esquema, los tests, `tsc`, el
   build y los dos escaneos (responsive y exportaciones).
3. **Si molestan los números**, las pruebas del ida y vuelta consumieron
   identidades: las secuencias quedaron en 4 y 6, así que el primer cliente real
   va a ser el N° 5 y la primera oportunidad la N° 7. Es cosmético —un número de
   identidad no promete no tener huecos— y con las tablas vacías se reinicia
   con `select setval('ventas_clientes_numero_seq', 1, false);` y lo mismo para
   `ventas_oportunidades_numero_seq`.
