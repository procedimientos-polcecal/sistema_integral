# Avisar las novedades al instante — diseño

**Fecha:** 16/11/2026
**Estado:** propuesto
**Antecede:** [los avisos al instante](2026-10-18-avisos-al-instante-design.md)
y [el resumen que cuenta movimiento](2026-10-18-a-quien-le-avisa-el-sdg-design.md).

> **Escrito contra `origin/main`.** El árbol donde se diseñó estaba en otra rama,
> 228 commits atrás, y ahí no existen `avisosDeSalud`, `CRECE_CON_EL_DIA` ni el
> filtro por prefijo. Todo lo que este documento afirma del código se verificó
> con `git show origin/main:…`. Quien lo implemente trabaja sobre `main`.

## Qué se pide

Que cuando aparezca algo en las novedades, o cuando se cargue una ausencia,
**los usuarios reciban un push en el momento**, sin esperar al resumen de las
8:30.

## Por qué ahora se puede, y en octubre no

El portón de `lib/core/avisoAlInstante.ts` dice que avisar de todo son «diez
pushes a la mañana, la persona los silencia, y a partir de ahí el sistema no
avisa más nada». **Eso era cierto cuando el resumen contaba stocks.** Desde que
cuenta movimiento, medido sobre las 29 fotos de `avisos_fotos` (19/10 → 16/11):
**2,1 avisos suben por día**, 7,8 ítems, y 4 de 28 días no sube nada.

**Ese número es un piso y no la cifra**, y conviene saberlo antes de empezar:
`avisos_fotos` guarda una foto por día, así que un conteo que sube y baja dentro
del mismo día es invisible ahí y perfectamente visible para un cron de 15
minutos. Los `sheets_pendiente` —que suben cuando falla una exportación y bajan
cuando el reintento anda— son exactamente eso. **Lo primero que hay que hacer
después de encenderlo es volver a medir**, y el diseño deja con qué.

## Lo que esto cuesta hoy, dicho una vez

**El push llega a 2 de 16 usuarios activos.** El 12/11/2026, para la mensajería,
se midió lo mismo y se eligió el correo. Acá se pidió push a propósito: lo que
se gana es la capacidad, y que sirva depende de que la gente las prenda. **No es
un defecto del diseño y no se arregla con código.**

## Las dos puntas de la ausencia, y el correo que ya existe

- **«Alguien faltó»** ya es un aviso: `rrhh-sin-clasificar` cuenta los
  `calculos_diarios` con `ausente = true` y `justificada` en null del último día
  hábil, y las fichadas entran todas las mañanas —las del 16/11 a las 7:30—.
  Sube 10 de cada 28 días. Con el emisor de abajo se avisa solo, sin tocar nada.
- **«Se cargó una ausencia»** no es un aviso y hay que agregarlo. Llega tarde:
  medido sobre las 163 ausencias, **la mediana entre el día en que empieza y el
  día en que alguien la carga es de 33 días**; 133 se cargan con más de una
  semana de atraso y sólo 7 el mismo día o antes. Las carga siempre la misma
  persona, de a tandas: mediana 4, **una vez 105 juntas**.

**Esto no reemplaza el correo de las 15:50.** `app/api/cron/rrhh-novedades`
manda a los 12 encargados las novedades de RR.HH. del día. Son **dos públicos
distintos**, decidido el 16/11/2026: ese correo es el cierre del día para quien
maneja gente, y esto es la interrupción para quien tiene el push prendido. Los
dos quedan.

## Approaches

**Cómo llega** — decidido por el usuario:

- Correo (llega a 16 de 16, hay que armar asunto y cuerpo).
- **Sólo push** ← **elegido**. El emisor ya existe; llega a 2 de 16.

**Cómo se detecta la novedad** — mi decisión:

- **Enganchar las rutas de escritura.** Lo que la fase 2 rechazó: 21 conteos
  repartidos en 285 rutas, y cada módulo nuevo tiene que acordarse. Descartado.
