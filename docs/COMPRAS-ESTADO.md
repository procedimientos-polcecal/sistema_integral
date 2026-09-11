# Compras — dónde quedó y cómo seguir

Traspaso de la sesión del 20 de agosto de 2026. Para retomar sin releer todo.

## Qué es esto

El módulo Compras del SdG reemplaza la planilla de Google Sheets **PEDIDOS DE
COMPRA**. Nació como app suelta (`procedimientos-polcecal/COMPRAS`, hoy
archivada) y se portó acá para compartir el núcleo con RRHH, Mantenimiento y
Remises en vez de duplicarlo — y de paso resolver que no había créditos para un
segundo proyecto de Supabase.

Estado: **en producción, con el histórico cargado y la sincronización andando.**

- Deploy: `https://sistema-integral-one.vercel.app`
- Supabase: proyecto `sqfdqoxyqkaekxlluvpg`
- 1.846 requerimientos, 163 proveedores, 37 ubicaciones, 9 áreas
- Migraciones aplicadas: hasta la **025**. La **030** —la vista que alimenta
  los indicadores del tablero— está escrita y **todavía no aplicada**: hasta
  que se corra, el tablero muestra los cinco indicadores en cero con el
  cartel de que no pudo traer el resumen.

## El circuito, tal como funciona de verdad

```
Un área pide (formulario de Google o /mis-pedidos)
  → PENDIENTE de aprobación
  → gerencia aprueba (confirma prioridad y quién paga)  [APROBADA]
  → Compras junta presupuestos                          [EN_COMPARATIVA]
  → comparativa lista, se asigna a NICO o MAXI          [PARA_COMPRAR]
  → esa persona aprueba la compra                       [APROBADO]
  → Compras hace el pedido: fecha, proveedor, costos    [PEDIDO]
  → (seguimiento de la recepción: sin desarrollar)      [RECIBIDO]
```

Dos estados independientes, `estado_aprobacion` y `estado_compra`, porque son
decisiones de personas distintas en momentos distintos.

### Y hay un segundo circuito: las órdenes de servicio

Un requerimiento pide **materiales**; una orden de servicio pide **trabajo a un
tercero** —una reparación, una fabricación, un servicio—. Desde el 4/09/2026 su
aprobación también se hace acá:

```
Un área pide (formulario de Google, no /mis-pedidos)
  → vive en la pestaña SERVICIOS de su planilla     [POR APROBAR / vacío]
  → Compras → Aprobaciones: se decide               [APROBADO]
  → el FILTER la lleva a la pestaña de su área
  → se piden presupuestos                           [EN PROCESO (COMPARATIVA)]
  → se elige proveedor                              [ACEPTADO]
```

Tres cosas que hay que saber para no equivocarse:

- **Las tablas son de Mantenimiento**, no de Compras: `ordenes_servicio` y
  `os_comparativas`, con su propio vocabulario de estados. No son
  `compras_requerimientos` con otro nombre.
- **La lista de aprobadores es otra.** `os_aprobadores`, separada de
  `compras_aprobadores`: aprobar un servicio y aprobar un material los decide
  gente distinta. Hoy tiene sólo a Nico, y se administra en Configuración de
  Compras, al lado de la otra.
- **El seguimiento sigue siendo de Mantenimiento**, en
  `/mantenimiento/ordenes-servicio`. Acá se decide si se hace; allá se anota
  proveedor, costo y fechas.

Todo el detalle —incluida la razón por la que aprobar puede correr filas de la
planilla y cuándo el sistema se niega— está en
[MANTENIMIENTO-INTEGRACION.md](MANTENIMIENTO-INTEGRACION.md) y en
[el spec](superpowers/specs/2026-09-04-aprobar-os-desde-compras-design.md).

## Decisiones que no se deducen del código

**La planilla manda en el alta, el sistema en lo que gestiona.** Un trigger
(`compras_marcar_editado_en_app`) marca el RI apenas se lo toca acá, y desde ese
momento la importación deja de pisarlo. Está en la base y no en el código para
que no dependa de que una ruta se acuerde.

**Aprobar exige estar en la lista, sin atajos.** Es el único permiso donde ser
admin del sistema no alcanza: la planilla restringe la columna de aprobación a
ciertas cuentas y la app espeja esa misma regla. Las dos listas se mantienen a
mano porque Google no deja leer los editores de una protección desde afuera.

**Aprobar la compra ya no obliga a comparar.** Hasta el 26/08/2026, aprobar la
compra *era* elegir un presupuesto: la ruta rechazaba cualquier otra vía. Pero
hay compras que no se comparan —proveedor único, urgencia, monto menor— y la
regla dejaba trabados esos pedidos en la bandeja, que sin presupuestos no
ofrecía ninguna acción. Ahora se avisa y se aprueba igual, con el proveedor y el
costo opcionales. La contrapartida es real: el sistema ya no garantiza que una
compra con presupuestos se aprobó mirándolos. Por eso, cuando los hay, la salida
queda al pie y en segundo plano. Que no haya ninguna cotización elegida es lo
que deja constancia de que se aprobó sin comparar — de ahí también sale el
recuento, si alguna vez hace falta.

**Prioridad y quién paga nacen vacías.** Un valor por defecto es una decisión
disfrazada de dato. Las define gerencia al aprobar, y sin definirlas no se puede
aprobar. Para que "Ambas" siga siendo expresable, quién paga tiene tres estados:
`empresa_id`, o `paga_ambas`, o ninguno de los dos.

**El RI 1 no existe: era la fila plantilla.** La fila 2 del master está ahí
para que Sheets arrastre sus fórmulas al resto, y su contenido es de prueba
—descripción "dd", código "de"—. Tenía número de RI, así que el importador la
levantó como una fila más, y aprobarla desde la app encoló una escritura sobre
esas fórmulas. Desde el 26/08/2026 se la ignora en los dos sentidos y el
registro se borró de la base. Se la reconoce por el número (`RI_PLANTILLA`) y
no por la posición, para que sobreviva a que muevan filas; el riesgo inverso
—que un RI 1 legítimo quede invisible— no existe, porque la serie real arranca
en el 2.

**Las hojas `RI <ÁREA>` no son entidades.** Las 1764 filas cruzan todas contra
el master: son vistas filtradas. Acá son un filtro.

## Lo que hay que saber de la planilla

Tiene un modelo de permisos propio y la cuenta de servicio no lo puede sortear:

| Celda | Estado |
|---|---|
| Aprobación en el master (col. M) | **Se escribe.** Tiene la protección
  "APROBACIÓN DE GERENCIA", pero la cuenta de servicio pasa: verificado el
  26/08/2026, RI 1048, 1841 y 1860 |
