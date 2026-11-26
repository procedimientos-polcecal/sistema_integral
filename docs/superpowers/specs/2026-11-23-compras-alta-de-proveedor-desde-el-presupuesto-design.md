# Dar de alta un proveedor desde la carga de un presupuesto

**Fecha:** 23/11/2026 · **Módulo:** Compras · **Estado:** acordado, sin empezar

## Qué se quiere y por qué

Hoy, cargando un presupuesto en la comparativa de un RI, el proveedor **tiene
que estar ya en la lista**. Si no está, hay que abandonar el formulario, ir a
`/compras/proveedores`, darlo de alta y volver — y lo que queda cargado es un
proveedor que no sirve para lo que viene después.

Lo que viene después es la cadena que el usuario nombró: **cargar la cotización
y, si avanza, generarle la orden de compra**. Esa orden se empuja a Odoo, y Odoo
pide un `res.partner`. Sin ese enlace la cadena se corta con el cartel que ya
existe: «El proveedor del RI N no existe en POLCECAL dentro de Odoo».

Así que el alta desde el presupuesto no es una comodidad de pantalla: es el
primer eslabón de una cadena que hoy se corta en el último.

### Lo medido el 23/11/2026, que es lo que le da forma a esto

| | |
|---|---|
| Proveedores en el padrón | **484** (todos activos) |
| Con CUIT | 168 · **sin CUIT: 316** |
| Enlazados a Odoo (`proveedores_odoo`) | **130** · con CUIT pero sin enlace: 38 |
| Cotizados en los últimos 180 días | 109 proveedores, 1.077 cotizaciones |
| De ésos, **sin enlace a Odoo** | **45** — y **40 de los 45 no tienen CUIT** |
| Grupos de nombres casi iguales en el padrón | **81** por igualdad de `claveProveedor()`, **119** por `nombresParecidos()` |
| CUIT repetidos en el padrón | 4 |
| RI de los últimos 180 días | 1.024 · con empresa: 597 · **AMBAS: 410** · sin ninguna: 17 |
| Proveedores enlazados en las **dos** empresas | 91 de 130 |

Tres cosas salen de ahí, y son las que mandan:

1. **Lo que traba la cadena no es que falte el alta en Odoo: es que no se sabe
   quién es el proveedor.** De los 45 que hoy no pueden llegar a una orden, 40
   no tienen CUIT. Sin CUIT no se puede ni buscar si ya está en Odoo ni crearlo
   sin arriesgar un duplicado. **Por eso en esta alta el CUIT es obligatorio**,
   aunque en `/compras/proveedores` no lo sea.
2. **La empresa ya se sabe al cargar el presupuesto**: el presupuesto se carga
   dentro de un RI, y 1.007 de 1.024 RI tienen empresa o están marcados AMBAS.
   Pero el 40% son AMBAS, y en Odoo un partner pertenece a **una** empresa: ese
   caso son **dos** `res.partner`, no uno.
3. **El padrón ya está duplicado, y el duplicado nace por este camino.** El
   importador de la comparativa de Drive crea un proveedor cuando el nombre de
   la planilla no existe, **con el nombre y nada más**: así nacieron los tres
   del 23/11 (CORPOM, WARBEL, MARTINESE (ALUBA)) y buena parte de los 316 sin
   CUIT. Un duplicado en el padrón se arregla acá; uno que llega a la
   contabilidad lo tiene que limpiar administración.

   Los 81 y los 119 no son dos mediciones del mismo número: son dos
   definiciones de «parecido», y la diferencia decide el diseño del paso 2.
   `proveedores.nombre` es `unique`, así que dos nombres **exactamente**
   iguales no pueden existir — los 81 son variantes de mayúsculas y acentos
   («Matelec» / «MATELEC»), y los 38 que agrega `nombresParecidos()` son los
   que comparten las palabras propias sin compartir la clave entera
   («TODO RULEMAN» / «TODO RULEMAN, EQUIPARTES»).

## Objetivos

- Que desde el formulario de presupuesto se pueda dar de alta un proveedor sin
  salir de la pantalla, y quede elegido en el presupuesto que se estaba
  cargando.
- Que ese proveedor nazca **identificado** (con CUIT) y, si ya existe en Odoo,
  **enlazado** desde el minuto cero.
- Que cuando el RI avance a orden de compra, el proveedor no sea el motivo por
  el que se corta.

## No objetivos

- **No** se arregla el padrón que ya está (los 316 sin CUIT, los grupos de
  nombres parecidos, los 4 CUIT repetidos). Es una limpieza de datos aparte y
  la decide una persona, no este cambio.
