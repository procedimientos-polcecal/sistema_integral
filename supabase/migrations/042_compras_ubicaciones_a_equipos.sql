-- ============================================================
-- SdG — Las ubicaciones de Compras son equipos y sectores de Mantenimiento
--
-- La 017 lo dejó escrito antes de que Compras existiera en producción: "varias
-- ubicaciones de la planilla son equipos del módulo Mantenimiento (CAT 950G,
-- Doosan 225 n°1), así que enlazarlas permite ver cuánto se gastó por máquina".
-- La 019 movió el enlace del requerimiento al catálogo —38 filas en vez de
-- 1.825— y lo dejó en null hasta que existieran "los sectores físicos y la
-- flota real".
--
-- Las dos condiciones se cumplieron: la 033 separó los 15 sectores de planta y
-- la importación del libro cargó 239 equipos. Las 38 ubicaciones seguían en
-- cero.
--
-- El emparejamiento lo hizo una persona mirando la marca y el modelo de cada
-- máquina. Esto **registra una decisión humana**, no la deduce: es la
-- diferencia con lo que la 032 rechazó para proveedores cuando escribió que
-- dejarlo en null es más honesto que enlazarlo al que se le parece.
--
-- Se enlaza por nombre y no por id, para que corra en cualquier copia de la
-- base, y sólo donde el enlace está en null, para que se pueda repetir sin
-- pisar una corrección hecha a mano después.
-- ============================================================

-- ── 1. Las que son una máquina ───────────────────────────────
--
-- Compras las nombra por marca y modelo —"Doosan 225 n°1"—; Mantenimiento por
-- función y número —"Retroexcavadora 3"—. No comparten una sola palabra: lo que
-- las une es `marca` y `modelo` de la ficha técnica.
--
-- Cuatro van por CONVENCIÓN y no por dato: las dos Doosan 225 tienen modelos
-- exactos distintos que la planilla no menciona (DX 225 CLK y DX225CLA-7M), y
-- los dos Autoelevadores Toyota son idénticos hasta en el número de serie. La
-- regla es n°1 = el código de equipo más bajo. Si están cruzadas, el gasto de
-- una cae en su gemela y nada lo denuncia; son ~60 RI y se corrige desde la
-- pantalla.
--
-- `Autoelevador HCMG` es el tipeo de `XCMG` que arrastra la planilla. Apunta al
-- mismo equipo, así que sus 2 RI caen igual en la máquina correcta y no hace
-- falta fusionar nada.

with mapa (ubicacion, equipo_code) as (values
  ('CAT 320B',                 'EM1'),   -- Caterpillar 320 B
  ('CAT 320C',                 'EM2'),   -- Caterpillar 320 C
  ('Doosan 225 n°1',           'EM3'),   -- Doosan 225 — convención
  ('Doosan 225 n°2',           'EM4'),   -- Doosan 225 — convención
  ('Doosan 300',               'EM5'),   -- Doosan SD 300
  ('CAT 950G',                 'EM6'),   -- Caterpillar 950 G
  ('Liu Gong 856H',            'EM7'),   -- Liu Gong 856 H
  ('Scania 420 4x4 (2004)',    'EM8'),   -- Scania 420 4x4
  ('Scania 420 8x4 (2011)',    'EM9'),   -- Scania 420 8x4
  ('Autoelevador Toyota n°1',  'EM10'),  -- Toyota 628FD25 — convención
  ('Autoelevador Toyota n°2',  'EM11'),  -- Toyota 628FD25 — convención
  ('Autoelevador XCMG',        'EM12'),  -- XCMG XCBDT25
  ('Autoelevador HCMG',        'EM12'),  -- el mismo, con el tipeo de la planilla
  ('Regador',                  'EM15'),  -- Mercedes Benz 1114
  ('Amarok',                   'EM16')   -- modelo Amarok
)
update compras_ubicaciones u
set equipo_id = e.id,
    sector_id = null,   -- el sector sale del equipo; tenerlo además se contradice
    -- 16 ubicaciones nacieron sin tipo —las creó la sincronización al ver un
    -- nombre nuevo en la planilla— y se muestran como "Otra". 15 son estos
    -- equipos móviles; la que sobra se corrige abajo.
    tipo = 'equipo'
