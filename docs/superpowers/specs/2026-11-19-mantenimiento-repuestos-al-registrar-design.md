# Los repuestos que se usaron se cargan al registrar el trabajo

**19/11/2026 · cambio chico**

## Para qué

Para que **quede registrado qué se gastó en cada OT**.

El modal de «Registrar el trabajo» es hoy el único formulario de OT que no
pide repuestos —los dos que *crean* una orden, `NuevaOTModal` y el formulario
de carga sin señal, ya los cargan renglón por renglón—, y es justo el momento
en que se sabe qué salió del pañol: al crear la orden todavía no se usó nada.

## Lo que se mide antes de prometer nada

- **No hay con qué valuarlo en pesos.** `inventario_articulos` no tiene columna
  de precio, y de las 2.530 OT **ninguna** tiene `costo` cargado. El costo por
  equipo que ya existe (`costoEquipo.ts`) sale de Compras, de las órdenes de
  servicio y de las horas × tarifa. Lo que va a quedar registrado es **qué
  piezas y cuántas**, no un monto.
- La OT ya tiene una lista de repuestos: `ordenes_trabajo_repuestos`, **30
  filas en todo el sistema**. Es la que muestra «Repuestos que hacen falta» y
  la que se carga al crear la orden.
- **306 de 2.530** OT tienen texto en `repuesto`; **262** las creó el sistema.

## Metas

- Al registrar el trabajo se pueden cargar, corregir y sacar los repuestos
  usados, renglón por renglón y con el buscador del inventario, igual que en el
  alta.
- El formulario **arranca precargado** con los repuestos que la OT ya tenía
  anotados: lo normal es que lo que hacía falta sea lo que se usó, y
  reescribirlo es donde la gente deja de cargarlo.
- Lo cargado queda en `ordenes_trabajo_repuestos`, que es lo que ya lee
  «Repuestos que hacen falta» y lo que copia `reutilizarOT`.

## No metas

- **No se valúa en pesos** (ver arriba: no hay precio).
- **No se descuenta stock del pañol.** Eso lo hace Taller Vial; en
  Mantenimiento sería otro proyecto.
- **No se escribe en la planilla.** La celda `REPUESTO UTILIZADO` es la columna
  **I** del master, que está en `COLUMNAS_DE_DERRAME`: lo que se le escribe no
  queda, el derrame del `IMPORTRANGE` lo pisa al recalcular. Sólo se corrige
  por «Altas del sistema» (`corregirLaAlta`), y ahí viven las 262 OT que creó
  el sistema; las otras 2.268 entraron por el Google Form y no tienen dónde.
  La lista de renglones nunca se exportó —el encabezado de su ruta ya lo dice:
  «no se escribe en la planilla porque no tiene dónde»—, así que esto no abre
  ninguna deuda de exportación.
- **No se toca `ordenes_trabajo.repuesto`** desde este camino. Esa columna la
  pisa la sincronización con lo que diga la planilla; escribirla acá sería
  guardar algo que se borra solo en la próxima corrida.
- **No se distingue «previsto» de «usado»** con una columna. Ver Enfoques.

## Anti-metas

Qué lo volvería un fracaso aunque funcione:

- **Que registrar el trabajo borre repuestos que ya estaban cargados.** El
  modal manda la lista entera, así que una lista que no se pudo traer y se
  manda vacía borra lo que había. No se nota nunca: la OT se cierra bien.
- **Que un fallo guardando los repuestos tire el registro del trabajo.** Lo que
  importa es que la OT quede cerrada; la lista es accesoria y se puede volver a
  cargar desde «Repuestos que hacen falta».

## Enfoques

1. **Una sola lista, precargada al registrar.** *(elegido)* El modal abre con
   los repuestos que la OT ya tenía, se corrigen y se suman los que falten, y
   lo que queda al cerrar es lo que se gastó. Sin migración, sin tabla nueva, y
   las OT ya cerradas siguen diciendo lo que dicen hoy.
2. **Que el renglón sepa si se usó**, con una columna nueva en
   `ordenes_trabajo_repuestos`. Queda exacto para siempre y «Repuestos que
   hacen falta» sigue mostrando sólo lo previsto. Pide una migración —que la
   corre una persona a mano— y deja a las 2.530 OT anteriores diciendo que no
   se gastó nada en ninguna, que es peor que lo que dicen hoy.
3. **Una tabla aparte de «usados».** Descartada: duplica el componente, el
   buscador y la ruta para una tabla de 30 filas.

**Por qué la 1.** Lo que se quiere contestar es qué se gastó en una OT
terminada, y en una OT terminada la 1 y la 2 contestan lo mismo — con la
diferencia de que la 1 también contesta por las que ya están cerradas.

**El riesgo asumido, dicho:** mientras la OT está abierta la lista sigue
significando las dos cosas, y «Repuestos que hacen falta» de una OT cerrada va
a mostrar lo que se usó —y puede ofrecer «Pedir a Compras» por algo ya
consumido—. Se acepta porque en una OT cerrada nadie pide repuestos. El día que
alguien necesite la distinción, el enfoque 2 sigue estando.

## El cómo

- **Una ruta que reemplaza la lista entera**: `PUT` en
  `app/api/mantenimiento/ordenes/[id]/repuestos`, al lado del `GET`, el `POST`
  y el `DELETE` que ya están. Pide nivel de edición en Mantenimiento, como las
  otras dos escrituras, y arma las filas con `lineasQueValen` y
  `filasParaLaBase`, que ya existen y ya tienen tests.
  Reemplazar y no sumar: el modal muestra la lista completa y sacar un renglón
  tiene que poder sacarlo.
- **El modal** (`RegistrarOTModal`) trae la lista al abrir con `useCargar`, la
  dibuja con `RepuestosDeLaOT` —el mismo componente del alta, con
  `buscarEnInventario` encendido: acá hay conexión— y la manda al guardar.
- **Orden y fallos**, que es donde están las dos anti-metas:
  1. la ejecución, como hoy;
  2. el PATCH de la OT, como hoy —es el que escribe la planilla—;
  3. los repuestos.
  Si (3) falla, el trabajo ya quedó registrado y la OT cerrada: se dice, sin
  tirar nada, igual que hace el alta con su `repuestos_error`.
- **Si la lista no se pudo traer, no se manda.** El modal no puede distinguir
  «esta OT no tenía ninguno» de «no se pudieron traer», y mandar la segunda
  como vacía borra lo que había. Se guarda si la carga anduvo, y si no anduvo
  se avisa y el resto del registro sigue igual. Es la misma distinción que el
  buscador del inventario ya tuvo que aprender del otro lado.
- **Una lista vacía sí se manda** cuando la carga anduvo: sacar todos los
  renglones es «no se usó ninguno».

## Qué queda a quien lo escriba

- Dónde cae el campo dentro del modal y cómo se rotula.
- Si la conversión de las filas de la base a renglones del formulario merece
  una función con test en `lib/mantenimiento/repuestosDeLaOT.ts` —hay una
  decisión ahí: un formulario necesita al menos un renglón en blanco donde
  escribir, igual que `lineasDesdeElCuerpo`— o si alcanza con hacerlo en la
  pantalla.
