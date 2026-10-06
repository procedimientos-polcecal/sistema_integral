# El Inicio deja de contar lo de hoy y empieza a decir qué falta hacer

Acordado el 6 de octubre de 2026. Rehace los indicadores de la página de Inicio
(`app/(app)/InicioClient.tsx` y `app/api/home/resumen/route.ts`), agrega las dos
tarjetas que faltaban y parte la ruta en dos.

## El problema, medido contra producción el 06/10/2026

El Inicio mostraba diez tarjetas con un número grande cada una. Casi todos esos
números eran **conteos del día**, y este sistema no se carga parejo: se carga a
ráfagas. Un titular diario queda en cero la mayoría de los días aunque el módulo
esté sano — y, lo que es peor, **no distingue "0 porque hoy no hubo" de "0 porque
nadie carga esto hace cinco semanas"**.

| Módulo | Titular que mostraba | Lo que medía de verdad |
|---|---|---|
| RRHH | Ausentes hoy · **1** | La última fichada es del **30/09**. Desde el 01/10 el cálculo marca **64, 65, 50 y 66 de 68** empleados como ausentes. El titular decía 1 porque hoy alcanzó a calcular 2 filas de 68. |
| Remises | Con turno hoy · **0** | `remises_asistencia` no recibe una fila desde el **28/07**: diez semanas. |
| Producción | Partes sin cargar (7 d) · **14** | `produccion_partes` tiene **0 filas**. Dice 14 desde que el módulo existe. |
| Facturación | Entraron hoy · **0** | Hay **2 facturas en total**. Va a decir 0 casi siempre. |
| Despacho | Órdenes de carga hoy · **0** | Es el módulo más vivo del sistema: **1.998 órdenes, 331 el último mes**. La última es del 01/10. |
| Inventario | Bajo el mínimo · **524** | De **1.161 artículos activos**. No es una cola de trabajo: es un estado estructural que nadie va a bajar. |
| Mantenimiento | Órdenes atrasadas · **20** | ✔ vivo y accionable. |
| Compras | Requerimientos en curso · **118** | ✔ vivo y accionable. |
| Taller Vial | Cargas sin equipo · **3** | ✔ accionable. |
| Calidad | *sin tarjeta* | 1.049 movimientos de carbonilla y 1.404 de envases. Quien sólo tiene Calidad entra al Inicio y ve una grilla vacía — ni siquiera el cartel de "no tenés acceso", porque `modulos.length` no es 0. |
| Trituración | *sin tarjeta* | 174 partes, **ninguno desde el 31/08**. Mismo problema de grilla vacía. |

Y las alarmas secundarias: `Sin llegar a la planilla` está en **0 en los tres
módulos** que la muestran, `esperandoAprobacion` en 0. Ocupan un lugar fijo en la
tarjeta para no decir nada.

### El ritmo real: todos los módulos se cargan a diario

Sobre los días con carga **de todo 2026**, el hueco entre un día y el siguiente.
(La tabla de validación de más abajo usa la ventana de **180 días** que mira la
vista, así que algún hueco máximo no coincide: el de Inventario es 5 en el año y
4 en los últimos 180 días.)

| Módulo | Días con carga | Hueco mediano | Hueco p90 | Hueco más largo | Sin cargar hoy |
|---|---|---|---|---|---|
| RRHH (`fichadas`) | 248 | 1 | 1 | 1 | **6** |
| Inventario | 215 | 1 | 2 | 5 | 1 |
| Despacho | 139 | 1 | 2 | 3 | **5** |
| Taller Vial | 221 | 1 | 2 | 3 | **8** |
| Calidad carbonilla | 230 | 1 | 2 | 3 | **20** |
| Calidad envases | 208 | 1 | 2 | 4 | **23** |
| Trituración | 84 | 1 | 1 | 3 | **36** |
| Remises | 27 | 1 | 6 | 10 | **70** |
| Producción | 0 | — | — | — | **nunca** |

**Ocho de trece fuentes están paradas ahora mismo y el Inicio no lo dice en
ningún lado.** Muestra "Órdenes de carga hoy: 0" para Despacho, que es
exactamente el mismo 0 que mostraría si todo estuviera bien.

## Lo que se decide

1. El número grande de cada tarjeta es **lo que hay que hacer**: una cola de
   trabajo que alguien puede bajar.
