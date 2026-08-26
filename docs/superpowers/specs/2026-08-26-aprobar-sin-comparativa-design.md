# Aprobar una compra sin comparativa

Diseño acordado el 26 de agosto de 2026.

## El problema

Hoy el sistema tiene dos caminos para aprobar una compra y dicen cosas
distintas:

- En el **listado**, el botón «Aprobar la compra» avanza a `APROBADO` sin
  avisar nada y sin dejar cargar el proveedor ni el costo.
- En la **bandeja** (`/compras/para-aprobar`), que es la pantalla pensada para
  esto, cuando el requerimiento no tiene presupuestos cargados sólo se ve «No
  hay presupuestos cargados en el sistema» y un enlace a la planilla. No hay
  botón: la compra queda trabada.

Y hay compras que no se comparan —proveedor único, urgencia, monto menor— para
las que exigir una comparativa es exigir un trámite vacío.

## La decisión

Se puede aprobar una compra sin elegir un presupuesto, avisando pero sin
trabar, y cargando en ese mismo momento el proveedor y el costo + IVA si ya se
saben.

**Lo que esto cuesta, dicho de frente.** La ruta rechaza hoy con un 409
explícito —«Para aprobar la compra hay que elegir uno de los presupuestos»—
cuando hay presupuestos cargados y ninguno elegido, con un comentario que dice
que llamar por esa vía es un error. Esa regla se quita. A partir de acá el
sistema deja de garantizar que una compra con presupuestos se aprobó
mirándolos: pasa a ser una decisión de quien aprueba, no una condición del
circuito.

Tres decisiones que acotan el alcance:

**El aviso no traba.** Sin casilla que marcar ni motivo que escribir. Se avisa
que no hay comparativa y se aprueba igual.

**El proveedor y el costo son opcionales.** Se pueden cargar ahí o después, al
registrar el pedido, que ya los exige. Habilitarlos, no imponerlos.

**La salida está siempre, pero no siempre al mismo nivel.** Sin presupuestos es
la acción principal, porque es la única. Con presupuestos la comparativa manda
la pantalla y la salida queda al pie, en segundo plano.

## 1. La ruta

En `PATCH /api/compras/requerimientos/[id]` se quita el bloque que exige un
presupuesto elegido para pasar a `APROBADO`.

Lo que queda en pie: **aprobar la compra sigue siendo sólo de quien la tiene
asignada**. En la planilla el estado dice a quién le toca, y que apruebe otro
dejaría los dos lados diciendo cosas distintas.

`proveedor_id` y `costo_iva` ya son campos aceptados por la ruta, así que
llegan con el mismo PATCH que cambia el estado. No hace falta una ruta nueva.

Al llegar después a `PEDIDO`, la lógica que copia proveedor y costo del
presupuesto elegido no se toca: si no hay elegido, lo que ya está cargado en el
requerimiento es lo que vale, y `FALTA` sigue exigiendo que estén.

### Corrección al pasar

`POST /api/compras/cotizaciones/[id]/elegir` verifica que la persona siga en la
lista de aprobadores, además de estar asignada: alguien pudo quedar asignado y
después salir de la lista. El PATCH sólo verifica lo segundo.

Se le agrega la misma verificación. Es la regla que el proyecto ya declaró para
las dos aprobaciones —la del requerimiento y la de la compra— y tenerla en un
camino y no en el otro es el agujero, no la regla.

## 2. El formulario

Un componente propio, `AprobarSinComparativa`, que usan las dos pantallas:
inline en la bandeja, dentro de un diálogo en el listado.

Contiene el aviso, el proveedor (lista de proveedores activos, opcional) y el
costo + IVA (opcional), y el botón que aprueba.

No se suma a `ModalAvanzar`: ese componente ya maneja dos casos —la comparativa
lista y el registro del pedido— y un tercero lo vuelve ilegible.

## 3. La bandeja

**Sin presupuestos cargados:** donde hoy termina el texto «No hay presupuestos
cargados en el sistema», sigue el formulario. Es la acción principal de ese
pedido.

**Con presupuestos cargados:** la comparativa manda, como hoy. Al pie, un
enlace `Aprobar sin elegir ninguno` que despliega el mismo formulario, con el
aviso diciendo cuántos presupuestos hay sin mirar.

## 4. El listado

El botón «Aprobar la compra» deja de avanzar a ciegas y abre el formulario en
un diálogo. Así los dos caminos hacen lo mismo, que es el problema de fondo que
originó esto.

`ESTADOS_QUE_PIDEN_DATOS` pasa a llamarse `ESTADOS_CON_DIALOGO`: con
`PARA_COMPRAR` adentro el nombre viejo miente, porque en ese paso el diálogo no
pide datos sino que los ofrece.

## 5. Qué queda registrado

Nada nuevo en la base. Ya quedan `compra_aprobada_por` y `compra_aprobada_en`,
el historial asienta el cambio de estado con su autor, y **que no haya ningún
presupuesto elegido es la marca de que se aprobó sin comparar**. Un campo extra
diría lo mismo dos veces y podría contradecirlo.

## Pruebas

Sobre la regla que cambia, que es donde está el riesgo:

- con presupuestos cargados y ninguno elegido, ahora se aprueba
- el proveedor y el costo se guardan si vienen, y no rompen si no vienen
- quien no tiene la compra asignada sigue sin poder aprobar
- quien está asignado pero salió de la lista de aprobadores tampoco puede

## Alcance

Queda afuera:

- Motivos de por qué no se comparó. Se evaluó y se descartó: agrega fricción a
  cada aprobación y nadie pidió todavía poder contarlos. Si mañana hace falta
  saber cuántas compras se aprueban sin comparar, hoy ya se puede: son las
  aprobadas sin ninguna cotización elegida.
- Cualquier cambio en el paso `EN_COMPARATIVA → PARA_COMPRAR`, que sigue
  exigiendo presupuestos o el link de la comparativa. Lo que se flexibiliza es
  la aprobación, no la asignación.