- **No** sirve para completarle el CUIT a un proveedor que ya está en la lista
  (decidido por el usuario el 23/11). Esto importa decirlo fuerte porque es
  contraintuitivo: **de los 45 proveedores que hoy no llegan a una orden, 40 ya
  están en el desplegable** —los creó el importador de la comparativa con el
  nombre y nada más—, así que **este cambio no destraba a ninguno de ellos**.
  Lo único que ganan es que el cartel del ensayo pase a decir la verdad: que lo
  que falta es el CUIT, no el enlace. Completarlos se sigue haciendo en
  `/compras/proveedores`. El modal es para el proveedor que **no está**.
- **No** se toca el importador de la comparativa de Drive, que va a seguir
  creando proveedores con sólo el nombre. Es otro camino y otro problema; queda
  nombrado acá para que no se lo confunda con éste.
- **No** se convierte el modal en un segundo lugar donde administrar
  proveedores. La ficha completa sigue viviendo en `/compras/proveedores`.
- **No** se importan proveedores desde Odoo hacia el SdG.

## Anti-objetivos

Cosas que harían fracasar esto aunque funcione:

- **Crear en Odoo un partner que ya estaba.** Odoo tiene 610 registros de
  proveedor y 422 CUIT distintos; un duplicado allá no se borra una vez que
  tiene documentos, sólo se archiva, y ensucia la contabilidad de las dos
  empresas.
- **Dejar nacer el proveedor sin CUIT.** Sería agregar el 317.
- **Enlazar al que se le parece.** La regla del sistema vale igual acá: por
  CUIT o nada. Un enlace equivocado no se nota nunca — la orden de compra le
  llega al proveedor que no era.

## Restricciones

- **No hace falta ninguna migración.** `proveedores` ya tiene todas las
  columnas (incluida `razon_social`, del 11/11/2026) y `proveedores_odoo` ya
  existe con su `(proveedor_id, empresa_id, odoo_partner_id)`.
- **El Odoo de `.env.local` es el de staging y está congelado desde el
  11/09/2026**, así que la creación del partner **no se puede ensayar contra
  Odoo desde local**. La primera corrida real es en producción, y eso cambia
  qué se puede dar por probado (ver «Lo que sólo se comprueba en la primera
  corrida real»).
- Reglas del repo que aplican: desplegables con `<Select>` y no `<select>`;
  grilla de tres columnas con breakpoint (`grid-cols-1 sm:grid-cols-3`); un
  ancho al lado de `.input` no se aplica —va en un `div` que envuelva al
  campo—; todo en castellano.
- `app/(app)/compras/requerimientos/[id]/page.tsx` trae los proveedores con un
  `select()` sin `.limit()`. Son 484 y crecen ~80 por mes: **PostgREST corta en
  1000 y no avisa.** No es tarea de este cambio, pero el que lo toque lo va a
  tener delante.

## Caminos considerados

**A — El alta crea en Odoo en el acto.** Al guardar, inserta en `proveedores`,
busca en Odoo por CUIT, enlaza si está y **crea el `res.partner` si no**, en la
empresa del RI o en las dos. Es lo pedido, literal. Lo que cuesta: escribe en la
contabilidad antes de que exista una compra, y el 40% de los RI son AMBAS, o sea
dos partners por alta para una compra que puede no ocurrir.

**B — El alta queda en el SdG; Odoo espera a la orden.** Mismo formulario y mismo
CUIT obligatorio, pero el partner se crea recién al generar la OC. Destraba de
paso a los 45 ya cotizados. Lo que cuesta: en el momento del alta, en Odoo
todavía no hay nada, que es justo lo que el pedido nombraba.

**C — Partido por lo que cuesta (elegido).** En el alta se **busca** por CUIT y
se **enlaza** si ya está —eso lee Odoo y no le escribe nada— y la pantalla dice
en qué quedó. El `res.partner` nuevo se crea **al generar la orden**, con la
empresa del RI ya decidida.

Se eligió C. Da «cargado en Odoo» en el caso normal —el proveedor al que se le
pide un presupuesto suele estar en los 610 registros de Odoo— sin inventar
partners para compras que no pasaron, y deja la escritura a la contabilidad en
el único momento en que hay una compra de verdad detrás. Lo que **no** se pudo
medir es la proporción entre «ya está en Odoo» y «hay que crearlo», porque el
Odoo accesible desde local es staging congelado.

## Cómo se construye

### 1. El botón y el modal

