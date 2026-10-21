-- ============================================================
-- SdG — Mantenimiento: un aviso que no va a ser orden de trabajo
--
-- Hasta hoy un aviso tenía dos finales posibles: convertirse en OT, o quedar
-- pendiente para siempre. El tercero —«esto no corresponde»— no existía, así
-- que la lista de «sin orden de trabajo» mezcla lo que falta hacer con lo que
-- ya se decidió no hacer, y nadie sabe cuál es cuál.
--
-- Medido el 21/10/2026: de 183 avisos, 5 están sin OT, y dos de ellos son de
-- julio y septiembre. Llevan meses ahí sin que se sepa si alguien los miró.
--
-- Y la práctica ya venía inventando el lugar: la columna `OT ASIGNADA` de la
-- planilla —que es texto libre— tiene 3 avisos con «Revision», 2 con «-» y
-- uno con «RI 1888». O sea que esto se viene haciendo a mano, en la columna
-- que no es, y sin decir por qué.
--
-- ── POR QUÉ UNA COLUMNA Y NO UN ESTADO ──────────────────────────────────────
--
-- `avisos` no tiene columna de estado: lo que un aviso es se deduce de si
-- tiene OT. Agregar un enum ahora obligaría a decidir el estado de los 183 que
-- ya existen, y de la mayoría no se sabe. Tres columnas que están en null
-- hasta que alguien decida dicen exactamente lo que se sabe.
--
-- ── EL MOTIVO NO ES OPCIONAL, Y ÉSE ES EL PUNTO ─────────────────────────────
--
-- Un aviso desestimado sin motivo es lo mismo que un aviso ignorado, sólo que
-- además parece resuelto. Lo exige la aplicación —`lib/mantenimiento/
-- desestimarAviso.ts`— y acá va el `check` que lo sostiene: las tres columnas
-- viajan juntas o ninguna.
-- ============================================================

alter table public.avisos
  add column if not exists desestimado_en     timestamptz,
  add column if not exists desestimado_por    uuid references public.usuarios(id) on delete set null,
  add column if not exists motivo_desestimado text;

comment on column public.avisos.motivo_desestimado is
  'Por qué este aviso no va a ser una orden de trabajo. Obligatorio al desestimar: sin él, un aviso desestimado se lee igual que uno ignorado pero además parece resuelto.';

comment on column public.avisos.desestimado_en is
  'Cuándo se decidió. NULL es que nadie lo decidió todavía, que NO es lo mismo que "va a hacerse".';

-- Las tres juntas o ninguna. Sin esto, un update parcial —o un script— deja un
-- aviso desestimado sin motivo y sin responsable, que es justo lo que esta
-- función viene a evitar.
alter table public.avisos
  drop constraint if exists avisos_desestimado_completo;

alter table public.avisos
  add constraint avisos_desestimado_completo check (
    (desestimado_en is null and motivo_desestimado is null)
    or
    (desestimado_en is not null and nullif(btrim(motivo_desestimado), '') is not null)
  );

-- Son un puñado contra 183 filas, y la pregunta que se hace la pantalla es
-- «cuáles están desestimados».
create index if not exists avisos_desestimado_idx
  on public.avisos (desestimado_en)
  where desestimado_en is not null;
