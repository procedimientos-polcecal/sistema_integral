# La salud del sistema avisa sola

Diseño acordado el 05/11/2026.

## Por qué existe

El pedido fue «configurar un agente QA tester para probar el sistema ante
fallos», y la razón que lo motivó: «han aparecido problemas de conexión o algún
bug», sin saber cuáles.

Al medir contra producción apareció algo que da vuelta el encargo. **El problema
no es que nadie haya testeado: es que el sistema ya había escrito el diagnóstico
exacto y nadie lo leyó.** Medido el 05/11/2026 sobre `sincronizaciones`:

> `NEXT_PUBLIC_APP_URL no es una URL (www.polcecalpolysan.app): Google necesita
> una https completa. Quedaron sin abrir o renovar: mantenimiento@polcecal.com,
> soporte.cantera…`

Esa fila es del 04/11. La Agenda —el módulo que acaba de salir— lleva desde
entonces sin poder abrir ni renovar sus canales de Google, por un `https://` que
falta en una variable de Vercel. El código detectó la causa, la nombró con
precisión y la guardó. No hay ningún camino por el que eso llegue a una persona.

Un agente de QA que hubiera que acordarse de correr no cierra ese agujero:
lo mueve un piso más arriba. Por eso lo que se construye **avisa solo**.

## Qué ya existe, y por qué este documento es sobre todo un «generalizar»

Tres piezas están hechas y no se rehacen.

**1. El canal.** La campana del Inicio y el push diario de las 8:30 salen los dos
de `avisosDeUsuario()`, y el push dice **lo que se movió** desde el resumen
anterior, con los lunes mandando totales. Para la salud encaja exacto: «la Agenda
empezó a fallar» es movimiento, y el lunes repesca lo que lleva días roto y dejó
de moverse. No hay que construir nada de eso.

**2. La lógica de «caído», bien resuelta para dos pasos.**
[lib/agenda/avisosDeLaAgenda.ts](../../../lib/agenda/avisosDeLaAgenda.ts) ya
contesta la pregunta difícil, y lo hace con cuidado:

- `estadoDelPaso` distingue **tres formas de estar caído**: la última corrida
  falló, la última corrida es **vieja** (el cron no corrió, y entonces *no deja
  ninguna fila de fallo*: mirar sólo `ok` lo vería verde para siempre), o **nunca
  corrió**.
- `sinComprobar` es un estado aparte: **si no se pudo ni leer la salud, no es un
  0.** Sale como su propio aviso, con un título que dice que falló *la
  comprobación*.
- `lineasDeSalud` dibuja el detalle en `/agenda`, porque **los dos avisos llevan
  ahí**: un push que aterriza donde no hay rastro del problema es el bug de las
  notificaciones que no llevaban a ningún lado.
- `PASOS_CON_GOOGLE` **excluye `aviso_de_google` a propósito**, y el porqué es la
  trampa central de todo esto: esa fila se escribe **sólo cuando hay algo que
  decir**. Si la última fue un fallo, la fila queda en rojo *hasta el próximo
  fallo* —días, semanas— aunque todo ande.

Este proyecto **generaliza eso de 2 pasos a los 29 recursos**, y conserva las
cuatro decisiones de arriba. Ninguna es negociable: cada una está escrita porque
alguien ya pagó por no tenerla.

**3. La raíz del envenenamiento, ya resuelta por otra sesión.** La migración
`20261105092248_sincronizaciones_dicen_si_vienen_del_despliegue_canonico.sql`
agrega la columna `canonico` y hace que `ultima_sincronizacion` la prefiera.
**Al 05/11/2026 está escrita y NO aplicada**, y este proyecto depende de ella:
ver «Lo que tiene que pasar antes».

## Lo medido, que es lo que no se deduce del código

Todo esto se midió el 05/11/2026 contra la base de producción.

### La vista mentía para los dos lados

`ultima_sincronizacion` no distinguía de qué despliegue venía la fila, y hay un
segundo despliegue de este repo escribiendo en la misma base desde el 24/10
(CLAUDE.md, «Hay un segundo despliegue escribiendo en esta base»). Resultado en
el instante de medir:

| | |
|---|---|
| **5 alarmas falsas** | `agenda/barrido`, `produccion/molinos`, `calidad/carbonilla-planilla`, `seguridad_higiene/respaldo_fotos`, `taller_vial/cargas` — la vista decía MAL, el despliegue bueno estaba OK |
| **1 fallo real** | `calidad/carbonilla-odoo` |
| **Y tapaba al revés** | el 04/11 `agenda/canales` falló tres veces en producción mientras la vista mostraba el OK del otro |

La consecuencia que importa: **el aviso de salud de la Agenda, desplegado el
03/11, les venía sonando a los 3 `admin_sistema` por un barrido que andaba
bien.** No es un riesgo del diseño nuevo: es el diseño existente fallando por
exactamente donde este documento se preocupa.

### El umbral no puede salir del cron declarado

Los crons de GitHub Actions declaran una frecuencia y corren otra. Medido sobre
60 días, sólo corridas del despliegue bueno:

| Recurso | Declara | Corridas en 60 d | Mediana entre corridas | Hueco mayor |
|---|---|---|---|---|
| `mantenimiento/ordenes` | cada 15 min | 89 | 3,5 h | 10,2 h |
| `inventario/movimientos` | cada 15 min | 76 | 4,1 h | 10,2 h |
| `cantera/acarreo` | cada 20 min | 101 | 3,2 h | 7,9 h |
| `taller_vial/cargas` | cada 20 min | 76 | 3,9 h | 9,4 h |
| `rrhh/recalculo` | cada 6 h | 41 | 7,3 h | 13,1 h |
| `rrhh/lenox-marcaciones` | diario | 13 | 24,0 h | 24,0 h |
| `respaldo/*` (8 recursos) | **semanal** | **2** | 170 h | 170 h |

Un umbral derivado de lo declarado daría todo caído, siempre: dos ciclos de
15 minutos deja a `mantenimiento/ordenes` en rojo permanente contra una mediana
real de 3,5 h. Y uno derivado sólo de la propia historia tampoco sirve, porque
la historia de un recurso que corre poco *normaliza su propia escasez*.

Eso descarta las dos reglas automáticas y lleva a la decisión de abajo: **el
número se declara a mano**, y es directamente la tolerancia, no la cadencia.

**Y una corrección a lo que este documento decía antes.** Afirmaba que
`respaldo/*` «tiene que sonar» por haber corrido 2 veces de las ~8 esperadas.
Es falso, y vale escribir por qué para que no se reintroduzca: cada pestaña del
respaldo **se borra y se reescribe entera** en cada corrida
([docs/RESPALDO.md](../../RESPALDO.md)), así que un respaldo de hace tres días
es un respaldo válido y las corridas que faltaron en el medio no son datos
perdidos. Lo que importa ahí es **la edad de la última**, que es justo lo que
esta comprobación mide. Contar corridas sobre una ventana sería otra
comprobación, y no hace falta.

### Quién recibe

**3 `admin_sistema`** de 14 usuarios activos (10 encargados, 1 operario).

### El estado al 05/11/2026

29 recursos en la vista. Fallos vivos del despliegue bueno: **uno**,
`calidad/carbonilla-odoo`, que no puede llegar a
`polcecal-staging-39242521.dev.odoo.com` —producción apunta al Odoo de
**staging**—. Tres fallos se resolvieron solos en los últimos días
(`mantenimiento/ordenes` por `estado_raw`, `seguridad_higiene/respaldo_fotos`,
`produccion/molinos`), y conviene saberlo porque son el ejemplo de lo que **no**
tiene que sonar: un porcentaje de fallo los empata con el que sí está roto.

## Qué se construye

### 1. Un registro con una entrada por recurso

**La cadencia esperada de cada recurso se declara, no se adivina.** Es
deliberadamente la misma forma que
[scripts/revisar-exportaciones.mjs](../../../scripts/revisar-exportaciones.mjs),
y por el mismo motivo: lo valioso no es el cálculo sino **el momento en que
alguien tiene que contestar la pregunta**. Un recurso que aparece en la vista y
no está declarado es un hallazgo, no un default.