2. Aparte, chica, una señal de **si el módulo se está cargando**, con un umbral
   calculado sobre la historia del propio módulo.
3. Se agregan las tarjetas de **Calidad** y **Trituración**.
4. Se parte la ruta en dos, porque hoy la cara cara corre en cada página.

## 1. La señal de ritmo: una vista en la base

Una vista `inicio_ritmo_modulos`, una fila por fuente, que calcula contra la
historia de esa misma fuente:

```
umbral   = max(3, min(hueco_más_largo_de_los_últimos_180_días + 1, 30))
atrasado = días_sin_cargar >= umbral
```

### Por qué el hueco máximo y no el p90

Se probaron las dos. Con `p90 × 3`, que es la forma obvia, **se escapa
Despacho**: lleva 5 días parado cuando su hueco más largo de todo el año fue de
3, y el umbral le daría 6. El hueco máximo propio es el que separa bien.

Validada contra la historia real, la regla avisa en los ocho módulos parados y
se queda callada en los cinco que están al día, sin un falso positivo:

| Módulo | Sin cargar | Hueco máx | Umbral | ¿Avisa? |
|---|---|---|---|---|
| Mantenimiento | 1 | 5 | 6 | no ✔ |
| Compras | 1 | 5 | 6 | no ✔ |
| Inventario | 1 | 4 | 5 | no ✔ |
| Cantera | 5 | 6 | 7 | no ✔ |
| Facturación | 4 | 22 | 23 | no ✔ |
| RRHH | 6 | 1 | 3 | **sí** |
| Despacho | 5 | 3 | 4 | **sí** |
| Taller Vial | 8 | 3 | 4 | **sí** |
| Calidad carbonilla | 20 | 3 | 4 | **sí** |
| Calidad envases | 23 | 3 | 4 | **sí** |
| Trituración | 36 | 3 | 4 | **sí** |
| Remises | 70 | 10 | 11 | **sí** |
| Producción | nunca | — | 3 (piso) | **sí** |

Facturación es la prueba de que calibrar solo vale la pena: tiene un hueco
histórico de 22 días porque recién arranca, así que a los 4 días no grita. Un
umbral fijo de 7 la habría hecho sonar todos los días desde que existe.

### Las fuentes

La fuente de cada módulo es **lo que carga una persona**, no un derivado:

| Módulo | Fuente | Columna |
|---|---|---|
| `rrhh` | `fichadas` | `fecha` |
| `remises` | `remises_asistencia` | `fecha` |
| `mantenimiento` | `ordenes_trabajo` | `fecha` |
| `compras` | `compras_requerimientos` | `(fecha at time zone 'UTC')::date` |
| `inventario` | `inventario_movimientos` | `fecha` |
| `produccion` | `produccion_partes` | `fecha` |
| `despacho` | `despacho_ordenes_carga` | `fecha` |
| `facturacion` | `facturas_proveedor` | `(created_at at time zone 'America/Argentina/Buenos_Aires')::date` |
| `cantera` | `cantera_pesadas` | `fecha` |
| `calidad` | `calidad_movimientos` | `fecha` |
| `calidad_envases` | `calidad_envases_movimientos` | `fecha` |
| `taller_vial` | `taller_vial_cargas` | `fecha` |
| `trituracion` | `trituracion_partes` | `fecha` |

Dos elecciones que no son obvias:

- **RRHH mira `fichadas`, no `calculos_diarios`.** El cálculo sigue escribiendo
  filas aunque nadie fiche —hoy tiene filas hasta el 18/11— así que mirándolo a
  él, RRHH parecería estar al día mientras marca 66 de 68 empleados ausentes por
  un archivo que dejó de importarse. Es exactamente el error que este indicador
  tiene que atrapar; si mira el derivado, lo tapa.
- **Facturación mira `created_at`, no `fecha`.** `fecha` es la fecha del
  comprobante, que puede ser vieja; `created_at` es cuándo entró al buzón, que es
  lo que mide si el módulo se usa.
- **Cantera mira sólo `cantera_pesadas`.** El módulo carga en cinco tablas
  —voladuras, bochones, destape, acarreos y pesadas— pero las pesadas son lo
  único que se carga a diario; las otras cuatro se mueven por evento y un hueco
  de dos semanas en voladuras es normal. Si alguna vez se dejaran de cargar las
  pesadas pero sí el resto, esta señal mentiría: queda anotado.

