# Inventario — pedir un RI desde el stock

**Fecha:** 2026-10-05
**Estado:** acordado
**Módulos:** Inventario (`app/(app)/inventario`, `app/api/inventario`, `lib/inventario`) llamando al alta de Compras

## El problema

`/inventario/reponer` ya contesta «¿qué hay que pedir hoy?»: una lista curada de
74 artículos con faltante **y** consumo reciente, cada uno con su botón de pedir
([spec](2026-10-02-inventario-reponer-design.md)).

Falta el otro momento, que es el que pasa más seguido: alguien está **parado
frente al estante con el celular**, busca `guantes` en `/inventario/stock`, ve
`Faltan 12`, y no puede hacer nada desde ahí. Tiene que acordarse, salir, entrar
a otra pantalla y buscarlo de nuevo — y si ese artículo no tuvo salidas en 90
días, en Para reponer **no está**, porque esa lista filtra por consumo a
propósito.

Son dos preguntas distintas. Reponer es «qué pido»; stock es «esto que estoy
mirando, lo pido».

## Lo que ya existe y no se reescribe

- **`NuevoRequerimientoModal`** acepta valores precargados (`ValoresIniciales`)
  y ya lo usan cuatro pantallas. Este spec **no toca Compras**.
- **`lib/inventario/reponer.ts`** tiene `estaAbierto()` y la lógica de «cuál es
  el RI abierto más nuevo de este código», con 29 tests verdes.
- **`useConfirm()`** de `components/ConfirmProvider.tsx` es el diálogo de
  confirmación de todo el sistema.
- La RLS no estorba: `compras_req_select` es `using (true)` para cualquier
  autenticado y el `insert` deja a cualquier usuario activo cargar un pedido a
  su nombre.

## Lo medido, el 5/10/2026 contra producción

| | |
|---|---|
| Catálogo activo | 1.159 |
| Con faltante (lo que se ve con «Sólo lo que falta») | **521** |
| De ésos, **con un RI abierto** | **25** |
| Sin faltante pero con RI abierto | 23 |
| Códigos con **más de un** RI abierto | 6 — `00666`(3), `00001`(3), `00268`, `00800`, `01124`, `00473` |

Los 25 son los que disparan el aviso. Son pocos sobre 521, pero son justamente
los que más se miran: si falta algo, alguien ya fue a fijarse.

## Las dos decisiones

### El botón está siempre, pero avisa

Cuando el artículo ya tiene un RI abierto, **no se esconde el botón**: sale un
`useConfirm()` que dice cuál es el pedido y de cuándo, y hay que confirmar.

Se eligió esto por sobre bloquear —que es lo que hace Para reponer, donde esos
artículos van a un grupo aparte sin botón— porque desde el stock el caso
legítimo existe: el pedido viejo quedó trabado, o hace falta más cantidad. Lo
que no puede pasar es pedir de nuevo **sin enterarse**, que es exactamente lo
que hace hoy el Apps Script de la planilla y la razón por la que seis códigos
acumulan más de un RI abierto.

La diferencia entre las dos pantallas es deliberada y se lee sola: en Para
reponer la lista *propone* y por eso no ofrece lo ya pedido; en stock la persona
*eligió* un artículo y el sistema no la contradice, la informa.

**Y hay un dato que apareció recién al implementar, que cierra la discusión.**
Entre los 25 hay RI abiertos de hace casi un año:

```
00004  ACEITE HD SUPLEMENTO 1.30 X 20LTS   RI 162  hace 356 días
00244  CONOS DE MARCACIÓN                  RI 169  hace 355 días
00251  CONTACTOR 18,5 KW (40 A)            RI 679  hace 229 días
```

El spec de Para reponer había medido que «el pedido fantasma no es un riesgo» —y
es cierto **en su lista**, que son los 17 con consumo reciente—. Pero sobre los
521 del stock los fantasmas existen. Si el aviso bloqueara, esos artículos
quedarían imposibles de pedir para siempre, y el único arreglo sería ir a cerrar
un RI de hace un año desde otro módulo. Avisar y dejar pasar es lo correcto, y
no por prudencia: por los datos.

### Sólo las filas con faltante

Las 521 por debajo del mínimo. Es lo que se pidió, y es lo único donde la
precarga tiene sentido: la cantidad propuesta es el stock de seguridad y el
detalle dice «había 0 de un mínimo de 4». Para un artículo por encima del mínimo
ese texto sería falso, y el alta general de Compras sigue estando donde siempre.

## Cómo viaja el dato

