-- ============================================================
-- El monto que se sabe de un requerimiento, y la marca de "es caro"
-- ============================================================
-- Hace falta distinguir los RI de monto alto para mirarlos con más cuidado y
-- para poder filtrarlos. El problema es CUÁNDO se sabe el monto, y eso se midió
-- el 19/10/2026 sobre los 2.159 requerimientos:
--
--   estado_compra      total  con costo_iva  con presupuesto  sin nada
--   SIN_INICIAR            72             0                3        69
--   EN_COMPARATIVA         20             0               13         7
--   PARA_COMPRAR            8             0                4         4
--   APROBADO               40             1               11        29
--   PEDIDO                299           210               89        85
--   RECIBIDO             1646          1564              906        42
--
-- El costo real NO EXISTE hasta que se compró: cero en SIN_INICIAR, cero en
-- comparativa, uno de cuarenta en APROBADO. Y los 11 RI que hoy esperan la
-- aprobación de gerencia no tienen ningún monto, ninguno.
--
-- Por eso hacen falta las dos mitades, y no son dos formas de hacer lo mismo:
-- cubren momentos distintos del circuito. El automático es exacto pero llega
-- tarde; el manual llega a tiempo pero depende de que alguien sepa.
--
-- ── POR QUÉ SE GUARDA EL MONTO Y NO UN BOOLEANO ─────────────
--
-- Guardar "es alto" obligaría a recalcular las 2.159 filas cada vez que se
-- mueva el umbral, y con la inflación de acá ese número se mueve. Guardando el
-- monto, cambiar el umbral es cambiar una pregunta, no 2.159 respuestas.
--
-- ── POR QUÉ UN TRIGGER Y NO LAS RUTAS ───────────────────────
--
-- Hay cinco lugares que pueden cambiar un costo o una cotización: el PATCH del
-- requerimiento, las dos rutas de comparativa, la de elegir presupuesto y la
-- importación de la planilla. Es la misma razón que ya está escrita para
-- `compras_marcar_editado_en_app`: vive en la base para que no dependa de que
-- una ruta se acuerde.

-- ── El umbral ───────────────────────────────────────────────
-- Una sola fila. El `check (id)` es el truco de siempre para que no pueda
-- haber una segunda: dos filas de configuración son dos respuestas distintas a
-- la misma pregunta.
create table if not exists public.compras_ajustes (
  id boolean primary key default true check (id),
  -- Arranca en 1.500.000, que sobre los datos de hoy cae en el percentil 91:
  -- la mediana de lo comprado es 75.504 y el p99 es 13.661.437, así que separa
  -- bien. Se edita en /compras/configuracion; no es una constante del código
  -- justamente porque es un número que envejece.
  umbral_monto_alto numeric not null default 1500000,
  actualizado_en timestamptz not null default now()
);

insert into public.compras_ajustes (id) values (true) on conflict (id) do nothing;

alter table public.compras_ajustes enable row level security;

-- La lee cualquiera que entre a Compras: el umbral decide qué se le muestra
-- marcado. La cambia sólo un admin.
drop policy if exists compras_ajustes_select on public.compras_ajustes;
create policy compras_ajustes_select on public.compras_ajustes
  for select to authenticated
  using ((select public.tiene_acceso_compras()));

drop policy if exists compras_ajustes_write on public.compras_ajustes;
create policy compras_ajustes_write on public.compras_ajustes
  for all to authenticated
  using ((select public.es_admin()))
  with check ((select public.es_admin()));

-- ── Las dos columnas del requerimiento ──────────────────────
alter table public.compras_requerimientos
  -- El monto que se SEPA: el costo si está cargado, y si no el presupuesto más
  -- alto. Null es "todavía no hay ningún número", que hoy son 69 RI sin
  -- iniciar y los 11 que esperan aprobación.
  --
  -- Es `costo_iva + costo_envio` porque `costo_iva` es el total de la compra
  -- —no el unitario: `precioDesdeElRequerimiento` lo divide por la cantidad
  -- para sacar el precio de la unidad— y el envío se paga igual.
  add column if not exists monto_conocido numeric,
  -- La decisión de una persona, que le gana al automático EN LOS DOS SENTIDOS:
  -- `true` marca un RI que todavía no tiene número, `false` desmarca una compra
  -- grande pero rutinaria —30.000 bolsas— para que no haga ruido para siempre.
  -- `null` es "no opinó nadie, manda el monto".
  add column if not exists monto_alto_manual boolean;

comment on column public.compras_requerimientos.monto_conocido is
  'El monto que se sabe: costo_iva + costo_envio si está comprado, si no el presupuesto en pesos más alto. Lo mantiene un trigger. Null = todavía no hay ningún número.';