Son **trece fuentes para doce módulos**: Calidad tiene dos mitades que se cargan
por separado, y la tarjeta muestra **la peor de las dos**.

### Las seis trampas, que van comentadas en la migración

- **Acotar a `fecha <= current_date`.** `calculos_diarios` tiene filas hasta el
  18/11 y nada impide que otra tabla las tenga. Sin el tope, `días_sin_cargar`
  sale negativo y el módulo parece recién cargado.
- **Un módulo sin ninguna fila no está al día.** Producción no aparecería en la
  vista: con un `inner join` quedaría fuera y la tarjeta diría que todo bien. La
  lista de módulos va del lado izquierdo de un `left join`, y sin filas ⇒
  atrasado.
- **El tope de 30.** Sin él, un parate largo —las vacaciones de enero— le sube el
  umbral al módulo y lo deja mudo durante los 180 días siguientes.
- **El piso de 3.** Sin él, un módulo con dos días de historia tiene hueco máximo
  0, umbral 1, y grita cada fin de semana.
- **La última fecha no sale de la ventana de 180 días.** La ventana es sólo para
  el hueco máximo, que es lo único que tiene sentido que sea móvil. Si
  `ultima_fecha` se calculara sobre ella, un módulo parado hace más de medio año
  pasaría a informarse como «nunca se cargó» —Remises, con 70 días hoy, lo haría
  al día 181—: falso, y además pierde cuántos días lleva parado. Con la historia
  entera, `ultima_fecha is null` significa que la fuente no tuvo nunca una fila.
- **Dos fuentes no son `date`, y llevan husos distintos a propósito.** Sin ningún
  cast, el `union all` resuelve toda la columna `fecha` a `timestamptz` y la
  migración falla al aplicarse con `42846` (`max(hueco)::int` sobre un
  `interval`): ése es el motivo del cast. `compras_requerimientos.fecha` es un
  **día** guardado en un `timestamptz` —2.080 de 2.080 filas a medianoche UTC
  exacta— y se recupera con `at time zone 'UTC'`; con el huso de Argentina las
  2.080 fechas se correrían un día para atrás. `facturas_proveedor.created_at`
  es un **instante** real y va con el huso de Argentina, porque lo que importa
  es el día argentino en que entró la factura al buzón.

### La vista

```sql
create or replace view inicio_ritmo_modulos
with (security_invoker = true) as
with fuentes as (
             select 'rrhh'::text      as modulo, fecha              from fichadas
  union all  select 'remises',             fecha                    from remises_asistencia
  union all  select 'mantenimiento',       fecha                    from ordenes_trabajo
  union all  select 'compras',             (fecha at time zone 'UTC')::date from compras_requerimientos
  union all  select 'inventario',          fecha                    from inventario_movimientos
  union all  select 'produccion',          fecha                    from produccion_partes
  union all  select 'despacho',            fecha                    from despacho_ordenes_carga
  union all  select 'facturacion',         (created_at at time zone 'America/Argentina/Buenos_Aires')::date from facturas_proveedor
  union all  select 'cantera',             fecha                    from cantera_pesadas
  union all  select 'calidad',             fecha                    from calidad_movimientos
  union all  select 'calidad_envases',     fecha                    from calidad_envases_movimientos
  union all  select 'taller_vial',         fecha                    from taller_vial_cargas
  union all  select 'trituracion',         fecha                    from trituracion_partes
),
-- Sólo para el hueco máximo: los últimos 180 días. NO alimenta `ultima`.
dias as (
  select modulo, fecha
    from fuentes
   where fecha is not null
     and fecha <= current_date
     and fecha >= current_date - 180
   group by modulo, fecha
),
huecos as (
  select modulo, fecha - lag(fecha) over (partition by modulo order by fecha) as hueco
    from dias
),
hueco_max as (
  select modulo, max(hueco)::int as hueco_max from huecos where hueco is not null group by modulo
),
-- Toda la historia, acotada sólo a `<= current_date`: ver la quinta trampa.
ultima as (
  select modulo, max(fecha) as ultima_fecha
    from fuentes
   where fecha is not null
     and fecha <= current_date
   group by modulo
)
select m.modulo,
       u.ultima_fecha,
       (current_date - u.ultima_fecha)::int                        as dias_sin_cargar,
       coalesce(h.hueco_max, 0)                                    as hueco_max
  from (values ('rrhh'),('remises'),('mantenimiento'),('compras'),('inventario'),
               ('produccion'),('despacho'),('facturacion'),('cantera'),('calidad'),
               ('calidad_envases'),('taller_vial'),('trituracion')) as m(modulo)
  left join ultima    u on u.modulo = m.modulo
  left join hueco_max h on h.modulo = m.modulo;
```

