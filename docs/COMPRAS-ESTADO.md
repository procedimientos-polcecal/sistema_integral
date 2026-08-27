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
  → gerencia aprueba y define prioridad y quién paga   [APROBADA]
  → Compras junta presupuestos                          [EN_COMPARATIVA]
  → comparativa lista, se asigna a NICO o MAXI          [PARA_COMPRAR]
  → esa persona aprueba la compra                       [APROBADO]
  → Compras hace el pedido: fecha, proveedor, costos    [PEDIDO]
  → (seguimiento de la recepción: sin desarrollar)      [RECIBIDO]
```

Dos estados independientes, `estado_aprobacion` y `estado_compra`, porque son
decisiones de personas distintas en momentos distintos.

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
| Comparativa (col. N) y estado (col. P) en las hojas por área | **Se escriben.** Están protegidas —`A:N` por rango, y `P<fila>` automática al aprobar— pero la cuenta de servicio figura entre sus editores. Verificado el 27/08/2026: los 12 pendientes que había quedaron en cero |
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

## Lo que quedó pendiente

1. **Seguimiento de compra** — la recepción, `RECIBIDO`, y el análisis de
   plazos. Es lo próximo según lo hablado. Cuando exista, se suma como sexto
   indicador del tablero y `SIGUIENTE_ESTADO` gana un paso; el indicador PEDIDO
   va a dejar de crecer solo, que es lo que hoy lo hace poco informativo.
2. **La comparativa en sí** — hoy es un enlace y una tabla `compras_cotizaciones`
   sin pantalla. Estaba anotado como "lo trabajamos después".
3. **`Autoelevador HCMG` es un error de tipeo de `XCMG`** (2 RI). Se fusiona
   desde `/compras/ubicaciones`, pero conviene corregirlo también en la planilla
   o la sincronización lo recrea.
4. **54 rutas de RRHH y Remises no validan sesión por su cuenta** y dependen del
   middleware. Hoy ninguna usa el cliente admin, así que RLS las cubre, pero
   conviene revisarlo con calma.
5. **Revisar en un mes si bajó el 68% de `URGENTE`.** Si no bajó, el problema no
   era quién cargaba la prioridad sino el criterio, y eso se conversa.

## Dónde está cada cosa

| | |
|---|---|
| Copia de trabajo | `C:\Users\Usuario\Desktop\SdG PP` |
| Módulo | `app/(app)/compras`, `lib/compras`, `app/api/compras` |
| El tablero | Cinco indicadores; el detalle vive en Requerimientos y en la bandeja: [el diseño](superpowers/specs/2026-08-25-tablero-compras-indicadores-design.md) |
| Migraciones | `supabase/migrations/015` a `025` |
| Importador | `scripts/import-compras/import.mjs` (idempotente, tiene `--dry-run`) |
| Cómo funciona | [COMPRAS.md](COMPRAS.md) |
| Sincronización | [COMPRAS-SINCRONIZACION.md](COMPRAS-SINCRONIZACION.md) |
| Análisis de la planilla | [COMPRAS-ANALISIS-PLANILLA.md](COMPRAS-ANALISIS-PLANILLA.md) |
| Login y correos | [AUTENTICACION.md](AUTENTICACION.md) |
| Variables de entorno | [VARIABLES-VERCEL.md](VARIABLES-VERCEL.md) |

Hay una segunda copia del repo en `C:\Users\Usuario\sistema_integral`, creada
por error y desactualizada. Trabajar sobre la del Desktop, que es la que tiene
el `.env.local`.