**Lo que declara cada entrada es la tolerancia en horas, no la cadencia.** O
sea: cuánto silencio es normal para ese recurso antes de que haya algo que
mirar. Se declara el número final y no una frecuencia de la que haya que
derivarlo, porque toda regla de derivación que se probó falla para alguien —dos
ciclos de 15 min deja a Mantenimiento en rojo permanente, y un múltiplo de la
mediana vuelve sano a cualquier recurso que corre poco—. El número va con **la
medición que lo justifica al lado**, que es lo que permite revisarlo después:
para `cantera/acarreo`, «24 h; en 60 días el hueco mayor fue 7,9 h».

**Tres familias de excepción, y cada una se declara con su porqué.** Esto es lo
que el revisor del diseño encontró que faltaba, y las tres ya existen en el
sistema:

| Familia | Qué quiere decir | Quién está hoy |
|---|---|---|
| `sólo-escribe-si-hay-algo` | No escribe fila cuando anda bien, así que «la última falló» queda clavado hasta el próximo fallo | `agenda/aviso_de_google` |
| `se-ve-en-otro-lado` | Su fallo ya es visible donde importa, y avisarlo aparte es decir lo mismo dos veces | `agenda/pendientes` — «es reescribir lo que no se pudo escribir, y eso ya se ve en el evento» |
| `apagado-a-propósito` | Alguien lo apagó sabiendo lo que hacía. Lleva **quién lo levanta y cuándo** | `calidad/envases_bajada`, cuyo `schedule:` está comentado desde el 21/10/2026 |

La tercera es la que más importa y la que más fácil se omite. El comentario de
`calidad-envases-bajada.yml` dice textualmente *«Se apaga igual para no dejar
una corrida en rojo todos los lunes: un fallo esperado que se ve igual que uno
real entrena a no mirar ninguno»* — es el anti-goal de este documento, escrito
por otra persona, dos semanas antes. Sin esta familia, lo primero que haría el
sistema nuevo es reintroducir exactamente lo que ese comentario evitó.

**Una entrada puede cubrir varios recursos que escribe una sola corrida.** El
cron del respaldo escribe **ocho filas por vuelta** —una por pestaña más una
del conjunto— a propósito, para poder saber cuál pestaña quedó vieja. Si cada
una fuera una entrada, un cron muerto movería el conteo de 0 a 8 y taparía todo
lo demás; y una pestaña rota se vería igual que el cron caído. La entrada
nombra el grupo, y la pantalla sigue mostrando las ocho por separado.

**`compras/planilla` es un caso aparte y conviene saberlo antes de declararlo:**
llega a la vista por la unión con `compras_sincronizaciones`, con `entorno` y
`canonico` fijos en null, así que nunca puede ser preferida como canónica —gana
por ser la única de su grupo— y su cadencia la marca un webhook y no un cron.

### 2. La comprobación, generalizada

Toma `estadoDelPaso` de la Agenda y lo aplica a los 29, con la cadencia
declarada en lugar de la constante `HORAS_SIN_CORRER = 50`.

Conserva, porque cada una ya costó:

- los tres modos de estar caído, **incluido «no corrió»**;
- `sinComprobar` como estado aparte y no como 0;
- las **tres familias de excepción** de arriba, declaradas y no inferidas.

### 3. Un aviso por recurso caído, y los de la Agenda se retiran

**Corrección a la primera versión de este documento, que decía «un aviso con el
conteo de recursos caídos», copiando la forma de los dos de la Agenda.** Esa
forma no se puede estirar a 29, y el revisor del diseño lo mostró con un caso
que rompe el objetivo principal:

> El mismo día se arregla `calidad/carbonilla-odoo` y se rompe `agenda/canales`.
> El conteo queda en 1. `filtrarDescartadas` compara `cantidad > cantidad_vista`
> y `loQueSeMovio` reporta la diferencia, así que **no suena la campana ni sale
> el push**, y el fallo nuevo es invisible.

Con dos pasos eso era tolerable; con 29 es el agujero que este proyecto viene a
cerrar, reabierto adentro del propio arreglo. El mismo mecanismo rompe por otro
lado: un fallo crónico descartado con `cantidad = 1` silencia al siguiente.

Entonces **cada recurso caído —o cada grupo, cuando una corrida escribe
varios— es su propio aviso**, con su id estable. Eso le devuelve identidad al
descarte (se silencia *ese* problema, no «la salud»), hace que un fallo nuevo
sea siempre una novedad, y deja que el título diga cuál es. `resumirParaPush`
ya sabe juntar varios en un mensaje, así que el push no se multiplica.