`atrasado` **no se calcula en la vista**: la comparación vive en
`lib/home/ritmo.ts`, que es donde se puede testear. La vista entrega los hechos
—última fecha, días, hueco máximo— y la decisión es código puro. El umbral
tampoco se calcula en la vista: vive en `umbralDeRitmo`, y tenerlo en dos lados
sería dos fuentes de verdad para la misma fórmula.

`security_invoker = true` porque una vista en Postgres corre por defecto con los
permisos de quien la creó y **saltearía el RLS de las trece tablas**. Con
`security_invoker`, a quien no tiene acceso a un módulo le llegan nulos en esa
fila — que es lo correcto, porque la tarjeta tampoco se le muestra.

**Costo: una consulta para los trece**, resuelta en Postgres.

## 2. Los titulares

| Módulo | Antes | Ahora | Medido hoy |
|---|---|---|---|
| RRHH | Ausentes hoy · 1 | **Ausentes del último día hábil con fichadas** | 7, del mié 30/09 |
| Remises | Con turno hoy · 0 | **Días sin cargar** (no tiene cola real) | 70 |
| Mantenimiento | Órdenes atrasadas | *se queda* | 20 |
| Compras | Requerimientos en curso | *se queda* | 118 |
| Inventario | Bajo el mínimo | *se queda* | 524 |
| Producción | Partes sin cargar (7 d) | *se queda* | 14 de 14 |
| Despacho | Órdenes de carga hoy · 0 | **Órdenes sin cerrar** | 0 |
| Facturación | Entraron hoy · 0 | **Sin vincular a una compra** | 1 |
| Cantera | Facturas a conciliar | *se queda* | (no medido) |
| **Calidad** | *sin tarjeta* | **Envases bajo el mínimo** | 3 de 28 |
| Taller Vial | Cargas sin equipo | *se queda* | 3 |
| **Trituración** | *sin tarjeta* | **Partes sin exportar a la planilla** | 2 |

### RRHH: los ausentes del último día hábil con fichadas

El titular de RRHH no es una cola de trabajo sino un estado del día, y es una
excepción deliberada a la regla de arriba: es lo que se mira a la mañana. Pero
«hoy» no sirve y «ayer» tampoco alcanza. La regla es **el último día anterior a
hoy que sea hábil y tenga fichadas importadas**, y el rótulo nombra ese día:
*«Ausentes el mié 30/09»*.

Las tres condiciones salen de tres mediciones, no de suponer.

**Hoy no sirve.** El 06/10 a media mañana `calculos_diarios` tenía **2 filas de
68**: el día no está cerrado. Por eso la tarjeta decía «1 ausente» mientras el
día anterior había 66.

**Los domingos no cuentan.** De 35 domingos de 2026, los **35** tienen
exactamente 0 ausentes sobre 68 empleados. No es que no haya datos —las 68 filas
están calculadas— es que nadie está ausente un domingo. Un lunes, «ayer» diría 0
y no informaría nada. **El sábado sí cuenta**: tiene entre 4 y 9 ausentes todos
los sábados, así que «día hábil» acá es *no domingo y no feriado*, no la semana
de lunes a viernes.

**Los feriados tampoco.** De los 11 feriados de 2026 con datos, **9 tienen 0
ausentes**, igual que un domingo; los otros dos tienen 2 y 4 —gente que sí
trabajaba ese día—. Promedio 0,5 contra 42,3 en días hábiles. Se usa la tabla
`feriados` del núcleo, que tiene los 16 feriados nacionales de 2026 cargados.

**Y el día tiene que tener fichadas**, que es la condición que más importa:

| Mes de 2026 | Ausentes promedio (de 68) | Fichadas importadas |
|---|---|---|
| Febrero a junio | **65** | **0** |
| Julio a septiembre | 6,1 · 6,8 · 6,7 | ~1.550 por mes |
| Octubre | **49** | **0** |

**La importación de fichadas funcionó tres meses de nueve.** Cuando no entra
ninguna, `calculos_diarios` llena igual las 68 filas y marca a todos ausentes:
el sistema tiene cinco meses de ausencias falsas guardadas, y otro tramo abierto
desde el 01/10. Si la tarjeta mostrara el día hábil anterior sin más, hoy diría
**66 de 68**, que es ruido del feed y no un dato de RRHH.

Retrocediendo hasta el último día hábil con fichadas, hoy muestra **7 ausentes
del miércoles 30/09** — verdadero, con la fecha a la vista, y con la señal de
ritmo al lado avisando que esa fecha tiene seis días. El número grande nunca es
inventado.

La consulta es barata: la última fecha de `fichadas` anterior a hoy que no sea
domingo ni esté en `feriados`, y después el conteo de ausentes de ese día.

### Lo que se midió y se descartó

- **Inventario cruzado con Compras.** La idea era mostrar los artículos bajo el
  mínimo que **todavía no se pidieron**, que sí sería una cola. Se midió: de los
  524, sólo **30** tienen un requerimiento abierto. El cruce da 494 contra 524 —
  agrega una consulta y un `join` por código de texto para mover el número un 6%.
  Se descarta; queda 524, que es honesto aunque no sea accionable, y la señal de
  ritmo es la que lleva la información útil de ese módulo.
- **La bandeja de Odoo de Calidad** (`calidad_odoo_sin_reconocer`) está vacía, así
  que no sirve de titular. El stock de envases bajo el mínimo —3 de 28— sí es una
  cola corta y accionable.

### Lo que se saca

Las tres secundarias `Sin llegar a la planilla` (Inventario, Producción,
Despacho), **las tres en 0**. El caso que cubren sigue vivo como notificación de
la campana, que es donde corresponde: aparece cuando pasa y no ocupa lugar
cuando no.

Y las secundarias de volumen de **Cantera** (toneladas voladas, acarreo a pagar
del mes) y **Taller Vial** (litros del mes, equipos con carga). Son las que
obligan a traer `cantera_voladuras`, `cantera_consumos`, `cantera_acarreos`,
`cantera_pesadas`, `cantera_tarifas_acarreo`, las 789 cargas de combustible y
todos los services **enteros**, para calcular en memoria dos números que ya están
en la página de inicio de cada módulo, a un clic. El Inicio queda con lo
accionable y la señal de ritmo.

## 3. Rendimiento: el problema no estaba en el Inicio

`NotificationsBell` vive en el **layout**, así que `/api/home/resumen` —con los
pulls completos de Cantera y Taller Vial— corre en **toda página del sistema**,
no sólo en el Inicio. Y en el Inicio corre **dos veces**, porque la página lo
pide por su cuenta.

La campana sólo usa `data.notificaciones`, que son todas consultas de contar
filas. Se parte en dos rutas:

- **`GET /api/home/avisos`** — sólo las notificaciones. Consultas `count … head`
  y una lectura de la vista de ritmo. Es la que consume el layout.
- **`GET /api/home/resumen`** — los números de las tarjetas. Sólo el Inicio.

Las dos comparten el armado de notificaciones, que se saca de la ruta a
`lib/home/avisos.ts` para poder testearlo.

## 4. Dónde avisa la señal de ritmo

- **En la tarjeta, siempre que esté atrasado**: una línea chica, *«Hace 36 días
  que no se carga»*, o *«Nunca se cargó»* cuando no hay ninguna fila.
- **En la campana, sólo cuando pasa el doble del umbral.** Así Despacho con 5
  días no hace ruido y Trituración con 36 sí. Hoy entrarían siete: RRHH (6,
  umbral 3), Taller Vial (8, umbral 4), Calidad carbonilla (20), Calidad envases
  (23), Trituración (36), Remises (70) y Producción (nunca). RRHH y Taller Vial
  caen justo en el borde.

### La trampa del descarte

`filtrarDescartadas` vuelve a mostrar una notificación cuando su `cantidad`
superó a la que tenía al descartarla. Si la cantidad de un aviso de ritmo fueran
los días sin cargar, **descartarlo lo traería de vuelta al día siguiente, todos
los días**: el número crece solo.