- **Un cron frecuente que recalcula y compara** ← **elegido**. Reusa
  `avisosDeTodoElSistema()`, `loQueSeMovio()` y el emisor de push.
- **Realtime de Supabase.** La mitad de los avisos no son filas que aparecen
  sino conteos derivados, vistas y cruces: no hay `INSERT` al que suscribirse.
  Descartado.

**Cómo se hace «por persona» sin pagarlo dieciséis veces** — mi decisión, y es
la que decide la forma del código. Medido el 16/11/2026:

| | |
|---|---|
| La vista de ritmo sola (lo caro) | 684 ms en frío, 295 ms en caliente |
| Una pasada global de todos los conteos | 1,2 s |
| Las 16 personas como las hace el cron diario hoy | 8,7 s (544 ms c/u) |

**Los conteos son globales; lo que es por persona es el filtrado.** Así que se
hace **una pasada y se filtra dieciséis veces**, no dieciséis pasadas. Es la
salida que el encabezado del cron diario ya dejó anotada: «el día que moleste,
leer el ritmo una vez acá y pasárselo».

## Cómo funciona

### Un cron cada 15 minutos, dentro de la ventana

Una ruta nueva que, en cada corrida:

1. recalcula **una vez** `avisosDeTodoElSistema()`;
2. compara contra **`avisos_vistos`** —tabla nueva, **una fila por aviso**:
   `notificacion_id`, `cantidad`, `visto_en`— y se queda con lo que subió;
3. cuenta las ausencias creadas desde la corrida anterior;
4. **por cada persona con suscripción**, filtra esa lista por sus módulos, le
   resta sus descartes y le aplica `sinLoQueNoPuedeAtender`; si le queda algo,
   le manda **una** notificación;
5. actualiza `avisos_vistos`.

**La cadencia la decide cuánto aceptás que te interrumpan, no el costo**: con la
pasada compartida son ~1,2 s por corrida, o sea poco más de un minuto de cómputo
por día. A 15 minutos, dos avisos que suben con veinte minutos de diferencia son
dos pushes; a una hora serían uno. Que 15 entra está probado: `main` ya corre
diez crons seis veces por hora.

**`avisos_vistos` es otra tabla que `avisos_fotos` y no se mezclan.** La foto
diaria tiene una fila por aviso **y por día** y es contra la que el resumen de
los lunes calcula los totales; ésta tiene una sola fila por aviso y se pisa 56
veces al día. Usar la foto para las dos cosas rompe el delta de los lunes.

**La ventana sigue siendo 7:00–21:00** (`esHoraDeAvisar`). Nada se encola fuera
de ella y nada se pierde: `visto_en` sobrevive la noche, así que la corrida de
las 7:00 abarca lo que se movió a las 22:00.

### Para filtrar por módulo hace falta saber de qué módulo es cada aviso

Hoy esa relación es **implícita**: vive en la llamada `contarSiTiene(modulo, …)`
de `avisosDeLosModulos`, no en la definición del aviso —`AVISOS` es
`{ clave, id, titulo, href }`—. Con una sola pasada global ya no hay dónde
aplicarla, así que **se agrega un `modulo` a cada una de las 21 entradas**.

Es aditivo: no cambia qué se cuenta ni cómo, que es el non-goal de abajo. Y deja
explícito algo que hoy se deduce leyendo el call site. Los `ritmo-${m}` ya
llevan el módulo en el id; los `salud-*` son del sistema y su filtro es el de
abajo.

### A quién

A **todos los usuarios activos con suscripción**, menos tres exclusiones que ya
existen y se respetan:

- **Los que tienen lista de responsables van a su lista**, por `DE_UNA_LISTA` y
  `POR_PREFIJO` de `sinLoQueNoPuedeAtender`: aprobar compras a
  `compras_aprobadores`, los de Seguridad e Higiene a quien evalúa, y **toda la
  familia `salud-*` a `admin_sistema`** —que es lo que el usuario confirmó el
  16/11—. Mandarle «Requerimientos esperando aprobación» a quien no puede
  aprobar es el error medido que se arregló en octubre.
