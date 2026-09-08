# Producción — el informe de fábrica deja de ser un papel

Diseñado y construido el 7 y 8 de septiembre de 2026. Es el primer módulo del
SdG que no porta una app ni una planilla ajena: el diseño está en
[docs/superpowers/specs/2026-09-07-produccion-design.md](superpowers/specs/2026-09-07-produccion-design.md)
y el plan de implementación, tarea por tarea, en
[docs/superpowers/plans/2026-09-07-produccion.md](superpowers/plans/2026-09-07-produccion.md).
Acá quedan las decisiones y las trampas que no se deducen del código; para el
detalle de cada paso, esos dos documentos.

## Qué reemplaza

El formulario **040/2, *INFORME DE FÁBRICA***, papel de Polcecal S.A. – Polysan
S.A., uno por turno (**4→12** y **12→20**; las otras ocho horas no se
registran). Lo firma el capataz: día, turno, material en depósito, lo
despachado camión por camión, rotura, observaciones y limpieza.

Y el Excel donde alguien lo transcribía, `INFORME PRODUCCIÓN PT.xlsx`, con un
botón ▶ GUARDAR DÍA que volcaba los totales a tres hojas de resumen.

**Sigue siendo calidad quien carga.** El capataz no entra al sistema; su papel
no cambia. Lo que cambia es el destino de la transcripción: el SdG en vez del
Excel.

## Que la producción no se mide: se despeja

Ni el papel ni el Excel tienen un número de "lo producido". Sale de la cuenta:

```
producción = depósito − depósito del parte anterior + despachado + rotura
```

Vive en `lib/produccion/produccion.ts` (`produccionDelTurno`), con
`lib/produccion/turnos.ts` (`parteAnterior`) diciendo cuál es el parte
anterior: el `12_20` del día previo antes de un `4_12`, el `4_12` del mismo día
antes de un `12_20`.

**Por qué el depósito anterior no se guarda.** En el Excel vive en la columna
`N` de `Carga Diaria`, oculta y **única por producto**, no una por día: el
Apps Script la pisa con el stock de hoy al guardar, para que "mañana esté
puesta". Si alguien cambia la fecha sin haber guardado el día anterior, guarda
el día dos veces, o abre un día viejo, esa columna queda con el stock que no
es y la producción sale mal sin que nada avise. En el archivo relevado ya
había pasado: la fecha decía 03/09, `N` para *Bolsones de Cal 0-1* decía 17,
pero el `Histórico` real del 02/09 decía otra cosa — el "producido" de ese día
salía de un stock inicial que no era el del día anterior.

Acá no hay columna que pisar: `parteAnterior()` busca el parte de turno
anterior **en orden cronológico**, así que no puede quedar viejo — no hay
dónde guardarlo viejo. Es la corrección directa de ese agujero.

## Los cuatro estados que no son un número

Un cero en una grilla de producción no se distingue de un día sin producir.
Por eso `ProduccionDelProducto` (`lib/produccion/produccion.ts`) nunca devuelve
un número solo: siempre estado y, si corresponde, cantidad.

| Estado | Cuándo aparece | Por qué existe |
|---|---|---|
| `sin_parte_anterior` | Falta el parte de turno anterior | No hay resta posible. Devolver 0 sería inventar un día sin producción — la razón de ser del módulo, contra el agujero de la columna `N` del Excel |
| `dia_incompleto` | Un día tiene un turno cargado y el otro no | `produccionDelDia` distingue "faltó cargar" de "se cargó y dio cero": los dos turnos que faltan dan el mismo `{}`, y sin este estado el día se calculaba con la mitad de los datos y mentía como si fuera el día entero (fix del 8/09) |
| Turno sin cargar (`cargado: false`) | No existe ningún `produccion_partes` para ese `(fecha, turno)` | Es un dato distinto de "cargado con todo en cero": la pantalla del día (`app/(app)/produccion/page.tsx`) lo lleva aparte y no lo mete en `ProduccionPorProducto` |
| Producción negativa | El cálculo da un número menor a cero | Es un error de carga —depósito mal contado, renglón de despacho perdido— y **se muestra en rojo con la cuenta desglosada, no se recorta a cero**. Recortarlo escondería justo lo que hay que corregir |

`produccionDelDia` prioriza `sin_parte_anterior` por sobre `dia_incompleto`
sólo cuando el turno faltante es, además, el que no tiene anterior; si lo que
falta es un turno entero, gana `dia_incompleto` porque describe la causa real
— no es que falte un dato para restar, es que falta cargar.

## La planilla: acá manda el sistema, no ella