| Estado de compra de una fila aprobada | Protegida — 841 protecciones automáticas |
| Comparativa (col. N) y estado (col. P) en las hojas por área | **Se escriben mientras alguien las mantenga.** Están protegidas —`A:N` por rango, y `P<fila>` automática al aprobar— y la cuenta de servicio figura entre los editores de casi todas, pero **no es una garantía permanente**: el script de la planilla crea las nuevas sin ella. Ver la trampa de más abajo |
| Prioridad, empresa, proveedor, costos | Se escriben sin problema |

Por eso **cada celda se escribe por separado**: con un lote único, una celda
protegida hacía fallar todo y no se guardaba tampoco lo permitido.

Los desplegables son estrictos. Hay que escribir exactamente sus valores:

- Aprobación: `APROBADA (NICO)`, `APROBADA (MAXI)`, `DENEGADA`, `EN REVISIÓN`
- Compra: `PEDIDO`, `EN PROCESO (COMPARATIVA)`, `PARA COMPRAR (NICO)`,
  `PARA COMPRAR (MAXI)`, `APROBADO`, `DENEGADO`
- Empresa: `Polcecal`, `Polysan`, `Ambas` — capitalizadas, la base las guarda en
  mayúsculas

Por eso cada aprobador tiene un **alias** (`NICO`, `MAXI`) que se carga en
`/compras/configuracion`. Sin alias la aprobación no se escribe: se avisa y
queda pendiente, en vez de meter un valor que la validación rechaza.

## Trampas que ya costaron tiempo

**Las columnas a mano del master son posicionales, y cualquier cosa que mueva
una fila las desalinea sin avisar.** `A:J` son la salida del
`QUERY(IMPORTRANGE())`; `K`, `L` y `M` —PRIORIDAD, Empresa y **Estado**— las
escribe una persona al lado, y no viajan con la fórmula. Escribir el alta en
`Respuestas de formulario 1` era mover filas todo el tiempo: Forms inserta cada
respuesta justo después de su propia última respuesta, así que la fila del alta
bajaba una posición por envío y arrastraba a todas las de abajo. Medido el
11/09/2026 en producción: la prioridad `1 SEMANA` y la empresa `Ambas` del
RI 1959 quedaron en la fila del RI 1960, y la sincronización se las importó a la
base — el RI 1960 terminó con la prioridad de otro pedido y nada lo dijo. Por eso
el alta se mudó a `Altas del sistema` y el `QUERY` ordena por N° de RI. **Regla
que queda: en el master no se inserta, no se borra y no se ordena una fila a
mano.** Vaciarla, sí.

**PostgREST corta en 1000 filas** y no avisa: `.limit(3000)` devuelve 1000. Con
1846 requerimientos eso hacía que la sincronización revirtiera aprobaciones sin
ruido. Usar siempre `traerTodo()` de `lib/core/paginado.ts`.

**Una planilla de comparativa es por artículo, no por pedido.** Acumula
cotizaciones de años para el mismo artículo, de muchos RI distintos y en su
mayoría sin etiquetar. La regla "traer las filas con la columna A vacía o de este
RI" parecía razonable y le pegó 238 presupuestos ajenos a un solo pedido, además
de estamparle ese número a 238 filas de la planilla. Sin número no significa "es
de este RI", significa "no se sabe de cuál es".

**El trigger de `editado_en_app` no distingue quién escribe.** Marcaba la fila
ante cualquier cambio de estado, proveedor o costos, y la sincronización escribe
esos mismos campos con el mismo cliente admin: la primera sincronización
congelaba el RI y la app no volvía a mirar la planilla. Corregido en la 027, que
lo distingue por `sheets_sincronizado_en`. Para saber qué se editó de verdad en
la app no sirve mirar el proveedor ni el costo —eso lo carga la sincronización—:
el marcador es el `usuario_id` del historial.

**La planilla escribe las fechas en d/m, no en m/d.** El parser suponía lo
contrario y daba vuelta el día y el mes en toda fecha cuyo día fuera 12 o menos:
el 39% de los RI. La forma de detectarlo fue la secuencia de N° de RI, que es
correlativa —los 1795 a 1811, del 11 y 12 de agosto, figuraban en noviembre y
diciembre, y el 1812, del 13, estaba bien porque 13 no puede ser un mes—.
Corregido en el parser; los datos guardados se arreglan releyendo la planilla.

**Un `.in()` con muchos ids arma una URL que PostgREST rechaza.** Filtrar por
una lista de 1000 UUID da una URL de 37 KB y la respuesta es `400`, sin decir por
qué. Y como `traerTodo()` lanza al ver el error, un Server Component que use eso
se cae entero. Cuando el conjunto puede ser grande, hay que filtrar por una
condición —el estado, la fecha— y no por la lista de ids. Ojo con razonar "esta
tabla es chica": el tablero parecía una cola de trabajo acotada y arrastra los
1767 RI del histórico.

**El valor de un enum no se puede usar en la misma transacción** en que se
agrega. Por eso las migraciones 015 y 024 tienen una sola sentencia.

**En un Server Component `cookies().set()` no hace nada.** El canje del `?code=`
de los links de correo tiene que ir en un Route Handler: `/auth/confirm`.

**`NEXT_PUBLIC_SUPABASE_URL` va sin `/rest/v1`.** La pantalla de Data API de
Supabase muestra esa URL y copiarla rompe el login con un mensaje que habla de
la clave. La app ahora la recorta sola y avisa.

**El plan Hobby de Vercel sólo admite crons diarios.** Una frecuencia mayor no
degrada el cron: hace fallar el deploy entero. Por eso la sincronización cada 15
minutos vive en un workflow de GitHub Actions
(`.github/workflows/compras-sync.yml`) que le pega al mismo endpoint con el
mismo `CRON_SECRET`. El cron de `vercel.json` queda como red de seguridad. Los
crons de Actions se atrasan cuando hay cola, así que "cada 15 minutos" es
aproximado.

**El activador "Al editar" de Apps Script no se dispara con el formulario.**
Hacen falta los dos activadores.

**`append` de Sheets no escribe después de los datos: escribe después de todo.**
Busca el final de "la tabla" y salta más allá de cualquier contenido de la hoja,
incluido el formato, las fórmulas y los desplegables que no son datos. En la
comparativa "ESPIRA SINFIN" eso mandó dos presupuestos del RI 1865 a las filas
1003 y 1004: la app decía que los había escrito, y en la planilla no aparecían
por ningún lado. Corregido el 27/08/2026: la fila se busca por la columna A
—que es la que dice si una fila tiene datos— y se escribe en un rango explícito.
Se pierde la atomicidad de `append`, y es un riesgo aceptado: entre averiguar la
fila y escribirla alguien podría agregar una a mano, pero son segundos y las
comparativas las edita una persona por vez.

