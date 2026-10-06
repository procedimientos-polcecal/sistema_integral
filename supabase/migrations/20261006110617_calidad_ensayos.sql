-- ============================================================
-- SdG — Calidad: los ensayos del laboratorio
--
-- Reemplaza "Determinaciones 2026.xlsx": nueve hojas, 623 muestras entre el
-- 06/11/2023 y el 05/10/2026. No es una copia más prolija del archivo, porque
-- medirlo mostró que el problema no era la prolijidad:
--
--   · La columna "Ret #100 (%)" está guardada como fracción con formato de
--     porcentaje hasta marzo de 2026 y como número pelado desde junio. Son 100x
--     de diferencia, y la ÚNICA señal de en qué escala está cada celda es el
--     formato — que no es un dato, es una decoración. 27 filas de Filler 1
--     tienen las dos escalas EN EL MISMO RENGLÓN.
--   · El acumulado no cierra contra sus propias partes en 32 filas.
--   · 162 celdas dicen "no se midió" de seis formas (-, -%, #DIV/0!, vacío…).
--   · El peso volumétrico se calculó con dos recipientes distintos (333,3 cc y
--     330 cc): 1% de diferencia sistemática entre hojas. El real es 330.
--
-- DE AHÍ SALE LA DECISIÓN CENTRAL, Y ESTÁ EN LA FORMA DE ESTAS TABLAS: no se
-- guarda ningún porcentaje. Se guardan los gramos, los ml y los centímetros
-- cúbicos; la humedad, los retenidos, los acumulados y el g/l se despejan al
-- leer, en lib/calidad/ensayos/. Una columna no puede tener dos escalas si no
-- existe como columna. Es la misma regla que el neto de la recepción de
-- carbonilla (bruto − tara) y la producción del turno.
--
-- La única excepción, dicha una vez: calidad_ensayos_limites SÍ guarda números
-- en la unidad de salida —por ciento de 0 a 100, y g/l para el peso
-- volumétrico—. Es el único lugar del módulo donde vive un porcentaje, y por
-- eso no hay con qué confundirlo.
--
-- ESTE FRENTE NO TIENE PLANILLA. Calidad ya espeja dos, y para lados
-- contrarios: en envases manda la planilla, en carbonilla manda el sistema. Acá
-- el SdG es el único lugar, así que no hay sheets_fila ni sheets_pendiente en
-- ninguna de las cuatro tablas. Conviene saberlo antes de tocar una ruta.
--
-- Diseño: docs/superpowers/specs/2026-10-06-calidad-ensayos-design.md
-- Plan:   docs/superpowers/plans/2026-10-06-calidad-ensayos.md
-- ============================================================

-- ── 1. Los tipos ─────────────────────────────────────────────
-- Van en este archivo y no aparte: el 55P04 es sólo para AGREGAR un valor a un
-- enum que ya existe. Estos se crean enteros, igual que los tres de
-- 20260916090409_calidad_schema.sql. El que sí viajó solo fue el valor
-- 'calidad' del enum `modulo`, y ése ya está corrido.

create type calidad_ensayos_grupo as enum ('produccion', 'proceso');

-- 'retenido' y 'acumulado' son dos límites distintos sobre la misma malla, y no
-- uno solo: un retenido de 7% en #200 puede estar bien mientras el acumulado a
-- #200 esté alto, que es justo lo que distingue un problema de molienda de un
-- problema de clasificación.
create type calidad_ensayos_determinacion as enum
  ('humedad', 'peso_volumetrico', 'cal_util_vial', 'retenido', 'acumulado');

-- ── 2. Los productos que se muestrean ────────────────────────
-- NO ES EL CATÁLOGO DEL NÚCLEO, y es deliberado.
--
-- `productos` tiene las 49 cosas físicas que se despachan. Acá "Filler 1" y
-- "Filler 2" son el mismo material visto en dos líneas, y "Despacho a Emapi" no
-- es una cosa: es un destino. Enlazar cualquiera de los dos a un producto del
-- catálogo sería la trampa contra la que avisa todo el sistema —enlazar al que
-- se le parece es peor que dejar en null—, y el síntoma sería que el ensayo de
-- una línea aparece como el de la otra. Eso no se nota nunca.

create table public.calidad_ensayos_productos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  grupo       calidad_ensayos_grupo not null,
  orden       integer not null default 0,
  -- El juego habitual de tamices, que la pantalla de carga propone ya puesto.
  -- Es una propuesta y no una regla: en diez semanas la hoja `Calcio` usó SEIS
  -- juegos distintos, y cada juego nuevo le abrió un bloque de columnas porque
  -- no tenía dónde poner un tamiz que no estuviera previsto.
  mallas      integer[] not null default '{}',
  activo      boolean not null default true
);

