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

**Prioridad y quién paga nacen vacías.** Un valor por defecto es una decisión
disfrazada de dato. Las define gerencia al aprobar, y sin definirlas no se puede
aprobar. Para que "Ambas" siga siendo expresable, quién paga tiene tres estados:
`empresa_id`, o `paga_ambas`, o ninguno de los dos.

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
degrada el cron: hace fallar el deploy entero.

**El activador "Al editar" de Apps Script no se dispara con el formulario.**
Hacen falta los dos activadores.

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
3. **La fila 2 del master entró como RI 1.** Es la fila plantilla, con las
   fórmulas que usa el resto de la planilla —de ahí que su descripción sea "dd"
   y su código "de"—, pero el importador la levantó como un requerimiento más.
   Se la aprobó desde la app y quedó encolada una escritura sobre esas
   fórmulas; el 26/08/2026 se la sacó de pendientes a mano, y va a volver
   apenas alguien toque ese RI. Lo que corresponde es que el importador y la
   sincronización la ignoren.
4. **`Autoelevador HCMG` es un error de tipeo de `XCMG`** (2 RI). Se fusiona
   desde `/compras/ubicaciones`, pero conviene corregirlo también en la planilla
   o la sincronización lo recrea.
5. **54 rutas de RRHH y Remises no validan sesión por su cuenta** y dependen del
   middleware. Hoy ninguna usa el cliente admin, así que RLS las cubre, pero
   conviene revisarlo con calma.
6. **Revisar en un mes si bajó el 68% de `URGENTE`.** Si no bajó, el problema no
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