- **`ES_POR_PERSONA` queda afuera** y sale gratis: `avisosDeTodoElSistema()` los
  devuelve en 0 porque no recibe un `usuarioId`, y `loQueSeMovio` los saltea.
- **`CRECE_CON_EL_DIA` queda afuera**, hoy `salud-sin-comprobar`, cuya
  `cantidad` es el día como número: sin excluirlo sale una novedad falsa a las
  7:00 de cada mañana.

**`compras-por-aprobar` no entra al cron**, decidido el 16/11: ya tiene su push
al crearse el requerimiento (`lib/compras/avisoDeAprobacion.ts`) y entraría dos
veces por lo mismo.

### Los avisos de salud entran por el flanco, no por el número

La `cantidad` de un `salud-*` es **la racha de corridas fallidas**, y con diez
sincronizaciones corriendo seis veces por hora esa racha sube unas seis veces
por hora mientras el recurso esté roto. Un cron de 15 minutos la vería subir en
cada pasada: **hasta 56 pushes por día por un solo sync caído**, que es el
anti-goal de este documento. Y no es hipotético: hoy hay dos recursos así.

Así que de esta familia se avisa **el flanco**: cuando un recurso pasa de sano a
roto, una vez. Mientras siga roto no se repite. El stock sigue en la campana y
en los totales de los lunes.

### El resumen diario de movimiento se apaga

Si todo llega al instante, el push de las 8:30 repite lo mismo: compara los
mismos conteos y sale por el mismo canal.

**No se saca el cron de `vercel.json`.** `avisos-diarios` hace tres cosas y sólo
una sobra: además de mandar, **escribe `avisos_fotos` al final**, y la fecha de
esa foto es la idempotencia de los lunes (`queMandarHoy`: «si la última foto es
la de hoy, esta corrida ya pasó»). Sacarlo se llevaría los totales del lunes y
el candado contra el reenvío. Lo que se apaga es **la rama `"movimiento"`**; el
cron sigue corriendo todos los días.

Consecuencia que conviene saber: **los lunes la misma persona recibe los totales
de las 8:30 y además los deltas del cron nuevo desde las 7:00.** Es una vez por
semana y es el precio de conservar la red.

## Goals / non-goals

**Goals**

- Que una novedad llegue en minutos y no al otro día.
- Que una tanda de cargas sea una notificación y no cien.
- Que lo que decide —qué subió, a quién le toca, si es hora— sean funciones
  puras con tests.
- Que nadie reciba dos veces la misma novedad, salvo el solapamiento de los
  lunes, que está dicho arriba.

**Non-goals**

- No se toca **qué** cuenta cada aviso ni cómo. Agregarle el `modulo` a la
  definición es metadato, no un cambio de conteo.
- No se manda correo, ni se toca el de las 15:50 de RR.HH.
- No se toca el aviso al instante de las aprobaciones.
- No se avisan las bajas.

**Anti-goals**

- **Que un solo recurso roto genere 56 pushes en un día.** Es el modo de falla
  concreto de este diseño y lo que resuelve el flanco.
- Que alguien apague las notificaciones. Con 2,1 por día el margen existe, pero
  es un piso: hay que volver a medir con el cron andando.
- Que el push diga una novedad que no pasó. Un aviso al que se le cambia **qué
  cuenta** sin cambiarle el id dispara una novedad falsa del tamaño del salto.

## Lo que queda a criterio de quien lo implemente

- **Cómo se le pasa la lista ya calculada al filtrado por persona.** Hoy
  `avisosDeUsuario` recalcula; hace falta una variante que reciba los avisos
  hechos y sólo filtre. La forma —parámetro opcional, función nueva— es suya.
- La forma del texto cuando en una corrida suben varios avisos y además hay
  ausencias nuevas. La regla existente es nombrar los primeros y resumir.
- Si la hora de la última corrida va en una fila centinela de `avisos_vistos`
  —mismo patrón que `SIN_AVISOS` en `fotoDeAvisos.ts`— o sale del máximo de
  `visto_en`. **Pide migración**, o sea que la aplica una persona a mano.
