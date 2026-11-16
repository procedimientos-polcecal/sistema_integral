-- El correo de novedades que RR.HH. manda al cierre del día.
--
-- QUÉ GUARDA Y POR QUÉ NO VA EN config_liquidacion
--
-- `config_liquidacion` es la configuración del MOTOR DE CÁLCULO: la lee
-- `getConfigLiquidacion()` en cada recálculo y su PUT dispara
-- `recalcularVentanaEnSegundoPlano()`. Meter acá el texto de un correo haría
-- que cambiarle una coma al saludo recalcule las horas de todos los empleados
-- del período. Son dos cosas distintas, con dos públicos distintos y dos
-- frecuencias de cambio distintas, así que van en dos tablas.
--
-- Singleton con id = 1, mismo patrón que `config_liquidacion` (008) y que el
-- de Remises (012).
--
-- `destinatarios` es un arreglo de uuid **sin foreign key**, igual que el
-- `entidad_id` de `auditoria` y por el mismo motivo: un usuario borrado no
-- tiene que impedir que el correo salga para el resto. El id que queda colgado
-- simplemente no resuelve a ninguna dirección y se descarta en el envío
-- (`destinatariosDelCorreo` en lib/rrhh/novedadesDelDia.ts, con su test).
--
-- **Vacío NO quiere decir «a nadie»: quiere decir «a todos los encargados»**,
-- resuelto en el momento del envío. Es lo que se pidió, y hace que un
-- encargado nuevo empiece a recibirlo sin que nadie se acuerde de agregarlo.
-- La contracara, que la pantalla también dice: en cuanto alguien tilda a una
-- persona, la regla deja de correr y la lista es exactamente la que quedó.

create table if not exists public.rrhh_correo_novedades (
  id smallint primary key default 1 check (id = 1),
  -- Para apagarlo sin tener que borrar la configuración ni tocar vercel.json.
  activo boolean not null default true,
  destinatarios uuid[] not null default '{}',
  encabezado text not null default '',
  cierre text not null default '',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.usuarios(id)
);

insert into public.rrhh_correo_novedades (id, encabezado, cierre)
values (
  1,
  E'Buenas tardes:\n\nVan las novedades de personal cargadas hoy en el sistema.',
  E'Cualquier corrección, respondé este correo.\n\n-- \nGestión de Personas\nEste correo lo manda el Sistema de Gestión automáticamente al cierre del día. Si no hubo novedades, no se envía.'
)
on conflict (id) do nothing;

alter table public.rrhh_correo_novedades enable row level security;

-- Las funciones van envueltas en (select ...): sin eso Postgres evalúa el
-- USING una vez por fila. Acá la tabla tiene una sola fila y no se notaría,
-- pero la regla es la regla y una policy escrita mal es la que se copia.
drop policy if exists rrhh_correo_novedades_select on public.rrhh_correo_novedades;
create policy rrhh_correo_novedades_select on public.rrhh_correo_novedades
  for select to authenticated
  using ((select tiene_acceso_rrhh()));

drop policy if exists rrhh_correo_novedades_write on public.rrhh_correo_novedades;
create policy rrhh_correo_novedades_write on public.rrhh_correo_novedades
  for all to authenticated
  using ((select es_admin_rrhh()))
  with check ((select es_admin_rrhh()));