-- El filtro del listado pregunta por esto y el listado pagina en el servidor,
-- así que no alcanza con calcularlo al mostrar. Parcial: las filas sin monto no
-- se buscan nunca por monto.
create index if not exists compras_requerimientos_monto_conocido_idx
  on public.compras_requerimientos (monto_conocido)
  where monto_conocido is not null;

create index if not exists compras_requerimientos_monto_alto_manual_idx
  on public.compras_requerimientos (monto_alto_manual)
  where monto_alto_manual is not null;

-- ── El cálculo, en un solo lugar ────────────────────────────
--
-- RIESGO ASUMIDO: una cotización en DÓLARES no se cuenta. El trigger no puede
-- convertirla porque el dólar del día no está en la base, y `totalEnPesos()`
-- vive en el código. Medido hoy: hay UNA sola cotización en USD y es de 350,9,
-- así que no se pierde nada — pero una de 10.000 USD pasaría desapercibida y
-- el RI quedaría sin marcar. Si eso empieza a pasar, la salida es guardar el
-- total en pesos congelado en la cotización, no convertir acá.
--
-- RIESGO ASUMIDO 2: se mira el presupuesto MÁS ALTO y no el más bajo. Medido:
-- de los 1.028 RI con presupuestos, NINGUNO cruza el umbral —74 tienen todos
-- por encima y 954 todos por debajo—, así que hoy la elección no tiene
-- consecuencia. Se elige el máximo porque avisar de más es mejor que avisar de
-- menos; el día que alguien cargue un presupuesto de 2.000.000 y otro de
-- 200.000 para el mismo pedido, esto va a marcar el RI y hay que saber por qué.
create or replace function public.compras_monto_que_se_sabe(
  p_requerimiento uuid,
  p_costo_iva numeric,
  p_costo_envio numeric
)
returns numeric
language sql
stable
as $$
  select case
    when p_costo_iva is not null then p_costo_iva + coalesce(p_costo_envio, 0)
    else (
      select max(c.precio_total)
      from public.compras_cotizaciones c
      where c.requerimiento_id = p_requerimiento
        and c.precio_total is not null
        and coalesce(c.moneda, 'ARS') = 'ARS'
    )
  end
$$;

-- ── Trigger 1: cambió el costo del requerimiento ────────────
create or replace function public.compras_recalcular_monto_conocido()
returns trigger
language plpgsql
as $$
begin
  new.monto_conocido := public.compras_monto_que_se_sabe(
    new.id, new.costo_iva, new.costo_envio
  );
  return new;
end;
$$;

drop trigger if exists compras_monto_conocido_ri on public.compras_requerimientos;
-- `of costo_iva, costo_envio` y no a secas: sin eso, el UPDATE del trigger 2
-- —que sólo toca `monto_conocido`— volvería a disparar éste en cada vuelta.
create trigger compras_monto_conocido_ri
  before insert or update of costo_iva, costo_envio
  on public.compras_requerimientos
  for each row execute function public.compras_recalcular_monto_conocido();

-- ── Trigger 2: cambió una cotización ────────────────────────
create or replace function public.compras_recalcular_monto_por_cotizacion()
returns trigger
language plpgsql
as $$
declare
  v_ri uuid;
begin
  v_ri := coalesce(new.requerimiento_id, old.requerimiento_id);
  if v_ri is null then return null; end if;

  -- Este UPDATE no dispara `compras_marcar_editado_en_app`: esa función sólo
  -- marca cuando cambian estado, proveedor, costos o la comparativa, y acá no
  -- cambia ninguno. Importa: marcar `editado_en_app` de más haría que la
  -- importación dejara de pisar ese RI para siempre.
  update public.compras_requerimientos r
     set monto_conocido = public.compras_monto_que_se_sabe(r.id, r.costo_iva, r.costo_envio)
   where r.id = v_ri;

  return null;
end;
$$;

drop trigger if exists compras_monto_conocido_cot on public.compras_cotizaciones;
create trigger compras_monto_conocido_cot
  after insert or update or delete
  on public.compras_cotizaciones
  for each row execute function public.compras_recalcular_monto_por_cotizacion();

-- ── Y se llena lo que ya existe ─────────────────────────────
-- Sin esto los 2.159 requerimientos de hoy quedan en null hasta que alguien los
-- toque, y el filtro nuevo mostraría una lista vacía que parecería correcta.
update public.compras_requerimientos r
   set monto_conocido = public.compras_monto_que_se_sabe(r.id, r.costo_iva, r.costo_envio)
 where r.monto_conocido is distinct from
       public.compras_monto_que_se_sabe(r.id, r.costo_iva, r.costo_envio);