En `PresupuestoForm`, al lado del `SelectorProveedor`, un botón **«Nuevo
proveedor»**. Abre un modal; al guardar, el modal se cierra, el proveedor queda
**elegido** en el presupuesto que se estaba cargando y se suma a la lista en
memoria, sin recargar la página ni perder lo ya tipeado del presupuesto.

El modal pide:

| Campo | |
|---|---|
| Nombre | obligatorio |
| **CUIT** | **obligatorio**, validado con `cuitEsValido()` de `lib/core/cuit.ts` |
| Rubro, contacto, teléfono, email, notas | opcionales |
| Es contratista | opcional |
| Plazo de pago, condición de pago, forma de pago | opcionales — son los que el propio formulario autocompleta al elegir proveedor, así que cargarlos acá se paga solo en el presupuesto siguiente |

El CUIT se guarda **como lo escribió la persona** y se compara normalizado:
`normalizarCuit()` ya resuelve que el SdG lo escriba con guiones y Odoo sin
ellos.

### 2. Los dos frenos contra el duplicado

Antes de insertar, con el CUIT normalizado y con `claveProveedor()` de
`lib/compras/sheets.ts` (que ya pliega mayúsculas, acentos y los sufijos
societarios):

- **CUIT que ya está en el padrón → no se inserta.** El modal nombra al
  proveedor que lo tiene y ofrece usar ése. Es un freno duro: dos filas con el
  mismo CUIT son el caso que `cruzarProveedores()` informa y **no enlaza**, o
  sea que crear el segundo deja a los dos sin poder llegar a una orden.
- **Nombre que colisiona → se avisa, no se frena.** Se muestra el o los
  parecidos y se pregunta si es alguno de ésos, con un botón para usarlo. Se
  avisa y no se bloquea porque dos nombres parecidos pueden ser dos proveedores
  de verdad, y porque el CUIT ya es el freno que importa.

  **Va `nombresParecidos()` de `lib/core/proveedores.ts`, el laxo, y no la
  igualdad de `claveProveedor()`** (decisión mía, 23/11). La igualdad exacta de
  clave casi no se dispara en un alta nueva —si el nombre fuera idéntico, el
  `unique` de `proveedores.nombre` ya lo habría rechazado con un 23505—, así
  que ese freno sería código muerto justo en el caso para el que existe. El
  laxo es el que atrapa «MATELEC» cuando ya está «Matelec», que es como nacen
  los 81 grupos que hay. Cuesta una consulta sobre el padrón entero: son 484
  filas y la comparación es la que ya usa la pantalla de duplicados.

### 3. Odoo en el alta: sólo se lee

Con el CUIT ya validado, se busca en Odoo por `vat`, **en las dos empresas** y
**sin filtrar por `supplier_rank`** (un partner que existe como cliente y
todavía no como proveedor igual es el mismo CUIT, y crearlo de nuevo sería el
duplicado que se quiere evitar).

**La búsqueda es `buscarPartnersPorCuit()` de
[lib/odoo/emisor.ts](../../../lib/odoo/emisor.ts) y la elección es
`elegirPartnerDelEmisor()` de
[lib/odoo/proveedores.ts](../../../lib/odoo/proveedores.ts) — no
`cruzarProveedores()`** (decisión mía, 23/11, y es la corrección más importante
que trajo la revisión). Facturación ya resolvió exactamente este problema y lo
tiene probado: lee con `active_test: false` para ver los archivados, descarta
los `parent_id` —que son **contactos hijos**, direcciones de entrega y no el
proveedor—, prefiere el partner propio de la empresa sobre el compartido,
desempata por uso sólo cuando uno triplica al otro, y se **niega a elegir**
cuando queda un empate real. `cruzarProveedores()` no hace nada de eso:
empuja todos los partners del CUIT y `filasParaGuardar` se queda con el primero
que llegó. Copiar ése es cómo el modal termina enlazando en silencio a una
dirección de entrega, que es el anti-objetivo de este documento.

De ahí sale un **tercer desenlace** que el modal tiene que saber decir:

- **Si aparece uno solo por empresa:** se escribe la fila de `proveedores_odoo`
  y la pantalla dice en qué empresas quedó enlazado.
- **Si aparecen varios y no se puede desempatar:** **no se enlaza**, y la
  pantalla lo dice nombrando los candidatos. El proveedor se da de alta igual.
  Resolverlo es un acto de administración, no de quien está cargando un
  presupuesto.
- **Si no aparece:** no se le escribe nada a Odoo. La pantalla lo dice con
  todas las letras: *«Todavía no está en Odoo. Se va a crear cuando se genere la
  orden de compra.»*
