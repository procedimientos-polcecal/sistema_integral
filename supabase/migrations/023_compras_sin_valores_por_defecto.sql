-- ============================================================
-- SdG — Compras: prioridad y quién paga arrancan sin definir
--
-- Los definía el sistema al dar de alta: NORMAL y Ambas. Pero esas dos cosas
-- las decide gerencia al aprobar, así que ponerlas de antemano es disfrazar de
-- dato una decisión que todavía no se tomó — y encima una que después nadie
-- revisa, porque ya "tiene valor".
--
-- Ahora nacen vacías y se muestran como "—" hasta que alguien las define.
--
-- El problema a resolver: hasta acá `empresa_id = null` quería decir "Ambas", y
-- eso son 760 requerimientos. Si null pasa a significar "sin definir", los dos
-- casos se confunden. Se separa con un booleano, igual que
-- `sectores.transversal` resuelve el "AMBOS" de Mantenimiento:
--
--   empresa_id no nulo                  → esa empresa
--   empresa_id nulo + paga_ambas true   → Ambas
--   empresa_id nulo + paga_ambas false  → sin definir
-- ============================================================

alter table compras_requerimientos
  add column if not exists paga_ambas boolean not null default false;

comment on column compras_requerimientos.paga_ambas is
  'true = lo pagan las dos empresas. Con empresa_id nulo y esto en false, todavía no se definió.';

-- Los que ya existen con empresa_id nulo SÍ son "Ambas": así lo decía la
-- planilla y así se importaron. Se marcan antes de cambiar el significado.
update compras_requerimientos
set paga_ambas = true
where empresa_id is null
  and paga_ambas = false;

-- No puede ser de una empresa y de las dos a la vez.
alter table compras_requerimientos
  drop constraint if exists compras_req_paga_coherente;
alter table compras_requerimientos
  add constraint compras_req_paga_coherente
  check (not (empresa_id is not null and paga_ambas));

-- La prioridad deja de tener valor por defecto y puede quedar sin definir.
alter table compras_requerimientos
  alter column prioridad drop default,
  alter column prioridad drop not null;

comment on column compras_requerimientos.prioridad is
  'La define quien aprueba. NULL mientras no se haya decidido.';
