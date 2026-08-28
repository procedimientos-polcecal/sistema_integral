# Cuánto cuesta tener una máquina

Diseño acordado el 28 de agosto de 2026. Continúa
[el mapeo de ubicaciones](2026-08-28-mapeo-ubicaciones-equipos-design.md), que
dejó los materiales enlazados a cada equipo.

## El problema

La ficha de un equipo muestra hoy lo que Compras gastó en él. Es un tercio de la
respuesta: a una máquina se le compran repuestos, se le paga a un tercero para
que la arregle, y la arregla el personal propio. Las tres cosas están cargadas y
ninguna se suma con las otras.

- **Materiales**: resuelto por el mapeo de ubicaciones.
- **Terceros**: `ordenes_servicio.costo`, 148 de 221 OS con equipo y costo.
  $86,7M en 2025 y $76,7M en 2026.
- **Mano de obra propia**: `ordenes_trabajo.horas` con sus operarios, 1.169 OT
  con horas. Falta cuánto vale una hora.

## Lo que la lectura de los datos cambió del plan

**`horas` es la duración del trabajo, no horas-hombre.** Las OT con tres
operarios tienen la misma mediana que las de uno —3 horas— cuando serían el
triple si fueran horas-hombre. Costear sin multiplicar por la cantidad de gente
haría que un trabajo de tres personas salga lo mismo que uno de una.

**El 76% de las horas no son mano de obra propia.**

| | OT | Horas | Horas-hombre |
|---|---|---|---|
| Con contratista, sin operario propio | 325 | 11.222 | 0 |
| Con operarios propios | 838 | 3.409 | 6.815 |
| Sin operarios ni contratista | 6 | 177 | 0 |

Las de contratista las hizo un tercero y `ordenes_trabajo` no tiene columna de
costo. Su plata, si está en algún lado, está en una OS —pero no hay enlace entre
OT y OS, así que no hay forma de saber cuánta—. Lo costeable como mano de obra
propia son **6.815 horas-hombre**.

**El costo de una OS y su cotización elegida no coinciden.** De las 99 OS que
tienen las dos cosas, 47 difieren: algunas por redondeo del IVA ($217.500 contra
$217.501) y otras en serio (la OS 16 pagó $813.413 sobre $2.386.725 cotizados).
Manda `ordenes_servicio.costo`, que es lo que se pagó; la comparativa es lo que
se ofertó. Además tiene más cobertura: 62 OS tienen costo sin ninguna cotización
elegida.

Las OS **no** tienen cotizaciones en dólares: no hay columna de moneda, son
todas en pesos. Los dólares son de Compras, que los trajo en la migración 040.

## 1. La tarifa — migración 043

Una tabla `mantenimiento_tarifas_hora` con el valor y desde cuándo rige:

```
id · valor numeric(14,2) · vigente_desde date · creado_por · created_at
```

La tarifa de una hora trabajada es la de mayor `vigente_desde` anterior o igual
a la fecha del trabajo. **Actualizarla no reescribe el costo de lo ya hecho**,
que es el punto: con un solo valor mutable, subir la tarifa en septiembre
cambiaría lo que costó una reparación de marzo y el gasto de una máquina se
movería sin que hubiera pasado nada.

Escribir requiere `mant_es_admin()`, como el resto de la configuración del
módulo. Leer, `mant_puede_ver()`.

**Sin ninguna tarifa cargada la mano de obra no se muestra.** No vale cero: cero
diría que el trabajo propio es gratis. El bloque dice que falta y enlaza a
Configuración.

Lo mismo vale para las horas anteriores a la primera tarifa: no se costean, y se
cuentan aparte como horas sin tarifa.

## 2. Dónde se carga

Una tarjeta más en `/mantenimiento/configuracion`, con la forma de las que ya
están: el valor vigente arriba, el histórico debajo y un formulario para cargar
uno nuevo con su fecha.

Cargar una tarifa con una fecha que ya tiene otra la reemplaza —es una
corrección, no una segunda tarifa del mismo día—. Se pueden cargar fechas
pasadas: la primera carga va a ser justamente hacia atrás, para costear 2026.

## 3. El cálculo — `lib/mantenimiento/costoEquipo.ts`

Tres fuentes agregadas por año:

| Fuente | De dónde | Año por |
|---|---|---|
| Materiales | `compras_requerimientos.costo_iva` vía las ubicaciones del equipo | `fecha_pedido`, respaldo `fecha` |
| Terceros | `ordenes_servicio.costo` con `equipment_id` del equipo | `fecha` |
| Mano de obra | Σ horas × nº de operarios × tarifa de ese día, sólo OT sin contratista | `fecha_ejecucion`, respaldo `fecha_cierre` y `fecha` |

La mano de obra usa la fecha de ejecución y no la de alta porque es cuándo se
trabajaron esas horas, que es lo que decide qué tarifa les corresponde. Una OT
abierta en diciembre y ejecutada en marzo se costea con la de marzo.

Una OT con contratista aporta cero aunque tenga operarios anotados: si intervino
un tercero, sus horas no son nuestras. Se cuenta como una OT de tercero sin
costo conocido y se declara.

## 4. El bloque de la ficha

`ComprasDelEquipo` pasa a ser `CostoDelEquipo`. Por año, tres líneas —materiales,
terceros, mano de obra— y el total; abajo, el acumulado y el detalle de
requerimientos que ya estaba.

### Lo que el número no incluye, dicho en pantalla

Es la parte que hace que el total sea usable en vez de engañoso. Un costo que se
presenta como completo y no lo es, es peor que no mostrarlo:

- **11.222 horas de contratista sin costo conocido.** El 76% de las horas
  registradas. Parte de esa plata está en las OS de la misma máquina, sin forma
  de verificar cuánta.
- **584 OT no tienen horas cargadas**, 380 RI no tienen costo y 60 OS tampoco.
  Se cuentan aparte y no suman cero.
- **Las compras de un sector no se reparten entre sus máquinas**, igual que en el
  spec anterior.
- **`Ambos` cuenta como un operario** en 59 OT (753 horas). Alguien escribió "los
  dos" en la columna de operario y no hay forma de saber cuáles: subestima.

### Ninguna máquina tiene hoy las tres fuentes

Calculado sobre los datos reales al implementarlo, y conviene saberlo antes de
mirar la pantalla esperando un total completo:

| | Materiales | Terceros | Horas propias |
|---|---|---|---|
| Equipos móviles (`EM*`) | sí | sí | **0** |
| Máquinas de planta | **0** | sí | sí |

Los móviles no tienen horas propias porque sus órdenes de trabajo no traen
operarios anotados. Las de planta no tienen materiales porque las ubicaciones de
Compras que les corresponderían —"Planta Filler 2"— enlazan al **sector**, no a
la máquina: la planilla de Compras nombra lugares, y sólo para los móviles ese
lugar es una máquina.

Los totales sobre los equipos enlazados: **$70,1M en materiales** (todo en
móviles), **$148,4M en terceros** y **6.480 horas-hombre propias** (casi todas en
máquinas de planta).

No es un error del cálculo y no se arregla acá: se arreglaría enlazando
ubicaciones a máquinas de planta, y para eso la planilla de Compras tendría que
nombrarlas. Mientras tanto el bloque suma lo que hay y dice lo que falta.

### El riesgo asumido

Materiales y terceros podrían solaparse si alguien pidió un servicio por un
requerimiento de compra en vez de por una OS. Por definición no debería pasar
—el RI pide materiales, la OS pide trabajo— pero nada lo impide y no hay forma
de detectarlo. Queda escrito para que, si un total aparece inflado, se sepa
dónde mirar primero.

## 5. Tests

- **La tarifa vigente en los bordes**: el día exacto en que empieza a regir, el
  día anterior, una fecha antes de la primera tarifa cargada, y sin ninguna
  tarifa.
- **Las horas-hombre**: con contratista (cero), con cero operarios (cero), con
  `Ambos` (uno), y el producto por la cantidad correcta.
- **El agregado por año**: las tres fuentes juntas, una fuente vacía, y los
  registros sin fecha o sin monto contados aparte.

## Lo que este spec no incluye

**El costo de las OT de contratista.** Necesitaría una columna de costo en
`ordenes_trabajo` o un enlace OT ↔ OS, y las dos cosas son decisiones sobre cómo
se registra el trabajo, no sobre cómo se lo suma.

**El costo por sector.** El bloque es por máquina. Ver lo que costó Filler 2
entero requiere una pantalla de sector que hoy no existe.