Y un aviso bandera aparte para «no se pudo comprobar», que sí conserva la forma
de la Agenda porque ahí sí es una sola cosa.

**Decisión mía, para que el usuario la revise:** los avisos
`agenda-pasos-caidos` y `agenda-salud-sin-comprobar` **se retiran**, y los tres
recursos de la Agenda entran al registro general cada uno por su puerta:
`canales` y `barrido` vigilados, `pendientes` en la familia
`se-ve-en-otro-lado` y `aviso_de_google` en `sólo-escribe-si-hay-algo`. Las dos
exclusiones son de la Agenda, están razonadas en `PASOS_CON_GOOGLE` y se
conservan tal cual: generalizar no es un permiso para deshacerlas.

Se retiran porque dos avisos de salud con umbrales distintos diciendo cosas
parecidas es justo lo que la campana y el push evitan al salir de una sola
función. Los ids viejos quedan huérfanos en `notificaciones_descartes`, que está
documentado como inofensivo —nunca más coinciden con nada—, y los nuevos llevan
ids nuevos: reusar uno le entregaría a quien lo había descartado un aviso ya
silenciado que nunca vio.

`lineasDeSalud` **no** se retira: sigue siendo el detalle de la Agenda en
`/agenda`.

### 4. Una pantalla donde el push aterrice

Con el estado de los 29: cuándo corrió cada uno por última vez, cuál está caído
y **con el texto del error sin traducir**. La visibilidad es la de
`admin_sistema`, igual que la tabla de auditoría.

Sin esto no se construye lo demás. El mes de notificaciones que abrían el inicio
está documentado en CLAUDE.md, y la regla que salió de ahí —«el aviso lleva a
donde se ve el problema»— es la que vuelve sostenible interrumpir a alguien.

## Goals

- Que una sincronización rota llegue a los 3 `admin_sistema` **sin que nadie se
  acuerde de mirar**, por la campana y por el push que ya existen.
- Que el aviso diga **cuál** está roto y **qué dijo el sistema**, sin traducir.
- Que un recurso nuevo entre a la vigilancia **obligando a declarar su cadencia**,
  en vez de quedar afuera en silencio.
- Que cubra los tres modos: falló, dejó de correr, nunca corrió.

## Non-goals

- **No corre las comprobaciones del código.** `npm test`, `tsc`,
  `revisar-responsive`, `revisar-exportaciones` y `npm run planillas` siguen
  siendo del CI y de la mano. La app no puede correrlas, y mezclarlas haría un
  aviso que no sabe de qué habla.
- **No abre el navegador ni prueba pantallas.** Se evaluó y el usuario eligió el
  alcance sin login: casi todo el SdG está detrás de la sesión y no hay usuario
  de prueba en `.env.local` —`ASISTENTE_TEST_EMAIL` y `ASISTENTE_TEST_PASSWORD`
  no están, que es también por qué `scripts/medir-rls.mjs` no corre hoy—.
- **No arregla la configuración.** Las tres cosas vivas al 05/11 son del usuario
  y están abajo.
- **No resuelve la concurrencia.** No hay ningún candado contra dos corridas
  simultáneas en todo el sistema; la migración `20261105092248` lo dice y lo deja
  fuera de alcance, y este documento también. Hoy lo único que separa a los dos
  despliegues es que al otro le faltan las credenciales de Google.
- **No vigila por módulo.** El usuario eligió `admin_sistema`: lo arregla quien
  toca las variables de Vercel y las credenciales, no quien usa el módulo.

## Anti-goals

Lo que haría fracasar esto aunque funcione:

- **Que suene todos los días.** De 13 personas, las dos únicas que probaron las
  notificaciones en serio tenían **los 13 avisos descartados**. Un informe de
  salud que se repite se apaga en una semana y volvemos a hoy, pero con la
  sensación de estar cubiertos. Un rojo esperado que se ve igual que uno real
  entrena a no mirar ninguno.
- **Que cuente las filas del despliegue que no es.** Es lo que ya está pasando:
  5 de 6 alarmas de la vista son falsas.