La cantidad de un aviso de ritmo es `floor(días_sin_cargar / umbral)`: cuántos
umbrales enteros lleva parado. Descartar Trituración hoy (36 días, umbral 4 ⇒ 9)
la calla hasta los 40 días. Y un módulo que **nunca** se cargó manda `cantidad:
1` fijo, así que descartarlo lo calla para siempre — "Producción nunca se cargó"
no es novedad todos los días.

## Qué se testea

Vitest sobre funciones puras, en `lib/home/ritmo.ts` y `lib/home/avisos.ts`:

- `umbralDeRitmo(huecoMax)` — el piso de 3 y el tope de 30, y los casos de la
  tabla de validación.
- `estaAtrasado(diasSinCargar, umbral)`, incluido el caso `ultimaFecha === null`.
- `ritmoDeFila(fila)` — el ritmo de una sola fuente, con el umbral de su propio
  hueco; incluido el caso de una fuente que nunca se cargó.
- `ritmoPorModulo(filas)` — las trece fuentes contra los doce módulos, y que
  Calidad se quede con la peor de sus dos mitades.
- `cantidadDelAviso(diasSinCargar, umbral, nuncaSeCargo)` — la del descarte, con
  el caso de que descartarlo hoy no lo traiga mañana.
- `avisosDeRitmo(ritmo, modulosDelUsuario)` — que sólo salgan los módulos a los
  que el usuario tiene acceso, y sólo pasado el doble del umbral.
- `ultimoDiaHabilConFichadas(fechasDeFichadas, feriados, hoy)` en
  `lib/rrhh/diaHabil.ts` — que saltee domingos, feriados y días sin fichadas;
  que **no** saltee sábados; y el caso de hoy (06/10 ⇒ 30/09, salteando cuatro
  días hábiles sin fichadas). Es la función que impide que la tarjeta muestre
  un 66 falso, así que es la que más vale testear.

La vista no se testea con vitest: se verifica corriéndola contra la base y
comparando con la tabla de validación de arriba, que se midió con el mismo
criterio en `scripts/`.

## Riesgos asumidos

- **El umbral se adapta a lo malo también.** Si un módulo se deja de cargar
  tres semanas y después se retoma, su hueco máximo pasa a 21 y durante los 180
  días siguientes tolera parates de tres semanas sin avisar. El tope de 30 acota
  el daño; la alternativa —un umbral fijo— hace ruido en Facturación desde el día
  uno. Se prefiere errar por callado en un módulo que ya demostró que trabaja a
  ráfagas.
- **El Inicio va a abrir con ocho módulos en rojo.** No es un defecto del
  indicador: es el estado real del sistema hoy, que hasta ahora no se veía. Vale
  la pena decirlo antes de desplegarlo para que no parezca un error.
- **Un día con fichadas parciales cuenta como día con fichadas.** Si una
  importación trae 8 fichadas de 68, ese día califica y la tarjeta mostraría ~60
  ausentes falsos. No se pone un umbral de completitud porque no hay forma
  medida de distinguir «importación a medias» de «día con poca gente»: los
  domingos tienen entre 8 y 20 fichadas legítimas. Queda anotado; si pasa, el
  arreglo es exigir que el día tenga fichadas de al menos la mitad de los
  empleados activos.
- **Excluir los feriados esconde las ausencias reales de quien sí trabajó.** Son
  2 y 4 en los dos feriados que las tuvieron. Se acepta: el otro camino —mostrar
  0 ausentes en nueve feriados de cada once— confunde más.
- **`inicio_ritmo_modulos` escanea 180 días de trece tablas.** Con los volúmenes
  de hoy (la más grande, `calculos_diarios`, no está entre las fuentes; la mayor
  es `inventario_movimientos` con 4.361) es una consulta barata, pero conviene
  medirla antes de dar la tarea por buena, y agregar índice por `fecha` donde
  falte.

## Pendiente de una persona

La vista es **DDL**, así que la migración la aplica el usuario a mano en el
editor SQL de Supabase. Hasta entonces, las tarjetas se pueden implementar y la
señal de ritmo queda sin datos — el mismo trato que hoy tiene un módulo al que no
se tiene acceso.
