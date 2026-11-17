-- Un renglón del cuaderno puede durar varios días, y hasta ahora no había dónde
-- guardarlo.
--
-- POR QUÉ APARECE RECIÉN AHORA
--
-- Con las fotos, un renglón es **una línea de un día**: la fecha del renglón es
-- toda la fecha que hay, y cuando una tarea se extendía, el rango salía solo de
-- juntar varios renglones (`totalesDeRenglones` toma el mínimo y el máximo de
-- las fechas del grupo). El Excel del 03/11/2026 cambió eso: cada fila ya viene
-- consolidada y trae **«Fecha Desde» y «Fecha Hasta»** escritas. Medido sobre el
-- archivo real de octubre, 18 de las 63 filas abarcan más de un día —una va del
-- 24 al 31—, así que sin esta columna ese rango se perdía y la OT decía «El
-- 24/10» cuando en realidad fueron ocho días.
--
-- ES NULLABLE Y ASÍ SE QUEDA. Los 1.400 renglones que entraron por foto no
-- tienen segunda fecha y no es que les falte: es que no existe. `null` acá
-- significa «duró un día», y el código lo lee como `fecha_hasta ?? fecha`, que
-- es exactamente lo que ya hacía antes de que la columna existiera. Ponerle un
-- default igual a `fecha` habría escrito un dato que nadie midió.
--
-- NO SE AGREGA NINGÚN CHECK de que `fecha_hasta >= fecha`. Un rango dado vuelta
-- es un error de quien tipeó la planilla y hay que **mostrárselo**, no rechazar
-- la carga entera: el intérprete lo marca dudoso con su motivo y el renglón
-- entra igual. Un check acá haría fallar el insert de las 63 filas por una.

alter table public.mant_cuadernos_renglones
  add column if not exists fecha_hasta date;

comment on column public.mant_cuadernos_renglones.fecha_hasta is
  'El último día de la tarea, cuando duró más de uno. NULL quiere decir que duró un día: se lee como fecha_hasta ?? fecha. Lo trae la columna «Fecha Hasta» del Excel; los renglones que entran por foto lo dejan en null porque una línea del cuaderno es de un día.';