Es la diferencia con Compras, donde manda la planilla. Calidad carga en el SdG
y la planilla de Google (`GOOGLE_SHEETS_PRODUCCION_ID`) queda como espejo de
**una sola dirección**, para quien la mira sin entrar al sistema. Al guardar un
parte se escriben `Resumen Producción`, `Resumen Despacho` y `Resumen Rotura`
(`lib/produccion/espejo.ts`).

Su estructura, relevada del archivo real:

- **Encabezados en la fila 4**, fechas en la columna A de la **fila 5 a la
  34**: treinta días. **Los meses de 31 no entran** — el 31 no tiene fila y no
  se le inventa una: `filaDeLaFecha` devuelve `null` y el parte queda
  `sheets_pendiente`.
- `Resumen Rotura` tiene un **segundo bloque con los porcentajes**, que arranca
  donde lo dice el marcador de la **fila 3** (`"% ROTURA / PRODUCCIÓN"`), no la
  de encabezados. Los nombres de producto se repiten idénticos en los dos
  bloques, así que buscar el nombre en toda la fila encontraría siempre el
  primer bloque — por eso `celdasDeResumen` recibe la ventana de columnas
  donde tiene que mirar, en vez de buscar en la fila entera.
- **`Carga Diaria`, `Histórico` y el botón de Apps Script quedan fuera de
  uso.** `Histórico` existía nada más para que el script supiera el stock del
  día anterior; acá esa función la cumple `parteAnterior()` leyendo los partes
  propios, así que esa hoja no tiene lector.

El riesgo asumido, dicho explícitamente: **si alguien edita la planilla a
mano, el SdG no se entera y la pisa** la próxima vez que se guarde ese día. No
hay lectura de vuelta.

Un fallo de escritura no es un `console.warn`: queda en
`produccion_partes.sheets_pendiente` con lo que dijo Google sin traducir, y
`app/api/produccion/planilla/reintentar/route.ts` lo reintenta. Las
credenciales de Google no están en local — esto sólo se prueba en el deploy.

## El catálogo de productos

El papel tiene **~15 renglones** agrupados en tres familias (*Filler*, *0-2*,
*Cal*) más un renglón libre "Otros"; el Excel tiene **17 columnas** con otros
nombres, repartidas entre `Carga Diaria` y las hojas de resumen. **La
correspondencia entre los dos no está escrita en ningún lado** — vive en la
cabeza de quien carga hoy el Excel.

Por eso `produccion_productos` está **vacía a propósito**. No se cargó una
lista de arranque porque no hay ninguna que se pueda armar sin que alguien de
calidad la revise renglón por renglón: enlazar "al que se parece" acá no es un
enlace opcional, es sumar la producción de un producto en la columna de otro,
y **eso no se nota nunca** — el número aparece, sólo que en el lugar que no es.