-- Que las mallas sean enteros positivos, sin repetir y ordenadas lo valida la
-- ruta (app/api/calidad/ensayos/productos), no un CHECK: comprobarlo acá
-- necesita `unnest`, y un CHECK de Postgres no admite subconsultas. Queda
-- dicho para que nadie lo intente y descubra el error recién al correr la
-- migración.

-- ── 3. Las muestras ──────────────────────────────────────────
-- Una fila por muestra, y las cuatro determinaciones como columnas opcionales:
-- en el archivo hay muestras que son sólo humedad y otras sólo granulometría.
--
-- POR QUÉ COLUMNAS Y NO UNA TABLA GENÉRICA (muestra, tipo, valor1, valor2): una
-- tabla genérica aceptaría una quinta determinación sin migrar, pero a cambio
-- nada ataría `ml_acido` a la cal útil vial, cada lectura sería un pivot, y las
-- funciones puras —que es donde este repo pone lo que importa— perderían los
-- tipos. Con columnas, agregar una quinta determinación es una migración de una
-- línea y el compilador dice dónde falta.

create table public.calidad_ensayos_muestras (
  id                            uuid primary key default gen_random_uuid(),
  fecha                         date not null,
  producto_id                   uuid not null references calidad_ensayos_productos(id) on delete restrict,
  -- Texto libre, igual que en el papel: "retorno", "producción", "silo 3",
  -- "600 Hz 4 agujeros", "9 hs". En el Excel esto vivía en encabezados de
  -- bloques sueltos, que es por qué `Calcio` terminó con once bloques pegados a
  -- la derecha hasta la columna AB.
  observaciones                 text,

  -- Humedad: los tres pesos. El resultado NO se guarda.
  humedad_p_recipiente          numeric(10,2),
  humedad_p_inicial             numeric(10,2),
  humedad_p_final               numeric(10,2),

  -- Peso volumétrico: los gramos y EL RECIPIENTE CON QUE SE MIDIÓ. El volumen
  -- va guardado y no es una constante del código justamente por lo que se midió
  -- arriba: hoy conviven dos recipientes y no hay forma de saber cuál se usó en
  -- las 600 filas donde el número está tipeado a mano.
  peso_vol_gramos               numeric(10,3),
  peso_vol_volumen_cc           numeric(10,2),

  -- Cal útil vial: ml de ácido y peso de la muestra titulada. El peso va
  -- guardado por lo mismo: dejarlo fijo en 3 g haría que el día que se titule
  -- sobre 5 g el número salga mal en silencio.
  cal_util_ml_acido             numeric(10,2),
  cal_util_peso_muestra_g       numeric(10,3),

  -- Granulometría: sobre cuánto se tamizó. Los retenidos van en su tabla.
  granulometria_peso_muestra_g  numeric(10,3),

  cargado_por                   uuid references usuarios(id),
  cargado_en                    timestamptz not null default now(),
  actualizado_por               uuid references usuarios(id),
  actualizado_en                timestamptz,

  -- Lo imposible se frena acá; lo improbable lo marcan los límites, que nacen
  -- vacíos. Un peso inicial de cero o un volumen de cero no son una medición
  -- rara: son una división por cero esperando.
  constraint calidad_ensayos_muestras_p_inicial
    check (humedad_p_inicial is null or humedad_p_inicial > 0),
  constraint calidad_ensayos_muestras_volumen
    check (peso_vol_volumen_cc is null or peso_vol_volumen_cc > 0),
  constraint calidad_ensayos_muestras_peso_titulado
    check (cal_util_peso_muestra_g is null or cal_util_peso_muestra_g > 0),
  constraint calidad_ensayos_muestras_peso_tamizado
    check (granulometria_peso_muestra_g is null or granulometria_peso_muestra_g > 0)
);

