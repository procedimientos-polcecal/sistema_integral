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
3. **Un cron cada 6 horas** (`/api/cron/rrhh-recalculo`) recalcula una ventana
   móvil de 45 días. Cubre lo único que las otras dos no ven —que pase el
   tiempo: los días nuevos necesitan su fila aunque nadie toque nada— y de paso
   es la red por si algún camino de guardado quedara sin disparar el suyo.

   **Vive en GitHub Actions, no en `vercel.json`.** El plan Hobby de Vercel
   limita los crons en frecuencia *y en cantidad*, y pasarse no degrada el cron:
   hace fallar el deploy entero. En `vercel.json` ya hay tres. Compras y
   Mantenimiento dejan uno diario ahí como red por si Actions falla; este no,
   justamente para no arrimarse al límite. Si algún día pasan a Pro, conviene
   agregarlo.

**El Analítico pide los seis meses en paralelo**, que son independientes entre sí.

**La planilla general sigue recalculando** antes de calcular: es una acción
explícita sobre la liquidación, no una carga de pantalla, y ahí conviene el
número exacto por sobre el segundo que tarda.

## Lo que queda por hacer

**Aplicar `044_rrhh_indices_de_lectura.sql`** en el SQL Editor. A este tamaño no
se nota; van porque la tabla crece ~25.000 filas al año.

## La región, y por qué la función va con la base y no con la gente

Supabase está en **ca-central-1 (Montreal)**. Vercel no tiene región en Canadá,
así que `vercel.json` ahora fija `iad1` (Washington DC): es el salto más corto y
mejor conectado hasta Montreal, del orden de 15 ms.

Puede que el default del proyecto ya fuera `iad1`, en cuyo caso esto no cambia
nada — pero queda explícito y deja de depender de un default que puede cambiar.

**Por qué no `gru1` (São Paulo), que está cerca de los usuarios.** Son dos
tramos distintos y no pesan igual:

| Tramo | Cuántas veces por pantalla |
|---|---|
| Navegador (Argentina) → función | una por request |
| Función → base (Montreal) | **hasta 16 por recálculo** |

Poner la función en São Paulo acorta el tramo que se recorre una vez y alarga el
que se recorre dieciséis. Con ~130 ms hasta Montreal, serían dos segundos de
penalidad por recálculo. La función va pegada a la base.

**El arreglo de fondo sería mudar Supabase a sa-east-1 (São Paulo)** y las
funciones a `gru1`: ahí los dos tramos quedan cortos. No es un cambio de
configuración, es migrar el proyecto a uno nuevo con backup y restore, con su
ventana de indisponibilidad. Vale la pena evaluarlo, no improvisarlo.

## Reglas para lo que venga

**Ninguna pantalla debe recalcular para mostrar.** Si un dato hace falta fresco,
el recálculo va donde se guarda el insumo, o en el cron. Recalcular al leer
parece prolijo y cuesta segundos en cada carga.

**Cualquier consulta que barra el padrón va con `traerPaginado`.** PostgREST
corta en 1000 filas sin avisar. Ver `docs/RRHH-ACTUALIZACION.md`.

**El cache en memoria no existe en serverless.** Un `Map` a nivel de módulo es
por instancia; con varias instancias es casi siempre un miss. Si hace falta
coordinar, va en la base.