**Una fila de la planilla es una cotización, no importa cómo llegó.** Al releer
una comparativa se borraban sólo las cotizaciones de origen `drive` antes de
reinsertar. Pero una cargada a mano también termina en la planilla —la app la
escribe y le guarda su `drive_fila`—, así que al releer esa misma fila entraba
de nuevo: el RI 1865 mostraba cuatro presupuestos donde había dos, con el mismo
precio, el mismo proveedor y la misma fila. Ahora se borran todas las que
apuntan a una fila de la planilla. Las cargadas sin planilla vinculada tienen
`drive_fila` nulo y se conservan. En el mismo arreglo: el borrado se llevaba
**cuál presupuesto estaba elegido**, que es lo que aprueba la compra; ahora se
guarda por fila y se restaura.

**Clasificar un error antes de reintentarlo lo vuelve permanente.** En
`escribirCelda` había un atajo: si el cuerpo de la respuesta contenía la palabra
`protected`, se devolvía "celda protegida en la planilla" y se cortaba ahí. Ese
chequeo estaba **antes** del reintento por cuota, así que cualquier rechazo cuyo
mensaje mencionara esa palabra se abandonaba sin reintentar y quedaba anotado
como un problema de permisos.

Eso costó una tarde entera el 27/08/2026: se revisaron 946 protecciones que
estaban bien y se sospechó de la cuenta de servicio, que también estaba bien. El
error nunca fue de permisos. Con el chequeo de cuota primero y el reintento con
espera, las doce escrituras pendientes pasaron sin tocar nada de la planilla.

Dos cosas quedaron de eso, y las dos valen para la próxima:

- El motivo que se guarda ahora incluye **lo que dijo Google**, no una
  traducción, y el cuerpo completo va al log del servidor. Un diagnóstico que no
  se puede distinguir de otro no es un diagnóstico.
- El mail con el que el sistema escribe se muestra en Compras -> Configuración,
  al lado de la última sincronización. Los rangos protegidos listan qué cuentas
  pueden editarlos, y si no coincide con ésa, desde la planilla todo parece en
  orden. Hay dos funciones de apoyo en
  `docs/compras-permisos-apps-script.gs`: una agrega la cuenta a las
  protecciones y la otra sólo diagnostica, sin cambiar nada.

**Y el mismo cartel también sale cuando el permiso SÍ es el problema.** El
11/09/2026 pasó la otra mitad de lo de arriba: el RI 1952 y el 1953 quedaron
trabados al pasar a "para comprar", con "celda protegida en la planilla", y esta
vez la cuenta de servicio **realmente no estaba** entre los editores de la
protección de `RI MANTENIMIENTO!P947`. Medido ese día contra la planilla real: de
las 941 protecciones de la columna Estado, **904 incluían a la cuenta y 37 no**
—filas 653, 708, 709, 854 y 947 a 950 de MANTENIMIENTO, 397, 505 y 552 a 561 de
ALMACÉN, 216 y 251 de TALLER VIAL, 66 a 70 de LABORATORIO, 63 de OTRA—. El
27/08/2026 esas mismas eran 8: **no es un incidente, es una fuga que crece**,
porque el script de la planilla crea una protección al aprobar y no le agrega la
cuenta. Se destrabó corriendo `darPermisoALaCuentaDeServicio` desde el dueño de
la planilla (`nicolaslenzetti@polcecal.com`), y el reintento del cron escribió
solo lo que había quedado pendiente.

Tres cosas quedaron de eso:

- **La solución de fondo no está en este repo.** Mientras el script de la
  planilla que crea las protecciones no haga `proteccion.addEditor(CUENTA)` al
  crearlas, esto vuelve de a poco. `darPermisoALaCuentaDeServicio` es la
  curita, y hay que correrla cada tanto.
- **Sólo el dueño de la planilla puede arreglarlo.** Para escribir en un rango
  protegido no alcanza con ser editor del documento, así que `procedimientos@`
  no puede ni corregir la celda a mano ni tocar la protección. El cartel decía
  "hay que corregirlo a mano ahí" a alguien que no podía hacerlo.
- **El cartel ahora distingue los dos casos.** Cuando Google contesta
  `protected`, `escribirCelda` le pregunta a la planilla qué protege esa celda
  y dice cuál de las tres cosas es: que la protección no incluye a la cuenta
  —y que la agrega el dueño—, que sí la incluye y entonces el rechazo viene por
  otro lado, o que ninguna protección la toca. La lógica está en
  `etiquetaSegunLaProteccion` y se prueba en `proteccionDeLaCelda.test.ts` con
  protecciones reales copiadas ese día. El truco para distinguirlas es que
  **Google no manda la lista de editores a quien no puede editar**: lo que
  decide es `requestingUserCanEdit`, no `editors`. Si falla la consulta, se
  vuelve a la etiqueta de antes: un error al diagnosticar no puede tapar el
  error que se estaba diagnosticando.

**El reintento en lote se autoinfligía un 429.** Escribir un RI cuesta unas 13
llamadas a la API de Sheets: hasta 8 escrituras —una por celda, porque un lote
entero falla si una sola celda está protegida— más 5 lecturas que son idénticas
para todos los RI de la corrida (las opciones del desplegable, los encabezados
de cada pestaña, y la columna de N° del master, que son 1885 filas cada vez).
Con doce pendientes eso daba ~156 llamadas en segundos, Google cortaba con 429 y
el reintento lo anotaba como si la planilla hubiera rechazado los cambios —el
cartel llegó a decir "la planilla los sigue rechazando", que era falso—.
Corregido el 27/08/2026: las lecturas se cachean por corrida, el 429 se
reintenta con espera y se nombra como cuota, y se escriben 5 RI por vez con un
segundo de pausa. Lo que sobra espera la próxima corrida y la pantalla lo dice.

**Cambiar un estado sin escribirlo en la planilla es una divergencia que no
avisa.** Vincular una comparativa de Drive, o cargar el primer presupuesto,
pasaba el RI a `EN_COMPARATIVA` y no llamaba a `exportarRequerimiento`. Los dos
lados quedaban diciendo cosas distintas y nada lo señalaba: `sheets_pendiente`
sólo se llena cuando una escritura **falla**, y acá no fallaba, no se intentaba.
Encima el trigger marcaba el RI como editado en la app, así que la importación
tampoco lo volvía a mirar. Cinco RI quedaron así hasta el 27/08/2026. Regla:
**toda ruta que toque `estado_compra` tiene que exportar**, y si no puede, dejar
el pendiente anotado.

**En la columna de aprobación la planilla escribe el ALIAS, no el nombre.**
Dice `NICO`, no `Nicolas Lenzetti`. El respaldo que resuelve quién aprobó
cuando el RI no tiene `aprobado_por` —que son 1810, o sea el histórico entero—
buscaba sólo por nombre y apellido, así que no acertaba nunca y la
sincronización informaba que faltaba un alias que estaba cargado. Corregido:
ahora prueba primero contra el alias. Ojo con la conclusión fácil de que "falta
un dato": había que mirar qué texto guardó cada origen.

