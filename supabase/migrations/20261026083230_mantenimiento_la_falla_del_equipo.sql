-- ============================================================
-- SdG — Mantenimiento: la falla que tuvo el equipo
--
-- Una OT cuenta **qué se hizo** y nunca **por qué falló la máquina**. "Cambio
-- de eje" no dice si el eje se rompió por fricción, por un golpe o porque nunca
-- se lubricó. Desde ahora, al dar una orden por realizada se puede anotar la
-- falla, y la ficha del equipo muestra cuál se repite.
-- El diseño completo está en
-- docs/superpowers/specs/2026-10-26-mantenimiento-falla-del-equipo-design.md.
--
-- ── POR QUÉ SON NULAS, Y SE QUEDAN NULAS ────────────────────────────────────
--
-- Porque la causa no está escrita en ningún lado. De las 2.264 OT del
-- 26/10/2026, 976 son correctivas; sólo 99 nombran en la descripción qué le
-- pasó a la pieza y **ninguna** nombra la causa — las 40 que lo parecían dicen
-- "se repuso térmico" o "se cambia contactor", que es otra vez el trabajo.
-- No hay de dónde sacarla, y deducirla de la descripción sería inventar un dato
-- que nadie midió: esto empieza a juntar información desde cero.
--
-- ── POR QUÉ NO LLEVAN `check` NI ENUM ───────────────────────────────────────
--
-- El vocabulario —ocho modos y ocho causas— se va a tocar: la primera lista que
-- usa una planta nunca es la última. Un valor de enum nuevo necesita su propia
-- migración y tiene que viajar solo (55P04), y un `check` obliga a una
-- migración por cada palabra que alguien quiera agregar.
--
-- Lo que **no** se negocia es que la aplicación no acepte texto arbitrario: la
-- validación vive en lib/mantenimiento/fallas.ts (`esquemaFalla`, con zod) y la
-- ruta de órdenes rechaza con 400 lo que no esté en la lista. Sin eso vuelve el
-- texto libre por la ventana y el conteo se muere en silencio — que es
-- exactamente lo que estas dos listas existen para evitar.
--
-- ── LO QUE PASA SOLO ────────────────────────────────────────────────────────
--
-- * La sincronización **no las pisa**: arma su `upsert` desde lo que lee de la
--   planilla y nunca nombra estas columnas, así que `ON CONFLICT DO UPDATE` no
--   las toca. Es lo mismo que ya se verificó para las tres del GUT.
-- * El borrado de espejo **sí** se las lleva: si la fila desaparece de la
--   planilla, la OT se borra y su falla con ella. Es lo correcto — esa orden ya
--   no existe.
-- * La falla **no viaja a la planilla**. Riesgo asumido y no olvido, igual que
--   el GUT: exportarla sería escribir en el libro que está por darse vuelta.
-- * El día que alguien regenere lib/asistente/catalogo.generado.json, estas
--   tres entran solas y el asistente puede contestar "qué falla se repite más"
--   sin que exista ninguna pantalla nueva. Es lo buscado.
-- ============================================================

alter table public.ordenes_trabajo
  add column if not exists falla_modo    text,
  add column if not exists falla_causa   text,
  add column if not exists falla_detalle text;

comment on column public.ordenes_trabajo.falla_modo is
  'Qué le pasó a la pieza. Una de las claves de MODOS_DE_FALLA (lib/mantenimiento/fallas.ts). Nulo: no se anotó.';
comment on column public.ordenes_trabajo.falla_causa is
  'Por qué le pasó. Una de las claves de CAUSAS_DE_FALLA (lib/mantenimiento/fallas.ts). Nulo: no se anotó.';
comment on column public.ordenes_trabajo.falla_detalle is
  'Lo que las dos listas no pueden decir: qué pieza y de qué lado. Texto libre, nulo si no se escribió.';