-- NO HAY UNIQUE (fecha, producto_id), Y ES A PROPÓSITO.
--
-- Es lo primero que alguien va a querer agregar, así que queda escrito: en la
-- hoja `Cal` hay 29 fechas repetidas, en `Filler 2` 4 y en Kartonsec 4, y casi
-- todas son dos muestras del mismo día, de verdad. Un único rompería el caso
-- bueno para atrapar el malo. El precio —dos filas idénticas, como las 195 y
-- 196 de `Cal`— está asumido y escrito en el spec.

create index calidad_ensayos_muestras_fecha
  on public.calidad_ensayos_muestras (fecha);
create index calidad_ensayos_muestras_producto_fecha
  on public.calidad_ensayos_muestras (producto_id, fecha);

-- ── 4. Los retenidos ─────────────────────────────────────────
-- EN GRAMOS, nunca en por ciento. El porcentaje se despeja contra
-- `granulometria_peso_muestra_g`, así que una muestra tamizada sobre 50 g en
-- vez de 20 sigue dando el número bien sin que nadie haga una cuenta aparte.
--
-- El ORDEN no se guarda: se ordena por malla, que es el orden físico del juego
-- de tamices. Un orden guardado aparte es otro campo que puede quedar viejo.

create table public.calidad_ensayos_retenidos (
  id          uuid primary key default gen_random_uuid(),
  -- `cascade` a propósito: un retenido sin su muestra no es nada.
  muestra_id  uuid not null references calidad_ensayos_muestras(id) on delete cascade,
  malla       integer not null check (malla > 0),
  retenido_g  numeric(10,4) not null check (retenido_g >= 0),

  constraint calidad_ensayos_retenidos_unico unique (muestra_id, malla)
);

create index calidad_ensayos_retenidos_muestra
  on public.calidad_ensayos_retenidos (muestra_id);

-- ── 5. Los límites ───────────────────────────────────────────
-- NACE VACÍA Y MIENTRAS LO ESTÉ EL SISTEMA NO AVISA NADA.
--
-- Es la misma decisión que `produccion_renglones_papel`: la tabla existe desde
-- el primer día y el módulo ya la usa, así que el día que calidad decida los
-- valores no hay que migrar ni volver a tocar las pantallas. Y es visible, no
-- silencioso: la pantalla de límites dice "este producto no tiene límites
-- cargados, así que ninguna muestra se va a marcar".
--
-- Hoy el Excel no tiene ninguno, y se nota: la fila 184 de `Filler 1`
-- (15/09/2026) marca Ret #100 = 15,3% cuando las cincuenta filas que la rodean
-- están entre 1,1 y 5,4 — cinco veces el valor habitual, escrito en negro, sin
-- una nota.

create table public.calidad_ensayos_limites (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid not null references calidad_ensayos_productos(id) on delete cascade,
  determinacion calidad_ensayos_determinacion not null,
  malla         integer check (malla is null or malla > 0),
  -- En la unidad de salida: por ciento de 0 a 100, y g/l para el peso
  -- volumétrico. Ver el encabezado.
  minimo        numeric(10,3),
  maximo        numeric(10,3),

  -- La malla es de la granulometría y de nada más.
  constraint calidad_ensayos_limites_malla check (
    (determinacion in ('retenido', 'acumulado') and malla is not null)
    or (determinacion not in ('retenido', 'acumulado') and malla is null)
  ),
  -- Un límite sin ninguno de los dos extremos no es un límite: es ruido que se
  -- lee como "esto se controla" cuando no se controla nada.
  constraint calidad_ensayos_limites_algo check (minimo is not null or maximo is not null),
  constraint calidad_ensayos_limites_orden check (
    minimo is null or maximo is null or minimo <= maximo
  ),

  constraint calidad_ensayos_limites_unico unique (producto_id, determinacion, malla)
);