**Una celda vacía en la fórmula del total no es neutra si multiplica.** La
fórmula que se escribe en la planilla nombra columnas, no valores, y nombraba
la cantidad con sólo existir la columna. Un presupuesto sin cantidad —que es
una cotización por monto total, y en la app vale `cantidad ?? 1`— dejaba
`=H7*I7*...` con la I vacía: cero. La app mostraba 1210 y la planilla escribía
0, y en una comparativa donde gana el más barato, un cero gana todas. Lo mismo
pasaba con un presupuesto en dólares sin cotización: `montoParaLaPlanilla`
vacía el unitario a propósito para no mezclar monedas, y la fórmula lo
multiplicaba igual. Ahora la cantidad se nombra sólo si tiene valor, y sin
unitario no se escribe fórmula. El IVA, el descuento y el envío sí se dejan
nombrados aunque estén vacíos: no multiplican —son ×(1+0), −0 y +0— y así la
planilla recalcula sola si después alguien los completa.

**El punto de miles se leía como decimal.** `numero()` resolvía "1.500,50"
bien —con los dos separadores, el último es el decimal— pero sin coma elegía
siempre decimal, así que **"1.500" entraba como 1,5**. En una comparativa eso
convierte al presupuesto más caro en el más barato. La planilla se lee con
valores formateados (`leerComparativa` no pide `UNFORMATTED_VALUE`, porque
necesita el texto de las celdas), así que depende del formato de miles que
tenga cada columna: puede haber cotizaciones viejas guardadas mil veces más
baratas. La regla ahora vive en `lib/core/numeroArgentino.ts`, una sola vez
para Compras y para el import de empleados de RRHH, que tenían el mismo error
por separado.

**La celda de comparativa dice "LINK" y el link está escondido detrás.** La API
de valores devuelve el texto visible, así que lo que la sincronización guardó
como dirección de la comparativa fue la palabra `LINK`: 1.905 requerimientos de
1.948. Dos efectos que se veían y que nadie relacionó con eso: la ficha ofrecía
"Ver comparativa" apuntando a `/compras/requerimientos/LINK`, y la exportación
—que escribe `comparativa_url` en la celda— borraba el link de la planilla en
los 36 RI que tenían la columna vacía, porque escribía `""`.

Corregido el 08/09/2026: la sincronización pide la grilla con el hipervínculo de
cada celda y guarda el archivo en `comparativa_drive_id`, que es de donde sale el
link. `comparativa_url` no se escribe nunca desde la sincronización —dispara el
trigger de `editado_en_app` y sacaría de la planilla a todos los RI que tienen
comparativa— y la exportación no toca la celda cuando la app no tiene nada mejor
que poner. La limpieza de los `LINK` viejos es la migración
`20260908104241`, que apaga ese trigger para poder correr el update.

**Una tanda que no descuenta lo hecho no avanza.** La vinculación en tanda de
`/compras/configuracion` procesaba 20 archivos por vez, y con `filas=1` —que es
lo que manda el botón— el filtro de pendientes dejaba pasar **todos**: cada
apretón releía los mismos veinte primeros y "quedan N planillas" no bajaba
nunca. Los 219 archivos de comparativa se terminan en once tandas; así, en
ninguna cantidad. Se veía como que la sincronización de comparativas no
funcionaba: 1.473 RI con comparativa en la planilla y 684 enlazados en el
sistema. Ahora un archivo cuyos RI están todos traídos no vuelve a leerse, y la
regla vive en `archivosPorHacer` con tests.

**El indicador del tablero contaba una cosa y el listado mostraba otra.**
`compras_resumen_por_estado` sólo cuenta lo aprobado por gerencia, y el enlace
del indicador filtraba nada más que por `estado_compra`: tocar un 19 abría una
tabla de 34 sin que nada explicara la diferencia. Ahora el enlace lleva los dos
filtros, en el mismo orden en que el listado los reescribe.

**`window.location` todavía no cambió cuando la pantalla nueva se renderiza.**
Los dos listados leían sus filtros de `window.location.search` en el
inicializador del estado, y al llegar desde un enlace eso es la URL de **donde
se venía**: Next actualiza la barra de direcciones en un `useInsertionEffect`,
después del render. Los filtros arrancaban vacíos y el efecto que sigue a los
filtros reescribía la URL sin ellos, así que el enlace del tablero llegaba
limpio y la tabla salía entera —el mismo síntoma que ya se había arreglado una
vez del lado del servidor—. Ahora la fuente es `useSearchParams`, que lee el
`canonicalUrl` del router: ése ya es el nuevo al llegar por un enlace y es el
restaurado al volver con el botón de atrás, que era el caso por el que se
miraba `window`.

**La cuota de lectura de Sheets es por minuto y por USUARIO, no por proyecto.**
Son 60 pedidos, y abrir una comparativa son dos —la cabecera y los valores—, o
sea 25 archivos por minuto y nada más. Traer las 167 comparativas pendientes con
medio segundo de pausa hizo que Google cortara 62 de ellas con 429, y el mensaje
que quedaba anotado era "no se pudo leer la planilla": otra vez un problema de
cuota disfrazado de problema de permisos. Con 2,4s por archivo y reintento con
espera pasan todas. El 503 —"the service is currently unavailable"— también se
arregla esperando; el 403 y un encabezado que no corresponde, no: reintentarlos
es gastar cuota para volver a fallar.

**El borrado y reinserción de una comparativa se llevaba cuál estaba elegido**,
y elegir un presupuesto ES aprobar la compra. La ruta de un RI lo aprendió el
27/08/2026 y guarda la elección por fila antes de reemplazar; la vinculación en
tanda había quedado sin eso, así que un pedido aprobado podía terminar con la
comparativa entera y ninguna marca de sobre qué se aprobó. Corregido el
08/09/2026 en la ruta y en el script.

**Marcar el trabajo como hecho antes de saber si salió bien lo pierde para
siempre.** La vinculación en tanda guardaba `comparativa_nombre` —que es lo que
marca la planilla como hecha— apenas abría el archivo, y recién después miraba
si tenía la forma de una comparativa. Las que no tienen columna de N° de RI se
abren bien y no dan una sola fila, así que 31 requerimientos quedaron "leídos"
con cero presupuestos y fuera de la cola: el problema se informaba en pantalla,
se cerraba el aviso y no quedaba en ninguna parte. Se vio porque los archivos
pendientes bajaron de 25 a 14 sin que los presupuestos subieran. Ahora el nombre
se guarda sólo si la planilla se pudo leer, el vínculo con el archivo se guarda
igual —es correcto y de ahí sale el link—, y la respuesta trae
`sin_forma_de_comparativa` como número aparte, porque eso no se arregla
apretando de nuevo: alguien tiene que ponerle la columna a esa planilla.