- Qué pasa si una corrida falla a la mitad: lo que ya se mandó no se desmanda,
  así que conviene actualizar `avisos_vistos` sólo para lo que se pudo avisar.
- Regenerar `docs/API-MAPA.generado.md` con `npm run mapa-de-apis`.

## Lo que se construyó, y lo que se verificó

Implementado entre el 16 y el 17/11/2026, en seis commits. Las decisiones que
se tomaron mientras se escribía —y que no estaban en el diseño— quedan acá,
porque son las que un lector futuro no puede deducir del código.

### Las piezas

| | |
|---|---|
| `lib/home/moduloDelAviso.ts` | de qué módulo es un aviso, y cómo quedarse con los de alguien |
| `lib/home/novedadAlInstante.ts` | qué cuenta como novedad, con el flanco de la salud |
| `lib/home/vistazoDeAvisos.ts` | el vistazo anterior, y si hay que mandar algo |
| `lib/rrhh/ausenciasRecientes.ts` | cuántas ausencias entraron desde la corrida anterior |
| `app/api/cron/avisos-al-instante/route.ts` | la corrida, cada quince minutos |
| `supabase/migrations/20261117084425_vistazo_de_avisos.sql` | la tabla `avisos_vistos` |

### Cinco cosas que se decidieron escribiéndolo

- **Dos avisos no son de ningún módulo, y el diseño decía que los veinte lo
  eran.** `agenda-divergencias` y `mensajes-menciones-sin-leer` son
  transversales —no están en `MODULOS_ORDEN`— y son exactamente las dos de
  `ES_POR_PERSONA`, que el instantáneo saltea. Así que el campo es
  `Modulo | null` y el test del contrato afirma el invariante real: **toda
  entrada declara su módulo salvo las que son de una persona**. Lo que ese test
  no puede atrapar es un transversal nuevo al que se le olvide el módulo: pasa
  el contrato sin que nadie lo note.
- **El orden de los filtros no es intercambiable, y el diseño no lo decía.**
  Primero se filtra el **stock** de cada persona —módulos, descartes, lo que no
  puede atender— y recién después se calcula la novedad. Al revés no funciona:
  `filtrarDescartadas` compara `cantidad > cantidad_vista`, y la cantidad de
  una novedad es un delta de 3 y no el stock de 26; compararlo contra un
  descarte de 23 silenciaría todo para siempre.
- **El vistazo se guarda entero y siempre, no «sólo lo que se pudo avisar».**
  El diseño dejaba abierta esa opción y es la que no va: el vistazo es
  **global** y el push llega hoy a 2 personas de 16, así que guardar sólo lo
  avisado dejaría casi todo sin guardar y la corrida siguiente lo volvería a
  dar por nuevo. Y guardarlo aunque no se haya mandado nada es lo que hace que
  la primera corrida deje de ser la primera.
- **`ultimoVistazo` es una consulta y no dos.** `ultimaFoto` necesita dos
  porque guarda una foto por día; acá hay una fila por aviso, unas veinte en
  total, y la hora sale de cualquiera. De paso se evita el agujero que aquélla
  tuvo: una segunda consulta cuyo error se tragaba y devolvía un mapa vacío,
  indistinguible de «no había nada».
- **No hay ningún minuto libre en `vercel.json`.** El plan decía «elegir un
  minuto libre»: los diez syncs frecuentes declaran `0,10,20,…` hasta
  `9,19,…`, o sea que entre los diez cubren los sesenta minutos de la hora. Se
  eligió `11,26,41,56` para que las colisiones caigan siempre sobre las mismas
  dos —`mantenimiento-sync` y `cantera-acarreo-sync`— en vez de repartirse.

### Lo medido

- **2,10 avisos suben por día**, promedio sobre los 29 días que hay de
  `avisos_fotos` (19/10 al 17/11/2026), sacando la salud y los dos por persona.
  Máximo 5 en un día, y cuatro días con cero. **Sigue siendo un piso**: la foto
  es diaria y no ve lo que sube y baja dentro del mismo día. El número de
  verdad sólo se puede medir con el cron andando, mirando la columna
  `novedades` de la respuesta.