from mapa m
join equipos e on e.code = m.equipo_code
where u.nombre = m.ubicacion
  and u.equipo_id is null;

-- ── 2. Las que son un sector de planta ───────────────────────
--
-- Las moliendas van al sector y no a una máquina porque no existe ningún equipo
-- llamado "Molienda": el molino es una máquina adentro del sector
-- (PY-A1-08 Molino de bolas, PY-B1-09 Molino vertical). Que dos ubicaciones
-- caigan en el mismo sector no es un problema: el gasto se agrega igual.

with mapa (ubicacion, sector_codigo) as (values
  ('Planta de trituración 1',  'PO-A1'),
  ('Planta de trituración 2',  'PO-A2'),
  ('Planta de trituración 3',  'PO-A3'),
  ('Calcinación',              'PO-B1'),
  ('Hidratación',              'PO-C1'),
  ('Molienda de cal',          'PO-D1'),
  ('Compresores',              'AMB-C1'),
  ('Planta Filler 1',          'PY-A1'),
  ('Molienda filler 1',        'PY-A1'),
  ('Planta Filler 2',          'PY-B1'),
  ('Molienda filler 2',        'PY-B1'),
  ('Planta 0-2mm',             'PY-C1'),
  ('Molienda 0-2mm',           'PY-C1')
)
update compras_ubicaciones u
set sector_id = s.id
from mapa m
join sectores s on s.codigo = m.sector_codigo and s.es_de_planta
where u.nombre = m.ubicacion
  and u.sector_id is null
  and u.equipo_id is null;

-- ── 3. Las que no se enlazan, y por qué ──────────────────────
--
-- Pañol (306 RI), Taller Eléctrico (150), Taller de mantenimiento (145), OTRA
-- (115), Oficinas (89), Taller de equipos móviles (37), Cantera (36),
-- Laboratorio (23) y Vigilancia (8) quedan en null a propósito: no son una
-- máquina ni un sector de planta, son depósitos y lugares de trabajo. Casi la
-- mitad del gasto no se atribuye a nada, y eso es un hecho del negocio —lo que
-- entra al pañol es stock, no es de nadie todavía—, no una falla del mapeo.
--
-- Cantera es la única que duele: tiene 36 RI y es un lugar real, pero no está
-- entre los 15 sectores de planta de BD Equipos y no tiene equipos cargados.
-- Inventarle un sector sin código dejaría un sector de planta que la próxima
-- importación del libro no reconoce.

-- ── 4. La que quedó sin tipo ─────────────────────────────────
--
-- `Taller Eléctrico` lo creó la sincronización desde el histórico y nunca tuvo
-- tipo, así que con sus 150 RI se muestra como "Otra". No se enlaza a nada
-- —un taller no es una máquina ni un sector de planta— pero es un taller.
--
-- Convive con `Taller eléctrico` (0 RI, el de la semilla de la 019) porque el
-- unique del nombre distingue mayúsculas. No se fusionan: ninguno de los dos se
-- enlaza, así que tenerlos separados no parte el gasto de ninguna máquina.

update compras_ubicaciones
set tipo = 'taller'
where nombre in ('Taller Eléctrico', 'Taller eléctrico')
  and tipo is null;

comment on column compras_ubicaciones.equipo_id is
  'La máquina de Mantenimiento, cuando la ubicación es una. Lo decide una persona: Compras nombra por marca y modelo, Mantenimiento por función y número.';
comment on column compras_ubicaciones.sector_id is
  'El sector de planta, cuando la ubicación es un lugar y no una máquina. Sólo sectores con es_de_planta.';