**El alta viajaba en una sola dirección, y arreglarlo no era "exportar una fila
más".** Un pedido cargado en el sistema no aparecía en la planilla. La razón está
en la forma de la planilla y no en el código: **las columnas del alta del master
son la salida de una fórmula** —`QUERY(IMPORTRANGE())` de la planilla de
respuestas del formulario de Google— y cada pestaña por área es un `FILTER` del
master. No hay dónde escribir un alta. Se escribe **una planilla más arriba**,
en `Respuestas de formulario 1`, y baja sola por las fórmulas. El mapa completo
está en el spec del 09/09/2026 y en
[COMPRAS-SINCRONIZACION.md](COMPRAS-SINCRONIZACION.md).

**Una fórmula que dice "el número de arriba más uno" no sobrevive a que Google
Forms inserte una fila. Costó un pedido.**

El N° de RI de la hoja de respuestas era una fórmula por fila,
`=IF(B{n}:B<>"",A{n-1}+1,"")`, y el sistema numeraba con `max(nro_ri)+1` sobre
la base: dos series independientes. Para que no chocaran, el alta escribía su
fila con **la misma fórmula**, así el que numeraba seguía siendo la planilla. El
09/09/2026 se escribió la fila del RI 1954 en la 1957 y se verificó que la
fórmula daba 1954. Daba bien.

**Forms inserta una fila por cada respuesta, y la inserta justo después de su
propia última respuesta**, no después de la última fila con datos. Entraron dos
respuestas: la fila del alta quedó en la 1959, su referencia `B` bajó con ella y
la referencia `A1956` —que quería decir "la de arriba"— se quedó apuntando a la
misma celda de siempre. Volvió a calcular `A1956+1` y quedaron **dos RI 1954**.
La sincronización hace `upsert` por N° de RI: colapsó los dos en uno y el pedido
que había entrado por el formulario —"Buje de goma de acoplamiento eje molino
calera", de Mantenimiento— **desapareció del sistema**. La prioridad del pedido
del sistema quedó escrita en la fila del master del otro. Se reparó a mano el
10/09/2026: se recuperó el pedido de Mantenimiento como 1954 y el del sistema
quedó como 5001.

Tres cosas que valen para la próxima:

- **Una referencia absoluta no puede significar "la de arriba"** en una hoja
  donde alguien inserta filas. Ni nuestras filas ni las de Forms.
- **La verificación en el momento de escribir no alcanza** cuando el daño lo
  hace algo que pasa después. Se leyó el número de vuelta y estaba bien; se
  rompió media hora más tarde.
- **El riesgo estaba mal medido en el spec**: decía que la ventana era "el mismo
  instante", y era *hasta la próxima respuesta del formulario*.

Cómo quedó: el sistema numera y escribe el número **como valor**, y la planilla
numera lo suyo con su Apps Script (`max(A)+1`, contando también las filas del
sistema) en vez de con la fórmula. Los dos cuentan lo mismo, ninguno depende de
dónde inserta el otro, y la serie sigue siendo una sola. El script está en
`docs/compras-formulario-apps-script.gs` y **hay que instalarlo**: sin él, las
respuestas del formulario siguen numerándose por fórmula.

**Y un pedido cargado en el sistema no avisa por mail solo.** El aviso lo manda
un activador de *envío de formulario*, y una fila escrita por la API no dispara
ningún activador —*"Script executions and API requests don't cause triggers to
run"*, sin más excepción que `Form.submitGrades()`—. Enviar el formulario de
verdad tampoco sirve: tiene subida de archivo y correo verificado, y las dos
piden iniciar sesión. La salida es un **activador por tiempo** que barre las
filas con la columna `M` vacía y les fabrica el evento al mismo notificador —`M`
la escribe él justo antes de mandar el mail, así que ya es el marcador de "a
quién le avisé"—. Está en `docs/compras-aviso-por-tiempo.gs`, también para
instalar a mano, y sirve además para la respuesta del formulario cuyo aviso
falló. Las tres cosas que hay que saber antes de tocarlo: está **acotado por
fecha** (sin eso, la primera corrida avisa de un pedido de agosto de 2025), el
que **falla escribe el motivo en `M`** para dejar de reintentarse, y si el
notificador vuelve sin escribir `M` **la marca la escribe el barrido** — sin esa
red, una fila sin marcar recibe un mail cada diez minutos, para siempre, y eso
no se descubre leyendo el código sino cuando alguien se queja.

**Lo esperable y lo que hay que mirar son dos cosas distintas, y mezclarlas
enseña a ignorar los carteles.** `IMPORTRANGE` refresca cuando Google quiere
—minutos, y no se puede forzar—, así que cuando el alta acaba de escribirse la
fila del master **todavía no existe**. Eso no es un fallo: es la mitad de la
operación que va a completar el reintento. Por eso `ResultadoAlta` tiene
`pendiente` (la cola) y `avisar` (la persona) separados, y `ResultadoExportacion`
tiene `enEspera` además de `bloqueadas`. Antes, ese caso caía en `bloqueadas` y
las cuatro rutas que lo consumen le decían a quien cargó un presupuesto "hay que
corregirlo a mano ahí" por algo que se corrige solo, y atribuido al campo
equivocado. Un cartel que aparece siempre no lo lee nadie.

**Guardar la cuenta en vez del hecho hace que el reintento escriba a ciegas.**
El alta guardaba `sheets_fila = fila − 2` del master —una cuenta— y el atajo de
`exportarRequerimiento` la usa sin verificar la columna A. Escribir prioridad en
una fila que nadie comprobó es ponerle la prioridad de este pedido a otro. Ahora
se guarda **la hoja y la fila que de verdad se escribieron**, con el número
leído de vuelta, y el atajo no aplica: la fila del master se resuelve
buscándola. En la misma pasada, el bloque de las columnas de compra dejó de
entrar con "cualquier cosa que no sea el master" y exige una pestaña de área de
verdad (`esPestanaDeArea`) — si no, habría escrito proveedor, estado y costos en
las columnas N a R de la hoja de respuestas del formulario.

**El orden importa: primero encolar, después llamar a Google.** El POST del alta
hace ocho llamadas a Google, y si la plataforma mata la función después del
`insert` y antes de anotar el pendiente, el pedido queda creado con la cola
vacía: invisible para el reintento, invisible en Configuración, y con un cartel
que le dice a quien lo cargó que no se guardó —así que lo carga de nuevo y
quedan dos—. Ahora el registro **nace encolado** (`ALTA_SIN_ESCRIBIR`) y la
exportación es la que limpia esa marca. Muera donde muera, el pedido queda en la
cola. Y el alta es **idempotente**: si ya hay una fila con ese N° de RI no
escribe otra, y si la fila con ese número no es la suya —la reconoce por la
marca temporal— no la adopta, porque adoptarla dejaría el pedido apuntando a la
fila de otro.