- **El push llega a 2 personas y 2 aparatos** de los 16 usuarios activos. Es la
  misma proporción que ya se midió para la mensajería (1 de 14), y es la razón
  por la que esto es push y no correo: se pidió push explícitamente.
- **12 ausencias cargadas en los últimos 7 días, 22 en 30**, contando por
  `created_at`. O sea que la mayoría de las 56 corridas diarias no va a tener
  ninguna. La fila más reciente tenía `fecha_desde` del 02/11 contra un
  `created_at` del 16/11: catorce días de diferencia, que es por qué se cuenta
  por una y no por la otra.
- **Una pasada global 1,2 s** contra 8,7 s de las dieciséis por separado
  (544 ms cada una), con la vista de ritmo en 295 ms en caliente e idéntica
  para todos. Es lo que vuelve barata la cadencia de quince minutos.

### Dos riesgos asumidos

- **El segundo despliegue.** El otro proyecto de Vercel que escribe en esta
  misma base programa este cron también y consume `avisos_vistos`: una novedad
  que se lleva su corrida ya no la ve la nuestra. **No se frena con
  `esLaCorridaCanonica()` a propósito** — un falso negativo ahí (falta una
  variable en Vercel) dejaría al cron callado para siempre y en silencio, que
  es peor que el problema. Es además la misma exposición que `avisos_fotos` ya
  tiene desde el resumen diario. La defensa de verdad es apagar ese despliegue.
- **Los lunes se solapa con el resumen de totales.** La misma persona recibe
  las novedades desde las 7:00 y los totales a las 8:30. Es una vez por semana
  y es el precio de conservar la red semanal.

### Lo que se comprobó en producción (18 y 19/11/2026)

Desplegado el 18/11/2026 a las 11:25 UTC, con la migración ya aplicada. Las
tres pruebas que el plan pedía, y lo que dio cada una:

- **Sin movimiento no manda nada.** Las corridas de las 11:41 y las 11:56
  dejaron las **nueve** cantidades idénticas —17, 12, 1, 12, 1, 39, 37, 3,
  15— y cero ausencias en la ventana, y `visto_en` igual avanzó de `11:41:10`
  a `11:56:10`. Que el vistazo avance aunque no se mande nada es la mitad que
  sostiene todo lo demás: sin eso la primera corrida nunca deja de ser la
  primera.
- **Una ausencia cargada llega en la corrida siguiente.** Se cargó a las
  `11:56:13.984` y el push llegó a las 12:11 UTC (9:11 de Argentina),
  diciendo «Ausencias cargadas · 1 más». **Cayó del lado correcto de un borde
  que conviene no deshacer**: la corrida de las 11:56 había capturado su hora
  a las `11:56:10.289`, tres segundos y medio antes de que la ausencia
  existiera, así que su ventana `[11:41:10, 11:56:10)` no la alcanzó y la
  siguiente la tomó una sola vez. Con la ventana cerrada arriba —que fue un
  arreglo de la revisión— el mismo hecho se habría avisado en las dos.
- **El flanco de la salud no se pudo ejercitar**, y queda dicho: no hubo
  ningún recurso caído en esos dos días. Cuando pase, lo que tiene que verse
  es **un solo push** y después silencio, aunque la racha siga subiendo seis
  veces por hora. Dos seguidos del mismo recurso apuntan al borrado del
  vistazo.

Y una cuarta que no estaba en la lista y que importa tanto como las otras:
**el resumen diario del 18/11 corrió con el código nuevo —a las 11:30 UTC, con
el deploy ya arriba— y escribió su foto igual**, diez filas, un miércoles, sin
mandar nada. O sea que la mitad que se apagó es sólo el envío: la foto que
alimenta los totales de los lunes y la idempotencia de ese cron siguen
andando. Era lo que había que comprobar antes de creer que sacar el cron de
`vercel.json` es inofensivo. No lo es.
