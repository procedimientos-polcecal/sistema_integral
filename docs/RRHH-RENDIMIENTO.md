# RRHH — por qué era lento y qué se hizo

Relevamiento del 27/08/2026. Los números están medidos contra la base real, con
69 empleados activos y 14.682 filas en `calculos_diarios`.

## El diagnóstico

**La base no es el problema.** La tabla más grande tiene 14.682 filas. Postgres
ni se entera. Nada de esto se arregla pagando más CPU.

**El costo son los viajes de ida y vuelta.** `supabase-js` habla por HTTP: cada
consulta es un request. Una consulta trivial medida desde Argentina tarda entre
256 y 742 ms. Todo lo demás se deduce de ahí: la optimización es hacer menos
consultas, no consultas más rápidas.

**Y sobre todo: las pantallas recalculaban antes de leer.** Cada endpoint de
lectura llamaba al recálculo del padrón entero como red de seguridad para no
mostrar números viejos. El cache que debía evitarlo vivía en un `Map` en memoria
del proceso, y en serverless cada request cae en una instancia distinta con su
propio Map vacío: no servía para nada. Abrir el Dashboard dispara 5 endpoints en
paralelo, cada uno recalculando el padrón completo. El Analítico hacía seis
recálculos en serie, uno por mes.

## Qué se hizo

| | Antes | Ahora |
|---|---|---|
| Recalcular el padrón (27 días) | 11,3 s / 639 consultas | 3,9 s / 16 consultas |
| Dashboard | 4,8 s | **1,2 s** |
| Analítico | 24,0 s | **1,3 s** |

**El motor recalcula en lote.** De las 639 consultas, 276 eran la misma repetida
69 veces: configuración, feriados, catálogo de turnos y la ficha del empleado son
iguales para todos y ahora se leen una vez. El resto se trae para todo el lote y
se agrupa en memoria.

**Las pantallas dejaron de recalcular.** Ahora sólo leen. Lo que mantiene los
números frescos son tres cosas, y entre las tres cubren lo que cubría la red de
seguridad:

1. **Cada guardado recalcula lo suyo** — una fichada, una ausencia, un período de
   vacaciones, una corrección manual, un import. Esto ya existía.
2. **Lo que afecta a todos dispara su propio recálculo** — esto no existía y
   quedaba tapado por el recálculo al leer. Un feriado recalcula ese día para el
   padrón (barato y exacto); los turnos y la configuración de liquidación
   recalculan la ventana en segundo plano, para no convertir un "Guardar" de dos
   campos en una espera de varios segundos.
3. **Un cron nocturno** (`/api/cron/rrhh-recalculo`, 04:00 hora argentina)
   recalcula una ventana móvil de 45 días. Cubre lo único que las otras dos no
   ven: que pase el tiempo. Los días nuevos necesitan su fila aunque nadie toque
   nada.

**El Analítico pide los seis meses en paralelo**, que son independientes entre sí.

**La planilla general sigue recalculando** antes de calcular: es una acción
explícita sobre la liquidación, no una carga de pantalla, y ahí conviene el
número exacto por sobre el segundo que tarda.

## Lo que queda por hacer

**Fijar la región de las funciones.** `vercel.json` no tiene `regions`, así que
Vercel usa el default del proyecto. Si no coincide con la región de Supabase,
cada consulta paga latencia entre regiones — con 16 consultas por recálculo, 50
ms de más son 800 ms. Hay que mirar la región en Supabase (Project Settings →
General) y fijar la equivalente de Vercel: `iad1` para us-east-1, `gru1` para
sa-east-1.

**Aplicar `044_rrhh_indices_de_lectura.sql`** en el SQL Editor. A este tamaño no
se nota; van porque la tabla crece ~25.000 filas al año.

## Reglas para lo que venga

**Ninguna pantalla debe recalcular para mostrar.** Si un dato hace falta fresco,
el recálculo va donde se guarda el insumo, o en el cron. Recalcular al leer
parece prolijo y cuesta segundos en cada carga.

**Cualquier consulta que barra el padrón va con `traerPaginado`.** PostgREST
corta en 1000 filas sin avisar. Ver `docs/RRHH-ACTUALIZACION.md`.

**El cache en memoria no existe en serverless.** Un `Map` a nivel de módulo es
por instancia; con varias instancias es casi siempre un miss. Si hace falta
coordinar, va en la base.