**"No está configurado" no es "salió bien".** Sin
`GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID`, la exportación del alta no corre. El
criterio del módulo para las variables que faltan es omitir sin error, pero acá
omitir **limpiaba la cola** en la que el pedido acababa de entrar: cada alta se
salteaba la planilla en silencio. Ahora queda pendiente con el nombre de la
variable en el motivo. Cuesta un pendiente por alta en un despliegue que a
propósito no espeje el formulario, y es el precio de no poder distinguir "no lo
configuraron" de "se configuró mal".

**Las nueve pestañas por área están a ~54 filas de su techo, y cuando se pase
no avisa.** Medido el 10/09/2026: la grilla de `Requerimientos internos` tiene
2011 filas y la última con datos es la 1957; los nueve `FILTER` de las pestañas
tienen el rango fijado en `M2:M2011`; y `RI MANTENIMIENTO` tiene 945 filas
usadas de 1000. Cuando se pasen, un RI aprobado **deja de aparecer en su
pestaña sin ningún error**, o el `FILTER` se cae entero y se van de golpe 945
filas con todo lo que hay escrito a mano en `M:R`. Hay que ampliar la grilla del
master y actualizar el rango de los nueve `FILTER`. El spec del alta decía que
el techo estaba a ~8.000 pedidos: eso es el techo del `QUERY` del master
(`A4:L10000`), no el de las pestañas, que es el que muerde primero.

**El catálogo de Odoo no son SKUs, son rubros.** 432 productos, 378 comprables,
todos compartidos entre las dos empresas y sólo 51 con código: `GUANTES`,
`CABLES`, `BUJES`. Emparejar por código no sirve; emparejar por nombre sí, pero
sólo con la regla de la cabeza —la primera palabra significativa de la
descripción tiene que ser la primera del producto—. Un prototipo que puntuaba
por cobertura del nombre daba `Guantes de grasa → GRASAS` y `MASCARILLA CON
VÁLVULA → VÁLVULAS`: fallaba **con confianza**, que es lo peor, porque un
producto equivocado no se nota —la descripción igual va en el texto de la
línea— y lo único que queda mal es la cuenta contable.

Por lo mismo **no se aceptan los emparejamientos parciales**: medido sobre 300
requerimientos, esa franja son 29 y está mayormente mal (`Llave combinada fija
13mm` → `LLAVE DE IMPACTO`, `Bolsas de cal Moreno` → `BOLSAS CAL GÜEMES`, que es
otra marca). Se prefiere `ART. VARIOS` y que Compras elija. Medido contra los
1957 requerimientos reales de Compras y los 378 comprables del catálogo: 1139
(58%) con sugerencia y 818 (42%) van a `ART. VARIOS` — eso es lo que va llenando
`compras_producto_odoo`, la tabla de lo aprendido, con el uso. El razonamiento
completo y los números vigentes están en el docstring de
`lib/compras/productoOdoo.ts`.

**La orden de compra se confirma y su PDF se baja del sistema.** Las dos cosas
son de la ficha del RI, al lado del número de orden. Lo que costó averiguar es
que el PDF **no se puede pedir por donde parece**: `_render_qweb_pdf` es
privado, `render_qweb_pdf` no existe en la 17, `mail.template.generate_email`
tampoco, y `/web/session/authenticate` con la API key devuelve `AccessDenied`
sin cookie —las API keys de Odoo tienen alcance `rpc` y **no abren sesión
web**, que es lo único que habilita el endpoint de reportes—. Se consigue por
el compositor de correo, que al crearse renderiza el reporte como
`ir.attachment`; se lee y se borra. Es el PDF oficial, el mismo de *Imprimir →
Orden de compra*, y no manda ningún correo. Está en `lib/odoo/pdfDeOrden.ts`, y
el detalle —que sirve para cualquier reporte de Odoo— en
[ODOO-INTEGRACION.md](ODOO-INTEGRACION.md).

**Confirmar es un botón y no pasa solo al generar la orden.** Primero se hizo
automático y se cambió: `button_confirm` crea el remito de entrada —medido,
`Polys/IN/00176`— y deja la orden sin poder editarse ni borrarse en Odoo, sólo
cancelarse. Eso lo decide quien compra, no el hecho de pasar un RI a *pedido*.
El botón aparece sólo cuando confirmar tiene sentido, y eso no es "no está
confirmada": una cancelada no se reconfirma y una en `to approve` tampoco,
porque ahí Odoo pide la aprobación de otra persona. El estado **se le pregunta
a Odoo** cada vez —guardarlo de este lado sería una copia que empieza a mentir
el primer día que alguien la confirme allá— y lo pregunta el navegador, para no
dejar la ficha esperando.

## Lo que hay que hacer a mano para que el alta llegue a la planilla

**El código está desplegado y no sirve solo.** Son cuatro cosas, ninguna de
agente: tres en Google y una en Vercel. Hasta que se hagan, cada alta queda en
la cola de pendientes — a propósito, para que no se omita en silencio.

1. **`GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID`** en Vercel (y en `.env.local` para
   probar desde acá), con el id de `FORM PEDIDO DE COMPRA POLCECAL - POLYSAN`:
   `1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM`. **Hay que redesplegar** para
   que tome.
2. **Editor para la cuenta de servicio** sobre esa planilla. Es otra que el
   master: tener permiso sobre `PEDIDOS DE COMPRA` no alcanza.
3. **Crear la pestaña `Altas del sistema` y reemplazar la fórmula del master**,
   que es donde ahora se escribe el alta. Son cinco pasos y **el orden importa**:
   están en la sección siguiente, que es la que manda sobre esto.
4. **Instalar `docs/compras-aviso-por-tiempo.gs`** y darle su activador por
   tiempo. Es el que manda el mail de un pedido cargado en el sistema: una fila
   escrita por la API no dispara el activador de *envío de formulario*. Sin él
   el pedido entra igual, pero **nadie se entera por correo**. Barre **las dos
   pestañas**, y esa es la parte que hay que mirar si alguna vez se toca: con la
   mudanza del alta, un barrido de una sola hoja queda ciego justo para el caso
   que lo motivó. Antes de crearle el activador, correr
   `revisarPendientesDeAviso()`, que no manda nada y dice a quién le llegaría.

## Mudar el alta a su propia pestaña (11/09/2026) — FALTA EL PASO 2

El alta dejó de escribirse en `Respuestas de formulario 1`. El porqué está en
[COMPRAS-SINCRONIZACION.md](COMPRAS-SINCRONIZACION.md); el resumen es que Forms
empuja hacia abajo cualquier fila que no sea suya, y eso corría la salida del
`QUERY` del master dejando las columnas a mano —PRIORIDAD, Empresa y **Estado**,
que es la aprobación— pegadas al RI de al lado.