- **Si el partner encontrado ya está enlazado a otro proveedor del SdG:** el
  `unique (empresa_id, odoo_partner_id)` de `proveedores_odoo` contesta 23505.
  Eso no es un error que mostrar crudo: es **la señal de que éste es un
  duplicado del que ya está**. El modal nombra al otro proveedor y ofrece
  usarlo, igual que el freno del CUIT.

**El CUIT se compara normalizado de los dos lados.** Medido contra Odoo: 1.636
de 1.639 `vat` son dígitos puros, pero **dos están guardados con guiones**
(`30-689471524`, `33-655088429`). Un dominio `["vat","=", <11 dígitos>]` no los
encuentra, la pantalla diría «todavía no está en Odoo» y la generación de la
orden crearía el partner que ya existía — que es, textualmente, el primer
anti-objetivo de este documento. Es el 0,1%, y la defensa no cuesta nada.

**`razon_social` sólo se completa si las dos empresas dicen lo mismo.** Es el
precedente de la migración del 11/11/2026, que midió 31 CUIT con dos nombres
distintos en Odoo y los dejó en null a propósito: ese valor termina en un
documento formal, y ahí equivocarse es peor que no saber.
- **Si Odoo no contesta o faltan credenciales:** el proveedor se da de alta
  igual y la pantalla dice que el enlace quedó pendiente. Un Odoo caído no
  puede impedir cargar un presupuesto. El enlace lo resuelve después la
  generación de la orden, o el cruce masivo que ya existe.

### 4. La creación del partner, al generar la orden

En el camino que ya existe (`app/api/compras/requerimientos/[id]/odoo/`), donde
hoy `ordenDeCompra.ts` levanta el problema `"sin proveedor enlazado"`:

1. Para cada empresa del RI sin `odoo_partner_id`, **buscar primero** por `vat`
   en esa empresa — alguien pudo haberlo creado mientras tanto.
2. Si no está, crearlo con `crearEn("res.partner", empresa, …)`, que es la
   función que ya pone la empresa en los valores **y** en el contexto.
3. Escribir la fila de `proveedores_odoo` y seguir con la orden.

**El partner se crea completo** (decidido por el usuario el 23/11: que quede
listo sin que nadie lo tenga que tocar). Qué va en el `vals`, medido contra
Odoo el 23/11 sobre los 658 partners con `supplier_rank > 0`:

| Campo | Qué va | Por qué |
|---|---|---|
| `name` | el nombre del alta | |
| `vat` | el CUIT, sin guiones | Es la única llave por la que este proveedor se va a poder volver a encontrar |
| `supplier_rank` | `1` | El cruce masivo de `/api/odoo/proveedores/enlazar` busca `[["supplier_rank", ">", 0]]`: sin esto el partner queda **invisible** para el cruce y después aparecería como «no está en Odoo» aunque esté |
| `partner_document_type_id` | el id de «CUIT» en `partner.document.type`, **resuelto por nombre en tiempo de ejecución** | Lo tienen 627 de 658. En staging «CUIT» es el 25, pero la regla del repo es que **ningún id de Odoo va escrito en el código** (`ordenDeCompra.ts`: «Nada de ids fijos»), y este catálogo es por base. Va un resolver en `lib/odoo/contexto.ts`, como los que ya hay para el impuesto y el picking |
| `income_wh_registration` | lo que devuelve `default_get` **para esa empresa** | Es un campo **`required`** de Odoo, así que no es opcional. Es el régimen de retenciones: plata. Se lee en vez de inventarse — `default_get` da `"1"` en las dos empresas y es lo que tienen 656 de los 658. Así el partner queda completo **sin que el SdG afirme por su cuenta un régimen de retención** |

Las cuentas contables (`property_account_payable_id`, `property_account_receivable_id`)
también son `required` y también salen del `default_get` de la empresa (181/63 en
POLCECAL, 497/379 en POLYSAN). No se tocan: Odoo las pone solo al crear con el
contexto de la empresa, que es lo que `crearEn()` ya hace.

**Sin CUIT no se crea nada en Odoo.** Un proveedor viejo del padrón, sin CUIT,
que llegue a este punto sigue dando el problema que da hoy — con el mensaje
corregido para que diga qué falta: el CUIT, no el enlace.

### 5. El ensayo dice lo que va a pasar

`ensayarOrdenesDeRequerimiento()` ya enumera los problemas antes de empujar.
`"sin proveedor enlazado"` deja de ser un muro y pasa a anunciar *«se va a crear
el proveedor en POLCECAL»* (o en las dos). Ese ensayo **es** la confirmación
previa a la escritura: no se agrega otro botón de confirmar.

