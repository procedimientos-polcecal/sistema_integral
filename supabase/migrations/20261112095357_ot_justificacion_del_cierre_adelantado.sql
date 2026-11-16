-- ============================================================
-- SdG — OT: justificación del cierre adelantado
--
-- Una OT puede quedar con la fecha de cierre anterior a la de inicio, y hasta
-- ahora nada lo explicaba. Medido el 12/11/2026 sobre las 2.176 OT: **66 ya
-- tienen el cierre antes del inicio** —44 PROGRAMADO y 22 CORRECTIVO—, con una
-- mediana de 2 días de adelanto, y **sólo 3 entraron por la app**: las otras 63
-- vienen de la planilla, donde nadie pedía una razón.
--
-- La función nueva deja cerrar así pero exige decir por qué, y ese texto
-- necesita un lugar donde vivir: esta columna.
--
-- DECISIONES
--
-- Sin `not null` y sin default: lo normal es que esté vacía, porque casi
-- ninguna OT se cierra antes de empezar.
--
-- Las 66 que ya existen quedan en null a propósito. Nadie escribió esa
-- justificación, y dejarlo en null dice la verdad; inventarla o rellenarla con
-- un texto genérico haría parecer explicado algo que no lo está.
--
-- Sin índice: nada filtra ni ordena por ella.
--
-- ORDEN DE DESPLIEGUE
--
-- Esta migración se corre ANTES de desplegar el código. Si el alta empieza a
-- mandar `cierre_justificacion` y la columna no existe, el `insert` se corta
-- entero con el 400 de PostgREST —el mismo que dio `estado_raw` el
-- 29/10/2026— y deja de poder crearse una OT.
--
-- Se puede correr dos veces: `if not exists`.
-- ============================================================

alter table public.ordenes_trabajo
  add column if not exists cierre_justificacion text;

comment on column public.ordenes_trabajo.cierre_justificacion is
  'Por qué la OT se cerró con fecha anterior a la de inicio. Se exige al cerrar así y está vacía en el resto; las 66 anteriores a la columna quedan en null.';
