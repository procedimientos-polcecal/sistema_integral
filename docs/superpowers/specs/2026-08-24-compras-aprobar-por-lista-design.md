# Compras — Aprobar es una lista, y la bandeja "Para aprobar" — Design Spec

**Fecha:** 2026-08-24
**Estado:** Diseño aprobado — pendiente de plan de implementación

## Objetivo

Que las dos aprobaciones del circuito dependan de **estar en una lista de dos
personas** —NICO y MAXI— y no del nivel de acceso, y darles una bandeja propia
donde resolver las compras que esperan su decisión.

## Punto de partida

Hoy los dos actos de aprobación salen del mismo lugar y se confunden con el
trabajo operativo:

- `puedeAprobarCompras()` mira `usuario_modulos.nivel === 'admin'`. O sea que
  quien administra el módulo, aprueba.
- `aprobadoresDeCompras()` —la que llena el desplegable de "a quién le toca"—
  también sale del nivel admin.
- `compras_aprobadores` existe pero sólo guarda el **alias de la planilla**
  (`NICO`, `MAXI`), que es lo que hay que escribir en su desplegable estricto.
- No hay pantalla para aprobar compras: la única forma es entrar a la ficha del
  RI o al tablero y encontrarla.

El resultado práctico: 28 compras esperando aprobación sin una pantalla donde
verlas, y un rol que mezcla administrar con decidir sobre el gasto.

## Decisiones

**Aprobar es una lista, no un nivel.** `compras_aprobadores` deja de guardar
sólo el alias y pasa a ser **quién puede aprobar**. Los dos actos dependen de
estar ahí: aprobar el requerimiento (que pase a comparativa) y aprobar la compra
(elegir el presupuesto).

Es la regla que la planilla ya tenía y que el módulo espejaba a mano: la columna
de aprobación está restringida a ciertas cuentas. Hasta ahora la lista y el
permiso vivían separados y podían contradecirse; ahora la lista **es** el
permiso.

**Ser admin del sistema no alcanza para aprobar.** Ya era así y se refuerza:
antes por una regla escrita aparte, ahora porque el permiso sale de un solo
lugar.

**Los tres niveles quedan así en Compras:**

| Nivel | Qué puede |
|---|---|
| `lectura` | consultar |
| `edicion` | cargar comparativas y presupuestos, gestionar proveedor, costos y OC, asignar a quién le toca aprobar, y avanzar los estados del circuito **salvo el que es una aprobación** |
| `admin` | lo mismo, y además administrar el módulo: quiénes están en la lista de aprobadores |

`admin` vuelve a significar administración —es lo que tiene un `admin_sistema`—
y deja de ser un rol de decisión sobre el gasto.

**Avanzar no es aprobar.** `edicion` mueve el RI a comparativa, a "para
comprar" y a "pedido". El paso de `PARA_COMPRAR` a `APROBADO` no está en esa
lista: no es un avance operativo sino la decisión sobre el gasto, y sigue siendo
de la persona asignada —que además tiene que estar en la lista—. Es el mismo
principio que ya rige: elegir un presupuesto **es** aprobar la compra.

**Se descarta el nivel nuevo en el núcleo.** Se había considerado un nivel
intermedio entre `edicion` y `admin` para separar "carga datos" de "avanza
estados". Con `edicion` haciendo todo lo operativo y aprobar saliendo de la
lista, no queda nada que ese nivel separe: sería un valor de enum nuevo, 34
comparaciones de nivel reescritas y RLS tocado en los cuatro módulos, sin
cambiar ningún comportamiento. Si más adelante aparece una razón concreta, es su
propia pieza.

**Pertenecer a la lista y tener alias dejan de ser lo mismo.** Hoy
`PUT /api/compras/aprobadores` **borra la fila** cuando se manda el alias vacío,
así que quitar un alias revocaría el permiso sin que nadie lo pida. Se separan:
estar en la lista es el permiso, el alias es cómo se lo nombra en la planilla.
Sin alias se puede aprobar igual — la aprobación no llega a la planilla y queda
pendiente, que es el comportamiento que ya existe.

**La lista no puede quedar vacía.** Sin nadie adentro no se aprueba nada y el
circuito se traba entero. Sacar al último se rechaza con un mensaje, no con un
error genérico.

**En la bandeja, primero lo propio.** Arriba lo que espera la decisión de quien
mira; abajo, en consulta, lo que espera a la otra persona. Ver la cola del otro
sirve para saber si algo está demorado, y separarlo evita confundir "lo que
tengo que hacer" con "lo que estoy esperando".

## La bandeja: `/compras/para-aprobar`

Visible en el menú **sólo para quien está en la lista**.

Dos bloques, ordenados por urgencia y antigüedad —el mismo criterio que la cola
de aprobaciones—:

1. **Te toca a vos** — las compras en `PARA_COMPRAR` asignadas a quien mira.
2. **Esperando a otros** — el resto en `PARA_COMPRAR`, en consulta.

Cada fila muestra el pedido, el área, la prioridad y cuánto lleva esperando, y se
despliega ahí mismo con la comparativa completa, reusando `ComparativaDecision`
—la vista que ya existe: matriz en pantalla grande, tarjetas apiladas en el
teléfono— con el botón "Aprobar con este" por presupuesto. Se decide sin salir
de la bandeja.

Una compra sin presupuestos cargados —sólo con el link a la planilla— se muestra
con el link y el botón de aprobar sin elegir, que es lo que la ruta ya permite
cuando no hay nada que elegir.

## Qué cambia por dentro

| Archivo | Cambio |
|---|---|
| `supabase/migrations/028_compras_aprobar_por_lista.sql` | `puede_aprobar_compras()` mira la lista, no el nivel; política para administrarla |
| `lib/compras/auth.ts` | `puedeAprobarCompras()` y `aprobadoresDeCompras()` salen de `compras_aprobadores` |
| `app/api/compras/aprobadores/route.ts` | alta y baja de la lista, además del alias; baja del último rechazada |
| `app/(app)/compras/configuracion/` | administrar la lista, no sólo editar alias |
| `lib/core/nav.ts` | "Aprobaciones" y "Para aprobar" se muestran por estar en la lista, no por `soloAdmin` |
| `app/(app)/compras/para-aprobar/` | la bandeja |

Que `aprobadoresDeCompras()` y el permiso salgan de la misma fuente cierra una
contradicción posible: hasta ahora se podía asignar una compra a alguien que no
tenía permiso para aprobarla.

## Tests

Con vitest, sobre lógica pura:

- Aprobar sale de la lista: alguien con nivel admin que no está en la lista no
  puede; alguien en la lista con nivel lectura sí.
- `admin_sistema` no aprueba por serlo.
- No se puede sacar al último de la lista.
- El reparto de la bandeja: lo asignado a quien mira va arriba, el resto abajo,
  y cada bloque ordenado por urgencia y antigüedad.

## Pasos manuales

Ninguno: NICO y MAXI ya están en `compras_aprobadores` con su alias, así que al
aplicar la migración conservan el permiso. Conviene revisar después, en
`/compras/configuracion`, que la lista tenga exactamente a quienes corresponde.
