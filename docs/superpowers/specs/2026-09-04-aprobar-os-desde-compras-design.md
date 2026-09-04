# Aprobar órdenes de servicio desde Compras

Diseño acordado el 4 de septiembre de 2026.

## El problema, dicho como lo dijo quien lo tiene

**"La aprobación de las OS la hace Nico, para que pasen a comparativa. Que en
la pestaña de Aprobaciones vea también las OS."**

Hoy una OS se aprueba escribiendo `APROBADO` a mano en la planilla. El sistema
las muestra todas —las 228, de las siete áreas— pero no puede aprobar ninguna, y
quien aprueba no tiene un lugar donde ver qué está esperando su decisión. Los
requerimientos sí lo tienen desde siempre: la pantalla **Aprobaciones**.

Es el mismo momento del circuito en los dos casos: lo que espera un sí antes de
que se le pidan presupuestos. En un RI es `PENDIENTE`/`EN_REVISION` → `APROBADA`;
en una OS es `POR APROBAR`/`EN REVISIÓN` → `APROBADO` → `EN PROCESO (COMPARATIVA)`.

## El terreno, verificado contra la base y la planilla

### Las OS de todas las áreas ya están, y ya se ven

Lo primero que hubo que descartar. `sincronizarOrdenesDeServicio()` ya recorre
las diez pestañas de [`lib/mantenimiento/os.ts`](../../../lib/mantenimiento/os.ts),
la pantalla las lista todas y tiene filtro por área. La base, al 4 de septiembre:

| Área | OS |
|---|---|
| Mantenimiento | 177 |
| Taller Vial | 31 |
| Producción | 11 |
| Almacén | 4 |
| Laboratorio | 2 |
| OTRA | 2 |
| Cantera | 1 |
| **Total** | **228** |

`INVERSIONES` y `DESPACHO` están en la lista de pestañas y traen 0 filas. No es
un problema a resolver acá: son áreas sin OS cargadas.

### Estar en `SERVICIOS` *es* no estar aprobada

Cada pestaña de área es un `FILTER(SERVICIOS!A2:K; área=…; estado="APROBADO")`.
O sea: **una OS llega a la pestaña de su área si y sólo si alguien le escribió
`APROBADO` en el maestro**. Eso vuelve el `sheets_tab` una respuesta exacta a la
pregunta "¿está aprobada?", sin depender de la columna de estado.

Y separa dos grupos que en el listado se ven iguales —los dos con el estado
vacío— pero que son trabajos distintos:

| | Cuántas | Qué son |
|---|---|---|
| `sheets_tab = SERVICIOS` | **11** | Nunca se aprobaron. **Éstas espera Nico.** |
| En su pestaña de área, estado vacío | 23 | Ya aprobadas; les falta el seguimiento. |

Las 23 no entran a la bandeja. Que aparezcan sería pedirle a Nico que decida
algo que ya está decidido.

Las 11 son las mismas que ya menciona el comentario de
[`lib/mantenimiento/denegacion.ts`](../../../lib/mantenimiento/denegacion.ts)
—"son 11 hoy, las que no se aprobaron, justo las candidatas naturales a
denegarse"—: OS 219 a 228, y la 26.

### La trampa: aprobar corre filas, pero no siempre

Está escrita en el código y es la razón por la que aprobar desde la app no
existía. `APROBADO` es el único valor que mete una fila en una pestaña de área, y
cuando el `FILTER` levanta una fila **las de abajo se corren**, mientras el
seguimiento escrito a mano —comparativa, proveedor, costo, fechas— **no se corre
con ellas**. Queda un costo colgado de otra OS. Es el mismo daño que detecta
`seguimientoHuerfano()`.

Por eso [`seguroParaElMaestro()`](../../../lib/mantenimiento/denegacion.ts)
bloquea `APROBADO` en seco, y denegar es el caso seguro: la OS ya estaba afuera
de la pestaña y sigue afuera.

**Pero la trampa muerde sólo hacia arriba.** Si la OS que se aprueba tiene un
número mayor que todas las de su pestaña, entra al final y no corre nada.

### El `FILTER` conserva el orden, y eso está medido

Toda la regla depende de que la pestaña quede ordenada por N° de OS ascendente.
Se comprobó contra las 228 filas, comparando `sheets_row` con `os_number` dentro
de cada pestaña:

| Pestaña | Filas | Fuera de orden | Primera | Última |
|---|---|---|---|---|
| MANTENIMIENTO | 167 | **0** | 1 @2 | 218 @168 |
| TALLER VIAL | 31 | **0** | 4 @2 | 208 @32 |
| PRODUCCIÓN | 11 | **0** | 34 @2 | 177 @12 |
| ALMACÉN | 4 | **0** | 25 @2 | 171 @5 |
| LABORATORIO | 2 | **0** | 23 @2 | 174 @3 |
| CANTERA | 1 | **0** | 190 @2 | 190 @2 |
| OTRA | 1 | **0** | 91 @2 | 91 @2 |