**Estado al 11/09/2026:** hechos los pasos 1, 4 y 5. **Falta el 2**, y el 3
dejó de hacer falta.

> **PENDIENTE Y URGENTE: volver a pegar el Apps Script (paso 2).** La fórmula
> nueva ya está puesta y el código desplegado, así que la próxima alta cae en
> `Altas del sistema`. Con la versión vieja del script —que numera contando
> sólo la hoja de respuestas— la primera respuesta del formulario que entre
> después de esa alta se lleva un número ya usado, y el `upsert` por `nro_ri` de
> la sincronización colapsa los dos pedidos en uno. Mientras la pestaña siga
> vacía no hay riesgo; desde la primera alta, sí.

**Van en este orden**, y no es capricho: el paso 2 antes que el 1 puede repartir
un número repetido.

1. ~~En `FORM PEDIDO DE COMPRA POLCECAL - POLYSAN`, crear la pestaña
   **`Altas del sistema`**~~ **HECHO.** Lleva en la fila 1 el encabezado `A1:M1`
   de `Respuestas de formulario 1` — se ubica cada columna por su nombre, y
   `DIRECCIÓN EMAIL ENVIADA` marca dónde termina lo que un alta puede llenar.
   Los datos empiezan en la fila 2: **sin filas de cebado**.
2. **Volver a pegar `docs/compras-formulario-apps-script.gs`. ← LO QUE FALTA.**
   La versión vieja numeraba contando sólo la hoja de respuestas; con la serie
   repartida en dos pestañas, eso reparte un número que el sistema ya usó y el
   `upsert` de la sincronización colapsa los dos pedidos en uno.
3. ~~Cargar un pedido de prueba antes de tocar la fórmula~~ **YA NO HACE
   FALTA.** Estaba para no exponerse a que `IMPORTRANGE` sobre la pestaña vacía
   devolviera error y rompiera el `{ ; }`. Se midió en vez de suponerlo: una
   sonda de una sola celda —`=ROWS(QUERY({...};...))` en `N1` del master, fuera
   de todo rango que alguien lea— devolvió **1966 con la pestaña vacía**, que es
   la misma cuenta que daba la fórmula vieja. También probó que los `;` del
   locale sobreviven a `USER_ENTERED` y que el segundo `IMPORTRANGE` no pide
   autorización nueva, por ser la misma planilla de origen. **Es la forma de
   probar una fórmula en producción sin arriesgar nada: una celda suelta que no
   desborda.**
4. ~~En el master, reemplazar `A2` de `Requerimientos internos`~~ **HECHO.**
   Quedó:

   ```
   =QUERY({IMPORTRANGE("https://docs.google.com/spreadsheets/d/1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM/edit"; "'Respuestas de formulario 1'!A4:L10000"); IMPORTRANGE("https://docs.google.com/spreadsheets/d/1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM/edit"; "'Altas del sistema'!A2:L10000")}; "SELECT Col1,Col2, Col5, Col6, Col7, Col8, Col9, Col10, Col11, Col12 WHERE Col1 IS NOT NULL ORDER BY Col1"; 0)
   ```

   El `ORDER BY Col1` es la mitad del arreglo: deja la salida **estrictamente
   creciente**, así que una fila nueva no puede volver a correr las de arriba.

   El `A4:L10000` de la primera parte es el que ya estaba, y pide más filas de
   las que la hoja tiene (la grilla son 1.969): eso ya funcionaba, así que el
   `A2:L10000` de la segunda tampoco es un problema.

   Verificado después de escribirla: **1967 filas, cero errores en la columna A
   y cero descensos** — el orden quedó estrictamente creciente. La fórmula
   anterior quedó respaldada por si hiciera falta volver.
5. ~~Reacomodar el RI 1959~~ **HECHO.** Su prioridad `1 SEMANA` y su empresa
   `Ambas` se movieron a la fila donde quedó el 1959.

   **Y algo que no estaba previsto: el reordenamiento dejó viejos los punteros
   `sheets_fila` de la base.** Las filas del master se corrieron una vez, y el
   atajo de `exportarRequerimiento` —cuando `hoja_origen` es el master usa
   `sheets_fila` **sin verificar la columna A**, [sheets.ts](../lib/compras/sheets.ts)—
   habría escrito la aprobación de un RI en la fila del de al lado. Eran ocho,
   del 1959 al 1966, y se corrigieron leyendo la columna A del master. La
   próxima sincronización los habría arreglado sola, pero la ventana era de
   hasta 15 minutos con aprobaciones de por medio.

   **Regla que queda: cualquier cosa que reordene el master invalida los
   `sheets_fila` guardados, y hay que refrescarlos en el momento.** No va a
   volver a pasar por esta vía —con el `ORDER BY` la salida es append-only—,
   pero sí si alguien inserta, borra u ordena una fila a mano.

### Y al mismo tiempo, el techo de 2011 filas

`Requerimientos internos` tiene la grilla en **2011 filas** y el `QUERY` va por
la 1967. Al ritmo de estos días son unos nueve días. Cuando la salida no entre,
el `QUERY` falla entero.

**El orden importa y al revés rompe las nueve pestañas por área de una:**

1. **Primero las fórmulas.** En cada pestaña por área, en `A2`, cambiar
   `'Requerimientos internos'!M2:M2011` por `M2:M`. En `RI MANTENIMIENTO`
   cambiar además `A2:L2011` por `A2:L` y `C2:C2011` por `C2:C`: ahí las tres
   están acotadas, y dejar una fija con las otras abiertas es el mismo error.
   En `APROB MAXI`, en `B2`, cambiar `A436:I2011` por `A436:I` — ésa no rompe,
   pero deja de encontrar los RI nuevos.
2. **Después la grilla.** Recién ahí agrandar `Requerimientos internos` (al
   final de la hoja, agregar unas 3.000 filas).

Al revés, `A2:L` crece con la grilla y `M2:M2011` no: `FILTER` deja de coincidir
y las nueve pestañas por área dan error juntas.

## La comprobación de punta a punta

No es de agente: escribe en la planilla de producción.

1. Cargar un pedido de prueba desde `/mis-pedidos`.
2. En `Altas del sistema`, que la fila quedó al final **de esa pestaña**, con su
   N° de RI en la columna A.
3. En el master, que aparece **en su lugar por número** —no al final— con su
   prioridad y su empresa (tarda: el `IMPORTRANGE` refresca en minutos, no al
   instante).
4. Mandar una respuesta por el formulario y confirmar que **el pedido de prueba
   no se movió** en el master. Eso es lo que se vino a arreglar y es lo único
   que lo prueba.