La pantalla de stock es un cliente que pega a `/api/inventario/articulos` en
cada tecla (con 300 ms de espera) y recibe **como mucho 50 filas**. El dato de
«ya pedido» viaja por ahí: la ruta acepta `pedidos=1` y, **sólo para las filas
con faltante**, consulta los RI de esos códigos y le cuelga a cada una:

```ts
riAbierto: { id: string; nro_ri: number; diasDelRi: number; cuantosAbiertos: number } | null
```

Va detrás de un parámetro y no siempre, porque **esa misma ruta alimenta el
buscador del formulario de movimiento**, que no lo necesita: sin el flag no paga
la consulta.

Son ≤50 códigos en el `.in()`, lejos del punto donde PostgREST rechaza la URL
con un 400 sin explicar por qué.

## La fila

Las filas con faltante suman **Pedir** al lado de `Movimiento`. `Movimiento`
queda sólido —es la acción que ya tiene memoria muscular— y `Pedir` entra
delineado. Los dos con 40 px de alto: esto se aprieta con el pulgar, de pie y a
veces con guantes.

**`Pedir` no se esconde detrás de `puedeOperar`.** `Movimiento` sí, porque cargar
un movimiento es operar el inventario; pedir un material lo puede hacer
cualquier usuario activo —así lo dejó la 018 a propósito— y quien nota que algo
se acabó no es necesariamente quien carga movimientos. Es la misma razón por la
que el ítem «Para reponer» del menú no lleva `soloAdmin`.

Si hay pedido abierto, la fila lo dice en chico —`Ya pedido · RI 2051, hace 1
día`, con enlace a la ficha— además del aviso al tocar. El cartel sorprende; la
línea en la fila deja decidir antes de tocar.

## Lo que se comparte en vez de copiarse

Dos funciones puras salen a `lib/inventario/reponer.ts`:

**`altaDeReposicion(articulo)`** → los valores precargados del formulario. Hoy
vive adentro de `ReponerClient` como una función local. La cantidad es el
**stock de seguridad y no el faltante**: se compra por lote, y de los pedidos
reales que corresponden a un faltante —falta 2 pidió 4, falta 15 pidió 30—
ninguno pidió la diferencia exacta. Con dos copias, ese texto y esa regla se
separan.

**`pedidosAbiertosPorCodigo(requerimientos, hoy)`** → `Map` de código a
`{ ri, cuantosAbiertos, diasDelRi }`, con los abiertos ordenados del más nuevo
al más viejo. Hoy es un bloque adentro de `clasificarParaReponer`. Ahí vive el
**clamp de `diasDelRi`**, que no es obvio: `compras_requerimientos.fecha` es
`timestamptz`, y un RI cargado a las 21:30 de Argentina cae en el día UTC
siguiente y daría −1. Reimplementar eso en la ruta es garantizar equivocarlo.

Es un refactor con red: los 29 tests de `clasificarParaReponer` están verdes y
tienen que seguir estándolo **sin tocarse**.

## Qué se testea

Vitest sobre las dos funciones nuevas:

- `altaDeReposicion` propone el **stock de seguridad** como cantidad, no el
  faltante, y como texto.
- Su detalle lleva los números reales del artículo.
- `pedidosAbiertosPorCodigo` ignora los RI cerrados (`RECIBIDO`, `DENEGADO`,
  aprobación `DENEGADA`) y toma los abiertos.
- Con varios abiertos informa **el más nuevo** y cuántos hay — el caso real del
  `00666`, que tiene tres.
- Un RI con fecha de hoy a la noche no da antigüedad negativa.
- Un código sin RI no aparece en el mapa.
- Los 29 tests de `clasificarParaReponer` siguen pasando sin modificarse.

La pantalla no se testea: está detrás del login y no hay `@testing-library`.

## Cómo se verifica lo que los tests no alcanzan

- **Contra producción**, que `pedidos=1` devuelve `riAbierto` para los 25
  faltantes que hoy lo tienen y `null` para los otros 496.
- **Maquetado a 375 px** de la fila con los dos botones: es donde una
  descripción larga más `Faltan 12` más dos botones se rompe. Mismo método que
  se usó para el desplegable con buscador.

El formulario y el cartel los ve una persona: están detrás del login.

## Lo que queda afuera, a propósito

**Pedir desde una fila sin faltante.** El alta general de Compras ya existe.

**Que el aviso bloquee.** Se decidió informar, no impedir: ver arriba.

**Tocar Para reponer.** Sigue con su regla —lo ya pedido va a otro grupo y sin
botón—, que es la correcta para una lista que propone.
