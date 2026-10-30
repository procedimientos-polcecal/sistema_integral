-- ============================================================
-- SdG — Calidad: el histórico de determinaciones, de sólo lectura
--
-- Los tres años de laboratorio de `Determinaciones 2026.xlsx` — nueve hojas,
-- 3.685 valores entre el 06/11/2023 y el 21/10/2026. Calidad los consulta
-- cuando un cliente reclama, y hoy eso obliga a abrir el archivo y saber en qué
-- hoja mirar.
--
-- Diseño: docs/superpowers/specs/2026-10-29-calidad-historico-de-determinaciones-design.md
--
-- LA DECISIÓN CENTRAL ESTÁ EN LA FORMA DE ESTA TABLA, Y ES QUE NO TRANSFORMA
-- NADA. `valor` guarda el número **tal como está escrito en la planilla**.
--
-- El 02/06/2026 Calidad cambió de planilla y con ella la forma de anotar: antes
-- los retenidos y acumulados iban como fracción (0,19) y desde entonces como
-- porcentaje (19). La tentación es convertir al importar. No se hace, porque no
-- se puede probar: la comprobación que lo justificaría —el acumulado tiene que
-- dar la suma de sus retenidos— necesita dos retenidos en la fila, y antes del
-- corte casi no se medían. De 362 filas anteriores al cambio, la aritmética
-- alcanza a 27, y a ninguna de `Cal` ni de `Filler 2`.
--
-- Por eso la inferencia vive en `escala` y no en el dato: si la etiqueta se
-- equivoca, el número sigue siendo el que alguien escribió, y se corrige con un
-- update sin reimportar. El spec de Ensayos había dejado el histórico afuera
-- justamente para no inventarle una escala a 900 celdas; esto lo acata.
-- ============================================================

create table if not exists public.calidad_historico_determinaciones (
  id            uuid primary key default gen_random_uuid(),

  fecha         date not null,
  -- De qué pestaña salió, literal. Sirve para filtrar `Despachos cal
  -- fillerizada`, que no es un ensayo y entra igual porque se pidió todo.
  hoja          text not null,
  -- Lo que decía la planilla: un producto, un cliente o un nombre de muestra.
  -- Siempre se guarda, aunque se lo reconozca: es lo que permite buscar por
  -- "Marcalba" o por "Retorno A (1)", que no son productos de ningún catálogo.
  origen_raw    text not null,
  -- El producto de Ensayos, cuando el nombre coincide EXACTO. Null si no.
  -- Enlazar al que se le parece es peor que dejar en null, y acá el dato se usa
  -- para contestarle a un cliente. Medido: 7 de 55 orígenes enlazan, y esos 7
  -- cubren las cinco hojas tabulares.
  producto_id   uuid references public.calidad_ensayos_productos(id) on delete set null,

  determinacion text not null,
  -- Despejada de la etiqueta cuando la hay: "Acumulado en #200 (%)" → 200.
  malla         integer check (malla is null or malla > 0),

  -- SIN TRANSFORMAR. Ver el encabezado.
  valor         numeric not null,
  -- La lectura del sistema, no una propiedad del número:
  --   fraccion   → 0,19 quiere decir 19%
  --   porcentaje → 19 quiere decir 19%
  --   absoluto   → g/l, toneladas, gramos: no es un porcentaje
  escala        text not null check (escala in ('fraccion', 'porcentaje', 'absoluto')),
  unidad        text,

  -- Por qué hay que mirar esta fila. Hoy sólo lo escribe la comprobación
  -- aritmética: 28 filas del libro tienen un acumulado que no da la suma de sus
  -- retenidos. Entran como están y quedan marcadas — corregirlas sería
  -- interpretar.
  revisar       text,

  fila_excel    integer not null,
  created_at    timestamptz not null default now()
);

-- La celda del Excel de la que salió cada fila, y la defensa contra el único
-- accidente que esta tabla puede sufrir: **volver a importar**.
--
-- El importador lee un archivo entero, así que correrlo dos veces —y se corrió
-- varias mientras se afinaba el parseo— dejaba cada valor duplicado y la
-- pantalla se los mostraba repetidos a quien contesta un reclamo. El script
-- ahora borra antes de insertar; esto es lo que lo hace imposible igual.
--
-- Las cinco columnas son lo que ubica una celda: la hoja y la fila la
-- encuentran, la determinación es la columna, y la fecha y el origen separan
-- los bloques, donde una misma fila del Excel lleva varias muestras de costado.
-- No es parcial, a propósito: un índice parcial no sirve de destino de un
-- `ON CONFLICT` (en este repo ya pasó tres veces).
create unique index if not exists calidad_historico_celda_uq
  on public.calidad_historico_determinaciones
     (hoja, fila_excel, determinacion, fecha, origen_raw);

create index if not exists calidad_historico_fecha_idx
  on public.calidad_historico_determinaciones (fecha desc);
create index if not exists calidad_historico_producto_idx
  on public.calidad_historico_determinaciones (producto_id);
create index if not exists calidad_historico_hoja_fecha_idx
  on public.calidad_historico_determinaciones (hoja, fecha desc);
create index if not exists calidad_historico_revisar_idx
  on public.calidad_historico_determinaciones (fecha)
  where revisar is not null;

comment on table public.calidad_historico_determinaciones is
  'El histórico del laboratorio, de sólo lectura. `valor` está SIN TRANSFORMAR: es lo que dice la planilla, y `escala` es cómo hay que leerlo.';
comment on column public.calidad_historico_determinaciones.escala is
  'La lectura del sistema, no una propiedad del número. Una etiqueta equivocada se corrige con un update: el dato no se tocó.';
comment on column public.calidad_historico_determinaciones.producto_id is
  'El producto de Ensayos cuando el nombre coincide exacto. Null si no — enlazar al que se le parece pone el dato en el lugar que no es.';

-- ── RLS: se lee, no se escribe ───────────────────────────────
--
-- Sólo `select`. No hay policy de insert, update ni delete: el histórico es
-- memoria, y lo nuevo se carga en Ensayos.
--
-- Y SIN TRIGGER, a diferencia de `auditoria`. Ahí el trigger existe porque el
-- cliente de servicio ignora las policies y un registro de auditoría tiene que
-- ser inmutable incluso para la aplicación. Acá es al revés: la carga la hace
-- un importador con el cliente de servicio, y **una importación equivocada
-- tiene que poder rehacerse**. Un trigger la dejaría escrita para siempre.
-- La inmutabilidad acá protege de la app, no del importador.
--
-- La función va envuelta en un subselect: Postgres evalúa el USING una vez por
-- fila aunque la función sea STABLE, y el subselect lo convierte en un InitPlan
-- que corre una sola vez. Son 3.685 filas que se filtran por texto.

alter table public.calidad_historico_determinaciones enable row level security;

drop policy if exists calidad_historico_leer on public.calidad_historico_determinaciones;
create policy calidad_historico_leer on public.calidad_historico_determinaciones
  for select using ((select public.tiene_acceso_calidad()));