### 6. Lo que se decidió no hacer, con el porqué

- **No se audita.** La regla del sistema es que se audita lo que no se deshace,
  y el precedente de al lado es claro: ni `pushOrden`, ni `pushFactura`, ni
  `pushRecepcion` llaman a `auditar()` — lo que se audita es **postear** un
  asiento y **cerrar** una recepción, que mueven plata y stock. Crear un
  `res.partner` no mueve ninguna de las dos y se puede archivar. Además
  `ACCIONES` tiene nueve verbos y ninguno es «crear», así que auditarlo pediría
  una migración de enum, que por la regla del repo **viaja sola**. Si más
  adelante se quiere, el lugar es la ruta y no la librería.
- **No se pide un permiso nuevo, y eso es un ensanche acotado que conviene
  decir en voz alta** (decisión mía, 23/11). El alta usa
  `puedeEditarCompras()`, el mismo que la ruta `POST /api/compras/proveedores`
  que ya existe; la creación en Odoo ocurre dentro de la generación de la OC,
  que ya tiene el suyo. Pero escribir en `proveedores_odoo` **hoy es de
  `admin`**: la policy de esa tabla es `es_admin()` y la única ruta que la
  escribe (`/api/odoo/proveedores/enlazar`) está cerrada con `es_admin_check`.
  Con esto, alguien con `edicion` en Compras pasa a poder crear un enlace, y el
  comentario de esa migración dice qué pasa si un enlace está mal: **la orden
  de compra le llega a otro proveedor.**

  Se acepta porque el ensanche está acotado por los tres frenos de arriba: el
  enlace no se elige a mano, se **deriva del CUIT que la persona tipeó**; si
  hay más de un candidato no se enlaza; y si el partner ya es de otro, tampoco.
  O sea que lo que se habilita no es «enlazar», es «enlazar cuando el CUIT no
  deja lugar a dudas». Quien lo construya tiene que dejar eso escrito en el
  código, porque desde afuera parece que una ruta de `edicion` escribe una
  tabla de `admin`.
- **El CUIT no se vuelve obligatorio en `/compras/proveedores`.** Ahí se cargan
  también contratistas y proveedores que nunca van a tener una orden de compra
  en Odoo; exigirlo rompería un alta que hoy funciona. La obligación es de
  **este** camino, porque este camino existe para llegar a una orden.

## Lo que queda a criterio de quien lo construya

- Si el modal es un componente nuevo o reusa el formulario de
  `ProveedoresClient.tsx`. Hoy ese formulario no pide CUIT obligatorio ni los
  campos de pago, así que probablemente convenga uno nuevo, chico, y dejar aquél
  como está.
- Si la ruta es `POST /api/compras/proveedores` con un parámetro o una ruta
  hermana. Lo que no es opcional es que la de hoy **siga aceptando altas sin
  CUIT**, porque la usa la pantalla de administración.
- Cómo se muestran los parecidos del paso 2 (lista, cartel, acordeón).
- El reparto entre `lib/` y la ruta. La regla del repo es que lo que decide algo
  se saca a `lib/` para poder probarlo: la normalización, la detección de
  duplicados y la decisión «enlazar / crear / no se puede» son funciones puras y
  van ahí.

## Lo que sólo se comprueba en la primera corrida real

Porque el Odoo de local es staging congelado:

- Que `crearEn("res.partner", …)` acepte el `vals` tal cual en las dos
  empresas. Los campos y el catálogo se leyeron de staging: que
  `partner.document.type` tenga una fila llamada exactamente «CUIT» en
  producción es lo que el resolver por nombre tiene que encontrar, y si no la
  encuentra **no debe inventar un id**: crea el partner sin ese campo (no es
  `required`) y lo dice.
- Que `default_get` devuelva `income_wh_registration` en producción. Si viniera
  vacío, el create falla por campo obligatorio — y eso tiene que salir como un
  problema del ensayo y no como un 500.
- Que el CUIT normalizado encuentre en Odoo de producción a los que ya están —
  la búsqueda por `vat` se puede leer desde local, pero contra una base
  congelada en septiembre.
- Que un partner recién creado aparezca después en el cruce masivo, que es lo
  que `supplier_rank: 1` tiene que garantizar.

**La primera prueba conviene hacerla con un RI de una sola empresa**, no con uno
AMBAS: si algo sale mal, hay un partner que archivar y no dos.