Cero desórdenes en las siete. De ahí sale la regla:

> Aprobar una OS no corre ninguna fila si su número es mayor que el máximo que
> ya está en la pestaña de su área.

Contra las 11 que esperan: **10 son seguras** —la 219 va a `OTRA`, cuyo máximo es
91; las 220 a 228 van a `MANTENIMIENTO`, cuyo máximo es 218—. **La 26 no**:
entraría cerca de la fila 21 y correría 147 filas de seguimiento.

Y de acá en adelante las OS nuevas llegan siempre con el número más alto, así
que el caso peligroso es el rezago viejo, no el trabajo del día.

### Quién aprueba hoy, y quién va a aprobar OS

`compras_aprobadores` tiene tres: Maxi (`MAXI`, encargado), Nico (`NICO`,
admin_sistema) y Admin (`ADMIN`). Es la lista que gatea la pantalla Aprobaciones
por `soloAprobadorCompras`.

Las OS van a tener **su propia lista**. Aprobar un servicio y aprobar un material
los decide gente distinta, y una lista que hereda de la otra en silencio no
permite que se separen después.

### Volumen

Doce requerimientos esperando decisión y once OS. Números del mismo orden y
chicos: las dos cosas entran en una pantalla sin esconder ninguna.

## El diseño

### 1. La pantalla: dos secciones, una sola visita

`/compras/aprobaciones` pasa a tener dos secciones, cada una con su encabezado y
su cuenta: **Requerimientos** arriba, **Órdenes de servicio** abajo. Nico abre
una pantalla y ve todo lo que espera su decisión.

Las OS se ordenan por prioridad —`URGENTE`, `1 SEMANA`, `NORMAL`, `LEVE`, las de
`PRIORIDADES_OS`— con la antigüedad como desempate, que es lo que ya hace la
sección de requerimientos con la urgencia.

Qué entra: `sheets_tab = 'SERVICIOS'` y estado distinto de `DENEGADO`.

Cada OS muestra lo que hace falta para decidir: número, fecha, área, sector,
equipo, descripción, detalle extra, prioridad y la imagen si la trae. No hay
costo todavía —la comparativa viene después de aprobar—, así que la decisión es
"¿se hace o no?", no "¿cuánto sale?".

### 2. Quién aprueba: `os_aprobadores`

Migración `20260904140041_os_aprobadores.sql`, ya escrita:

```sql
create table if not exists os_aprobadores (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

RLS: lectura para cualquier autenticado —el menú y la pantalla necesitan saber
si sos aprobador—, y escritura para `es_admin()` o admin del módulo Compras, que
es la misma regla que la 028 le puso a `compras_aprobadores`. Van a quedar una
al lado de la otra en la pantalla de configuración: que se editen con reglas
distintas es de las cosas que nadie descubre hasta que a alguien le falta un
botón. Estar en la lista no alcanza para administrarla, o cualquier aprobador
podría sacar a los demás.

Del lado de la base queda `puede_aprobar_os()`, espejo de
`puede_aprobar_compras()`. Sembrada con Nico en la misma migración, por id y con
un `select` desde `usuarios` para que un id que no exista no revierta el archivo
entero.

Sin alias de planilla, que es la única diferencia con la lista hermana: la
planilla de Compras firma la aprobación con un nombre corto entre paréntesis, la
de OS no firma —su columna de estado dice `APROBADO` y nada más—.

Se administra desde **Configuración de Compras**, al lado de la lista de
aprobadores de requerimientos. Una lista que sólo se puede tocar por SQL es una
trampa a los seis meses, cuando Nico se tome vacaciones.

### 3. Aprobar, y la guarda

La función pura vive en `lib/mantenimiento/aprobacion.ts`:

```ts
/** Si aprobar esta OS metería su fila en el medio de la pestaña de su área. */
export function aprobarCorreriaFilas(
  osNumber: number,
  maximoEnLaPestana: number | null
): boolean;
```

`null` —pestaña vacía— es seguro: no hay nada abajo que correr.

`seguroParaElMaestro()` deja de bloquear `APROBADO` en seco y pasa a consultarla.

El flujo al aprobar:

1. Se lee la columna de números de la pestaña del área —`pestanaDeArea(area)`— y
   se saca el máximo.
2. Si `aprobarCorreriaFilas()` da verdadero: **no se escribe nada y no se guarda
   nada**. Se contesta que esa OS entraría en el medio de la pestaña y correría
   el seguimiento de las de abajo, y que hay que aprobarla a mano en la planilla.
3. Si no: se escribe `APROBADO` en la columna de estado de `SERVICIOS`, buscada
   por encabezado y no por la letra L, y recién entonces se guarda en la base.

El máximo se lee **de la planilla en el momento de escribir**, no de la base. La
base sirve para pintar el aviso en el listado sin salir a Google en cada render,
pero la decisión de escribir se toma contra la verdad: una sincronización vieja
haría escribir sobre un supuesto.

### 4. Aprobar es la única acción que no es best-effort

Todo lo demás que escribe [`escribirEnPlanilla()`](<../../../app/api/mantenimiento/ordenes-servicio/route.ts>)
es best-effort a propósito: la app ya guardó, y que Google esté caído no puede
tirar abajo el cambio. Aprobar no puede funcionar así.

Una OS aprobada en el sistema y sin `APROBADO` en `SERVICIOS` **nunca llega a la
pestaña de su área**: nadie del área la ve, la comparativa no aparece, y el
sistema dice que sí mientras la planilla dice que está esperando. Es exactamente
la divergencia que el CLAUDE.md prohíbe.

Por eso el orden se invierte para este caso: primero la planilla, después la
base, y si la planilla no acepta, se rechaza entera.

### 5. Denegar y dejar en revisión

Se reusa lo que ya existe: `esDenegacionDeOS()`, `faltaLaJustificacion()` y el
motivo obligatorio de
[`lib/mantenimiento/denegacion.ts`](../../../lib/mantenimiento/denegacion.ts).
`EN REVISIÓN` es seguro para el maestro porque no es `APROBADO`, así que también
se puede dejar una OS en revisión desde la bandeja.

Una bandeja donde sólo se puede decir que sí es media bandeja: las que se
deniegan se quedarían ahí para siempre.

### 6. Permisos

`permisosComprasActuales()` suma un `puedeAprobarOS`, al lado del `puedeAprobar`
que ya devuelve. Va en el mismo `Promise.all` que las otras preguntas: no agrega
una espera.

El PATCH de `app/api/mantenimiento/ordenes-servicio/route.ts` hoy exige
`puedeEditarMantenimiento()`. Pasa a aceptar también a quien esté en
`os_aprobadores`, para el subconjunto de cambios que es aprobar o denegar. Sin
eso, un aprobador de OS que no tenga el módulo Mantenimiento se come un 403 —hoy
no se nota porque Nico es `admin_sistema`, pero es lo que rompe en cuanto la
lista sume a alguien más—.

### 7. El menú

`Aprobaciones` pasa a verse si estás en **cualquiera de las dos listas**.
`Para aprobar` —que es la segunda aprobación, la de a quién comprarle, y sólo
tiene requerimientos— se queda con la lista de Compras.

En la pantalla, los botones de cada sección se habilitan según la lista que
corresponde: estar en una no habilita la otra.

## Qué se testea

Vitest sobre las funciones puras, que es donde están las decisiones:

- `aprobarCorreriaFilas()` contra los casos reales: la 26 corre filas, las 220 a
  228 no, la 219 sobre `OTRA` no, una pestaña vacía no.
- `seguroParaElMaestro()` con la guarda puesta: `APROBADO` deja de ser un no
  absoluto y pasa a depender del número.
- El filtro de qué OS esperan decisión: que las 23 con seguimiento vacío no se
  cuelen, y que las denegadas tampoco.
- El gate del menú con la lista nueva, extendiendo
  [`lib/core/nav-compras.test.ts`](../../../lib/core/nav-compras.test.ts).

La ruta y la pantalla no llevan tests, como en el resto del repo: por eso la
guarda sale de la ruta a `lib/`.

## Riesgo asumido y qué queda afuera

- **La OS 26 hay que aprobarla a mano** en la planilla. El sistema lo va a decir
  con todas las letras en vez de hacerlo mal.
- **Las 23 con seguimiento vacío no entran** a la bandeja. Si hace falta una
  pantalla para ésas, es otra feature: no es trabajo de aprobación.
- **Nada de la escritura se puede probar desde local.** Las credenciales de
  Google sólo están en el deploy; acá se verifica con vitest sobre las puras y
  consultando la base.
- **La propagación del `FILTER` no es instantánea.** Después de aprobar, la OS
  sigue apuntando a `SERVICIOS` hasta que alguien sincronice y la pestaña de área
  ya la haya levantado. No rompe nada: `SERVICIOS` se lee primero y la pestaña de
  área pisa el registro después, que es lo que ya hace `porNumero`.
- **La gestión completa de las OS desde Compras no es esto.** Se conversó y quedó
  para después: una pantalla propia fuera de los dos módulos, alcanzable con
  Compras o con Mantenimiento. Acá sólo entra la aprobación.

## Lo que hace falta antes de que ande

| Falta | Quién |
|---|---|
| Correr `20260904140041_os_aprobadores.sql` en el editor SQL de Supabase | el usuario |
| `GOOGLE_SHEETS_OS_ID` configurada en Vercel | ya lo estaba |
| La planilla de OS compartida como **editor** | ya lo estaba, se usa para denegar |

Hasta que la migración esté corrida, la sección no tiene a quién dejar aprobar.