-- EL UNIQUE DE ARRIBA NO ALCANZA, y es la trampa de los NULL en Postgres: dos
-- filas con `malla` nula no chocan entre sí, así que no protege a 'humedad',
-- 'peso_volumetrico' ni 'cal_util_vial' — se podrían cargar dos límites de
-- humedad para el mismo producto y el segundo no se aplicaría nunca.
--
-- OJO AL USARLO: este índice es PARCIAL, y un índice parcial NO SIRVE como
-- destino de un ON CONFLICT (trampa 2 del README de migraciones). Por eso las
-- rutas de límites hacen select y después insert o update, y no un upsert.
create unique index calidad_ensayos_limites_sin_malla
  on public.calidad_ensayos_limites (producto_id, determinacion)
  where malla is null;

-- ── 6. RLS ───────────────────────────────────────────────────
-- Calcadas de 20260916090409_calidad_schema.sql. Tienen que decir lo mismo que
-- lib/calidad/auth.ts: cuando no coincidieron, en la 029, un admin_sistema veía
-- los botones y RLS le devolvía listas vacías.
--
-- Productos y límites son configuración: sólo admin. Las muestras las carga
-- quien tiene `edicion`.

alter table public.calidad_ensayos_productos  enable row level security;
alter table public.calidad_ensayos_muestras   enable row level security;
alter table public.calidad_ensayos_retenidos  enable row level security;
alter table public.calidad_ensayos_limites    enable row level security;

create policy calidad_ensayos_productos_leer on public.calidad_ensayos_productos
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_productos_escribir on public.calidad_ensayos_productos
  for all using (es_admin_calidad()) with check (es_admin_calidad());

create policy calidad_ensayos_muestras_leer on public.calidad_ensayos_muestras
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_muestras_escribir on public.calidad_ensayos_muestras
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_ensayos_retenidos_leer on public.calidad_ensayos_retenidos
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_retenidos_escribir on public.calidad_ensayos_retenidos
  for all using (puede_editar_calidad()) with check (puede_editar_calidad());

create policy calidad_ensayos_limites_leer on public.calidad_ensayos_limites
  for select using (tiene_acceso_calidad());
create policy calidad_ensayos_limites_escribir on public.calidad_ensayos_limites
  for all using (es_admin_calidad()) with check (es_admin_calidad());

-- ── 7. La siembra ────────────────────────────────────────────
-- Los ocho de producción son los que el usuario cerró como la identidad de una
-- muestra. Los diez de proceso salieron de las hojas `Otros` y `Calcio`, donde
-- hoy se escriben con más nombres que materiales ("Caliza galpón" y "Caliza
-- Galpones", "Arena caliza P3 limpia" y "Arena limpia") — que es exactamente lo
-- que una lista cerrada deja de producir.
--
-- Las mallas de los ocho salen de sus hojas. Las de proceso quedan vacías a
-- propósito: en diez semanas hubo seis juegos distintos y la lista la decide
-- calidad, renglón por renglón. Mientras estén vacías la pantalla lo dice
-- ("sin juego habitual") y se cargan a mano en la muestra.

insert into public.calidad_ensayos_productos (nombre, grupo, orden, mallas) values
  ('Filler 1',                   'produccion',  1, '{50,100,200,325}'),
  ('Filler 2',                   'produccion',  2, '{50,100,200,325}'),
  ('Cal',                        'produccion',  3, '{50,100,200,325}'),
  ('Calcio 0-1',                 'produccion',  4, '{6,7,10,12,20,50,100,200}'),
  ('Calcio 0-2',                 'produccion',  5, '{6,7,10,12,20,50,100,200}'),
  ('Calcio 1-2',                 'produccion',  6, '{6,7,10,12,20,50,100,200}'),
  ('Despacho a Emapi',           'produccion',  7, '{50,100,200,325}'),
  ('Despacho a Kartonsec',       'produccion',  8, '{50,100,200,325}'),
  ('Caliza galpón',              'proceso',    20, '{}'),
  ('Arena dolomita P1',          'proceso',    21, '{}'),
  ('Arena caliza P3 limpia',     'proceso',    22, '{}'),
  ('Arena caliza P3 descarte',   'proceso',    23, '{}'),
  ('Acopio',                     'proceso',    24, '{}'),
  ('Chocolata galpón',           'proceso',    25, '{}'),
  ('Chocolata 0-2',              'proceso',    26, '{}'),
  ('Dolomita 0-2',               'proceso',    27, '{}'),
  ('Dolomita 6-20 P1',           'proceso',    28, '{}'),
  ('P3 chocolata',               'proceso',    29, '{}');