**La carga inicial la tiene que definir calidad**, con tres cosas por
confirmar además del nombre de cada renglón (detalladas más abajo, en "Lo que
falta de una persona"): los kilos por unidad de cada envase, la tolerancia de
la comprobación kilos↔bultos, y qué número va en cada columna del papel
cuando hay dos candidatas.

La pantalla `/produccion/productos` (sólo `admin`) es donde se carga esa lista
una vez que esté definida — no hay importador ni script de una vez.

## Lo que quedó afuera a propósito

- **El granel.** Se mide en toneladas y hoy no está en este circuito. El
  catálogo ya modela `familia` y `envase` como para sumarlo después, pero
  sumarlo es relevar de dónde sale el dato, no una migración.
- **El módulo Despacho.** Los renglones de camión de acá son lo que el capataz
  dice que cargó — el registro de fábrica —, no el remito ni el pesaje. No hay
  catálogo de clientes en el núcleo: `cliente_raw` es texto libre hasta que
  exista ese módulo.
- **Las paradas de máquina como dato estructurado.** El campo `observaciones`
  de un parte es texto libre, igual que en el papel — *"molino de 10:00 a
  10:30, regulación y revisión"*. Convertirlo en paradas con equipo, motivo y
  horario es lo que le serviría a Mantenimiento, pero es un spec aparte que
  necesita que alguien decida el vocabulario.
- **El histórico viejo del Excel.** Este módulo arranca en la fecha en que
  calidad empiece a cargar acá. Traer los meses anteriores es una importación
  puntual, y se decide después de que el catálogo esté cerrado — importar
  contra un catálogo que todavía no está resuelto repetiría el mismo error que
  el módulo existe para evitar.
- **Versionado de correcciones.** Se guarda quién cargó y quién modificó por
  última vez (`cargado_por`/`actualizado_por` en `produccion_partes`), pero no
  el historial completo de cada edición. Se puede agregar sin migrar nada de
  lo que ya existe.

## Lo que está pendiente de una persona

De **calidad**, antes de poder cargar un parte de verdad:

1. **El catálogo canónico**, renglón por renglón — ver arriba.
2. **Los kilos por unidad de cada envase.** La bolsa son 25 kg; el bolsón está
   sin confirmar. Sin ese número, `desajustesDeKilos()` no compara ese
   producto — no inventa un kg por unidad, lo salta.
3. **La tolerancia de la comprobación kilos↔bultos**, que hoy arranca en 5% en
   el código. El caso real relevado —1.200 bolsas contra 29.280 kg, cuando
   1.200 × 25 son 30.000— da 2,4% y no dispara aviso; puede estar bien o
   pueden faltar 29 bolsas, y eso no lo decide el código.
4. **Qué número va en cada columna de "Material despachado".** El papel tiene
   dos columnas —*Productos y kilos* y *Cantidad bolsa/bolsón*— y en los
   renglones relevados el número a veces parece kilos y a veces bultos. El
   relevamiento se hizo sobre una foto de letra manuscrita: hay que
   confirmarlo antes de transcribir el primer parte real.

Del **usuario**:

5. **El id de la planilla de Google**, compartida como **editor** con la
   cuenta de servicio del SdG (`GOOGLE_SHEETS_PRODUCCION_ID`, y los tres
   nombres de pestaña si difieren de los que trae el código por defecto:
   `Resumen Producción`, `Resumen Despacho`, `Resumen Rotura`), y la decisión
   de ampliarla a 31 filas si se quiere dejar de perder los meses largos.
6. **Correr una migración que falta.**
   `supabase/migrations/20260908082159_produccion_despachos_sin_renglones_duplicados.sql`
   agrega `unique (parte_id, orden)` a `produccion_despachos`. Las otras dos
   del módulo —el enum y el schema— **sí están corridas**; ésta todavía no.
   Hasta que se corra: `app/api/produccion/partes/route.ts` reemplaza el
   depósito y los despachos de un parte con un `delete` + `insert` sueltos
   —PostgREST no da transacciones multi-sentencia—, así que dos guardados
   simultáneos del mismo parte (alcanza un doble clic en Guardar) pueden
   intercalarse y duplicar todos los renglones de despacho, y el día se
   exporta con el despacho y la rotura al doble **sin ningún error**. La
   migración no arregla la carrera —para eso hace falta un RPC que serialice
   las dos escrituras—, convierte la duplicación silenciosa en un error visible
   que la ruta ya sabe manejar como cualquier otro fallo de escritura.

Nada de esto frena el código ni los tests, que están completos. Frena cargar
datos de verdad.

## Dónde está cada cosa

| | |
|---|---|
| Módulo | `app/(app)/produccion`, `lib/produccion`, `app/api/produccion` |
| El despeje | `lib/produccion/produccion.ts` — `produccionDelTurno`, `produccionDelDia` |
| Cuál es el parte anterior | `lib/produccion/turnos.ts` — `parteAnterior` |
| Renglones → totales | `lib/produccion/despachos.ts` — `totalesDeDespacho`, `roturaTotal`, `desajustesDeKilos` |
| La matriz del mes | `lib/produccion/mes.ts` — `armarLosDias`, reusa las mismas piezas que el día y la planilla |
| El espejo a Sheets | `lib/produccion/espejo.ts` + `lib/produccion/planilla.ts` (celdas, sin red) |
| Permisos | `lib/produccion/auth.ts`, espejando `tiene_acceso_produccion()` / `puede_editar_produccion()` / `es_admin_produccion()` de la base |
| Pantallas | `/produccion` (el día), `/produccion/parte/[fecha]/[turno]` (la carga), `/produccion/resumenes` (el mes), `/produccion/productos` (el catálogo, sólo admin) |
| Tarjeta del inicio | `resumenProduccion()` en `app/api/home/resumen/route.ts` — partes sin cargar de los últimos 7 días, partes que no llegaron a la planilla |
| Migraciones | `20260907154332_produccion_enum_del_modulo.sql`, `20260907154336_produccion_schema.sql` (corridas), `20260908082159_produccion_despachos_sin_renglones_duplicados.sql` (**sin correr**, ver arriba) |
| Diseño acordado | [specs/2026-09-07-produccion-design.md](superpowers/specs/2026-09-07-produccion-design.md) |
| Plan de implementación | [plans/2026-09-07-produccion.md](superpowers/plans/2026-09-07-produccion.md) |

**Ojo con el nombre repetido.** El menú de Mantenimiento ya tenía una entrada
"Producción" (`/mantenimiento/produccion`, tabla `produccion_semanal`): es la
planificación semanal por sector, para decidir ventanas de reparación —una
cosa completamente distinta de este módulo, que es el informe de fábrica por
turno. Los dos conviven porque no comparten tabla ni ruta, pero el nombre
suelto en una conversación puede referirse a cualquiera de los dos.
