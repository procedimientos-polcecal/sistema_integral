-- ============================================================
-- SdG — La fecha del kardex es un día, no un instante
--
-- SÍNTOMA: "la sincronización no me trae el día de ayer". Y sí lo trae: los
-- movimientos del 2/9 están en la tabla, pero la pantalla los muestra como del
-- 1/9, así que el último día que se ve es siempre el anterior al último día que
-- entró.
--
-- LA CAUSA. La 046 declaró `fecha timestamptz`, y la planilla no trae un
-- instante: trae un día. El parser devuelve "2026-09-02" y Postgres lo guarda
-- como 2026-09-02T00:00:00Z — medianoche **UTC**. En Argentina, UTC-3, esa
-- medianoche es el 1/9 a las 21:00, y `toLocaleDateString("es-AR")` la muestra
-- como 1/9/2026. Los 3.830 movimientos del kardex están corridos un día.
--
-- Y en la otra dirección duele igual. Un movimiento cargado en la app tomaba
-- `now()` como fecha, así que uno registrado a las 21:30 de un martes se
-- escribía en la planilla con la fecha del miércoles: el mismo error, pero
-- estampado en el documento que la gente del pañol lee y que nosotros no
-- controlamos.
--
-- LA DECISIÓN. La columna pasa a `date`. Un movimiento del kardex ocurre en un
-- día de calendario y nada más —la planilla no tiene hora en ninguna parte—, y
-- una `date` no tiene huso que la corra. El instante no se pierde:
-- `created_at` ya guarda cuándo se registró la fila, que es otra cosa y sigue
-- siendo un timestamptz.
--
-- Es además la forma que el resto del sistema ya usa. `lib/core/fechas.ts` lo
-- deja escrito: los días viajan como texto "YYYY-MM-DD", que es como Postgres
-- guarda una `date`, y por eso las fechas de Compras no tienen este problema.
--
-- LA CONVERSIÓN. Las 3.830 filas existentes son todas de la planilla y todas
-- están en medianoche UTC, así que `at time zone 'UTC'` recupera exactamente el
-- día que decía la celda. Sin ese `at time zone`, el cast usaría el huso de la
-- sesión y correría un día las mismas filas que esto viene a arreglar.
-- ============================================================

alter table inventario_movimientos
  alter column fecha type date
  using (fecha at time zone 'UTC')::date;

-- El default es para los movimientos que se cargan en la app, que no pasan
-- fecha. `current_date` sería el día en el huso del servidor —UTC en Vercel y
-- en Supabase—, o sea que a partir de las 21:00 de Argentina empezaría a
-- fechar todo en el día siguiente. Se resta el offset a mano, fijo, igual que
-- `lib/core/fechas.ts`: Argentina es UTC-3 todo el año desde 2009, y hacerlo
-- así no depende de qué tzdata tenga la base ni de dónde quedó desplegada la
-- función.
alter table inventario_movimientos
  alter column fecha set default (now() - interval '3 hours')::date;

comment on column inventario_movimientos.fecha is
  'El día en que se movió, sin hora: la planilla no la tiene. date y no timestamptz porque una medianoche UTC se lee como el día anterior desde Argentina y corría los 3.830 movimientos un día. NULL cuando el kardex no dice cuándo: es "no se sabe", no "hoy". El instante en que se registró la fila está en created_at.';