5. Sincronizar desde `/compras/configuracion` y confirmar contra la base que el
   pedido **sigue** con `origen = "app"`, su prioridad y su `paga_ambas`: eso es
   lo que prueba que la planilla no le pisó lo que sólo sabe el sistema.
6. Aprobarlo y ver que aparece en la pestaña de su área con `SOLICITA` puesto.
7. Borrarlo de la base y **vaciar su fila** en `Altas del sistema`. Vaciar, no
   borrar la fila: correrla desalinea las columnas que las pestañas por área
   tienen escritas a mano.

## Lo que quedó pendiente

1. **Seguimiento de compra** — la recepción, `RECIBIDO`, y el análisis de
   plazos. Es lo próximo según lo hablado. Cuando exista, se suma como sexto
   indicador del tablero y `SIGUIENTE_ESTADO` gana un paso; el indicador PEDIDO
   va a dejar de crecer solo, que es lo que hoy lo hace poco informativo.
2. **La comparativa en sí** — hoy es un enlace y una tabla `compras_cotizaciones`
   sin pantalla. Estaba anotado como "lo trabajamos después".
3. ~~**`Autoelevador HCMG` es un error de tipeo de `XCMG`**~~ — resuelto de otra
   forma el 28/08/2026: las dos ubicaciones apuntan al mismo equipo (`EM12`), así
   que sus 2 RI caen igual en la máquina correcta y no hace falta fusionarlas.
4. **54 rutas de RRHH y Remises no validan sesión por su cuenta** y dependen del
   middleware. Hoy ninguna usa el cliente admin, así que RLS las cubre, pero
   conviene revisarlo con calma.
5. **Revisar en un mes si bajó el 68% de `URGENTE`.** Si no bajó, el problema no
   era quién cargaba la prioridad sino el criterio, y eso se conversa.
6. **Aprobar una OS nunca se ejercitó de verdad.** Está desplegado desde el
   4/09/2026 y al 7/09 las once que esperan siguen siendo las mismas once: la
   escritura de `APROBADO` en la planilla es código que compila y nunca corrió.
   Las credenciales de Google no están en local, así que la única prueba posible
   es en el deploy: aprobar una de las **220–228** —tiene que aparecer al final
   de la pestaña `MANTENIMIENTO`— e intentar con la **26**, que tiene que
   negarse.
7. **La gestión de las OS desde Compras.** Hoy Compras las aprueba pero el
   listado sigue siendo de Mantenimiento, y el ítem del menú está gateado por
   `modulo: "mantenimiento"`: quien trabaja en Compras y no tiene ese módulo
   aprueba pero no puede hacer el seguimiento. Lo conversado es una ruta propia
   afuera de los dos módulos, alcanzable con Compras **o** con Mantenimiento,
   como ya vive `/mis-pedidos`; está esbozado al final del spec.
8. **`os_aprobadores` tiene una sola persona.** La regla impide vaciar la lista,
   pero no cubre que Nico se tome vacaciones: ahí ninguna OS avanza y nadie
   puede destrabarlo, porque aprobar no depende del nivel. Con sumar a Maxi
   alcanza.

## Las ubicaciones son equipos y sectores de Mantenimiento

Desde el 28/08/2026 las 38 ubicaciones están mapeadas contra el núcleo: 15 a un
equipo, 13 a un sector de planta y 10 a nada. Eso hace **atribuible el 52% de
los requerimientos** y habilita el filtro por máquina y por sector en el
listado, y el bloque de gasto en la ficha del equipo.

Lo que hay que saber para no romperlo:

- **Compras y Mantenimiento nombran las máquinas distinto.** La planilla dice
  `Doosan 225 n°1`; la ficha dice `EM3 — Retroexcavadora 3`. Lo único que las
  une es `marca` y `modelo` de la ficha técnica, y por eso los desplegables las
  muestran.
- **Cuatro enlaces son una convención, no un dato.** Las dos Doosan 225 y los
  dos Autoelevadores Toyota son indistinguibles; se asumió que la n°1 es el
  código de equipo más bajo. Si están cruzadas, el gasto cae en la gemela y
  nada avisa.
- **Casi la mitad del gasto no se atribuye y está bien así.** Pañol (306 RI),
  los talleres, Oficinas y OTRA no son una máquina ni un sector. Lo que entra al
  pañol es stock: todavía no es de nadie.
- **El enlace vive en `compras_ubicaciones`, no en el requerimiento** (lo movió
  la 019). Filtrar por equipo es filtrar por sus ubicaciones.

El diseño está en
[specs/2026-08-28-mapeo-ubicaciones-equipos](superpowers/specs/2026-08-28-mapeo-ubicaciones-equipos-design.md);
la migración es la **042**.

## Dónde está cada cosa

| | |
|---|---|
| Copia de trabajo | `C:\Users\Usuario\Desktop\SdG PP` |
| Módulo | `app/(app)/compras`, `lib/compras`, `app/api/compras` |
| El tablero | Cinco indicadores; el detalle vive en Requerimientos y en la bandeja: [el diseño](superpowers/specs/2026-08-25-tablero-compras-indicadores-design.md) |
| Órdenes de servicio | Se aprueban en `app/(app)/compras/aprobaciones`; la regla vive en `lib/mantenimiento/aprobacion.ts` y las tablas son de Mantenimiento |
| Migraciones | `supabase/migrations/015` a `025`, y `20260904140041_os_aprobadores.sql` |
| Importador | `scripts/import-compras/import.mjs` (idempotente, tiene `--dry-run`) |
| Cómo funciona | [COMPRAS.md](COMPRAS.md) |
| Sincronización | [COMPRAS-SINCRONIZACION.md](COMPRAS-SINCRONIZACION.md) |
| La orden de compra en Odoo | `lib/odoo/pushOrden.ts` la crea, `lib/compras/productoOdoo.ts` elige el producto, `lib/odoo/pdfDeOrden.ts` confirma y baja el PDF; el terreno está en [ODOO-INTEGRACION.md](ODOO-INTEGRACION.md) |
| Scripts de la planilla, para instalar a mano | `docs/compras-formulario-apps-script.gs` (numera las respuestas) y `docs/compras-aviso-por-tiempo.gs` (manda el mail del pedido cargado en el sistema) |
| Análisis de la planilla | [COMPRAS-ANALISIS-PLANILLA.md](COMPRAS-ANALISIS-PLANILLA.md) |
| Login y correos | [AUTENTICACION.md](AUTENTICACION.md) |
| Variables de entorno | [VARIABLES-VERCEL.md](VARIABLES-VERCEL.md) |
| Reglas compartidas con otros módulos | [NUCLEO-COMPARTIDO.md](NUCLEO-COMPARTIDO.md) — fechas, números, letras de columna |

Hay una segunda copia del repo en `C:\Users\Usuario\sistema_integral`, creada
por error y desactualizada. Trabajar sobre la del Desktop, que es la que tiene
el `.env.local`.