- **Que diga «todo bien» cuando no pudo mirar.** Es el único aviso del sistema
  cuyo trabajo es detectar que algo dejó de funcionar en silencio; uno que calla
  cuando no puede mirar cierra el fallo un piso más abajo y lo abre un piso más
  arriba.
- **Que el push aterrice en una pantalla muda.**

## Restricciones

- **La migración la aplica una persona a mano** en el editor SQL de Supabase.
- **`lib/core/sincronizaciones.ts`, su test y la migración `20261105092248`
  estaban sin commitear de otra sesión** al escribirse este documento. No se
  tocan: este proyecto construye encima.
- **Un aviso nuevo va a la campana y al push a la vez.** No es una campanita de
  más: es una notificación en el teléfono de alguien.
- **La `cantidad` se compara contra la foto del día anterior** (`avisos_fotos`).
  Cambiar qué cuenta un aviso sin cambiarle el id produce una novedad falsa del
  tamaño del salto. Id nuevo para conteo nuevo.
- Esto **no** es un aviso al instante: no pasa las tres condiciones de
  `avisarAQuienDecide()` —nada se frena esperando una decisión— y va al resumen
  diario, que es donde corresponde.
- `traerTodo()` para cualquier lectura que pueda crecer; PostgREST corta en 1000
  sin avisar.

## Lo que tiene que pasar antes

**Aplicar la migración `20261105092248`.** Sin ella la vista sigue envenenada y
este proyecto multiplicaría las alarmas falsas de 1 a 5. Y hay un detalle de su
propio diseño que el plan tiene que respetar: la columna **prefiere, no filtra**,
y las filas viejas tienen `canonico` en null — así que **cada recurso se cura en
su primera corrida canónica**, no al aplicar la migración. Medir la línea de base
después de que haya pasado un ciclo completo, no antes.

## Lo que queda del lado del usuario

Tres cosas de configuración que ningún código de este repo puede hacer:

1. **Apagar el segundo despliegue**, desde la cuenta de Vercel
   `soportemantenimiento-4821s-projects`. Es la defensa de verdad; la migración
   sólo arregla la pantalla.
2. **`NEXT_PUBLIC_APP_URL` con `https://`.** Es lo que tiene muerta la Agenda
   desde el 04/11.
3. **Decidir si producción debe seguir apuntando al Odoo de staging**
   (`polcecal-staging-39242521.dev.odoo.com`), que es el único fallo vivo al
   05/11.

## Lo que queda a criterio de quien planifique

- Dónde vive la pantalla. `/administracion` es el candidato natural por ser donde
  ya mira `admin_sistema`, pero no está decidido.
- Dónde vive el registro: un archivo en `lib/core/`, o uno por módulo. La tabla
  medida de arriba es la evidencia de la carga inicial, y cada entrada se escribe
  con su número medido al lado.
- Si un test comprueba que todo recurso que aparece en la vista está declarado
  —que es lo que convierte al registro en una defensa y no en una lista que se
  queda corta, igual que `botonesDeshabilitados.test.ts` saca las clases del
  propio CSS—.
- La redacción del título de cada aviso.
- Cómo se ordena la pantalla: por módulo, o por cuán caído está.

## Dos cosas sueltas que aparecieron midiendo

No son parte de este proyecto; se anotan porque se descubrieron acá y no hay otro
lugar donde queden.

- **5 de las 18 rutas de cron no están programadas en `vercel.json`**:
  `calidad-envases-sync`, `calidad-envases-bajada`, `respaldo-sheets`,
  `rrhh-recalculo` y `taller-vial-partes-sync`. Cuatro tienen su cron en GitHub
  Actions —el plan Hobby de Vercel limita cuántos se declaran, y pasarse hace
  fallar el deploy entero—; `calidad-envases-bajada` lo tiene comentado a
  propósito. Vale confirmarlo entrada por entrada al cargar el registro.
- **`.env.local` no tiene usuario de prueba** (`ASISTENTE_TEST_EMAIL` /
  `ASISTENTE_TEST_PASSWORD`), ni `CRON_SECRET`, ni claves VAPID. Por eso
  `scripts/medir-rls.mjs` no corre y `lib/asistente/consulta.test.ts` falla. Es
  lo que habría que resolver el día que se quiera el alcance con login.
