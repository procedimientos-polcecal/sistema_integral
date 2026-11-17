-- ============================================================
-- SdG — Horas a realizar por sector
--
-- EL PROBLEMA. El porcentaje de ausentismo —el titular del reporte, el número
-- por el que RRHH llena la planilla NOVEDADES— es horas perdidas sobre horas a
-- realizar, por sector. Las perdidas salen de las ausencias que ya están en el
-- sistema. Las horas a realizar no están en ningún lado: en la planilla son una
-- cuenta para los sectores de planta y un número escrito a mano para los de
-- oficina. Esta migración crea la tabla donde vive ese número. El diseño
-- completo, con lo que se midió, está en
-- docs/superpowers/specs/2026-10-29-disponibilidad-y-ausentismo-design.md.
--
-- POR QUÉ ES UN CATÁLOGO Y NO UNA FÓRMULA. En la planilla las horas a realizar
-- son `(días hábiles + sábados) × 8` para planta, que en un mes de 26 días da
-- 208, y un **200 escrito a mano** para los sectores de oficina. Parecen dos
-- versiones de lo mismo y no lo son:
--
--   - el 208 sale de una cuenta: se puede calcular con el calendario y
--     reproduce lo que la planilla hace;
--   - el 200 no sale de ninguna cuenta: es una decisión de RRHH, escrita a mano
--     en la planilla. Calcularlo "solo" reproduciría el 208 pero nunca el 200,
--     y el día que RRHH lo cambie habría que tocar código para algo que es una
--     decisión de negocio.
--
-- Entonces se guarda el valor tal cual, por sector, y se siembra con lo que la
-- planilla tiene hoy. Quien lo cambia es RRHH, desde la pantalla, sin pasar por
-- un despliegue.
--
-- ES POR EMPLEADO, NO POR SECTOR. `horas_por_empleado` es cuántas horas debería
-- trabajar UNA persona del sector en el mes. Las horas a realizar del sector
-- salen de multiplicarlo por el personal del sector, que ya está en el sistema.
-- Guardar el total del sector obligaría a editarlo cada vez que entra o se va
-- alguien.
--
-- LLEVA VIGENCIA (`desde` / `hasta`), Y NO ES OPCIONAL. Si RRHH decide hoy que
-- Administración pasa de 200 a 192, y el valor fuera una sola columna mutable,
-- el porcentaje de marzo se recalcularía con el 192 y cambiaría sin que nadie
-- tocara marzo: un mes ya reportado, que alguien ya leyó y comparó, dejaría de
-- ser el que se leyó. Es el mismo razonamiento que el padrón del taller
-- (20261023105615) y que la tarifa hora (043): un mes pasado se calcula con lo
-- que regía en ese mes. `hasta` null quiere decir que sigue vigente, e inclusive
-- cuando está: es el último día que rige.
--
-- Cambiar el valor de un sector es entonces cerrar la fila vigente con un
-- `hasta` y abrir otra con `desde` el día siguiente —no pisar la fila—. No hay
-- restricción que lo imponga: un `exclude using gist` sobre rangos de fechas
-- pide la extensión `btree_gist`, y para un catálogo de una veintena de filas
-- que edita una persona la validación vive en la ruta que escribe, donde puede
-- decir en castellano qué se superpone.
--
-- Lo que sí se impone en la base es que el rango no esté invertido,
-- `check (hasta is null or hasta >= desde)`: es una línea, no pide extensión,
-- y un rango invertido no falla en ningún lado, simplemente no coincide con ningún mes, y
-- el sector se queda sin divisor en el reporte para el que existe esta tabla.
--
-- El FK a `sectores` no lleva `on delete` a propósito: borrar un sector que
-- tiene filas acá se rechaza, que es lo que se quiere, porque `sectores` es un
-- catálogo del núcleo que los módulos leen y no borran.
--
-- LA LECTURA ES ABIERTA, SÓLO LA ESCRITURA SE CIERRA. Es lo contrario de lo que
-- hace el resto de RRHH —sus tablas se leen con `tiene_acceso_rrhh()` porque
-- guardan sueldos y motivos de ausencia— y es a propósito: el porcentaje de
-- ausentismo lo ve todo el mundo, y el catálogo que lo calcula tiene que poder
-- leerse con el mismo permiso. Un número de horas por sector no es un dato
-- sensible; un reporte que se muestra a todos pero no puede leer su propio
-- divisor, sí sería un error.
--
-- La escritura va con `puede_editar_rrhh()` y no con `tiene_acceso_rrhh()`.
-- Esta última acepta cualquier nivel del módulo, incluido `lectura`: usarla
-- para escribir le daría a quien sólo puede mirar la posibilidad de cambiar el
-- divisor del titular. `puede_editar_rrhh()` pide `edicion` o `admin`.
--
-- LAS POLICIES VAN ENVUELTAS: `using ((select puede_editar_rrhh()))` y no
-- `using (puede_editar_rrhh())`. Postgres evalúa el USING una vez por fila aunque
-- la función sea STABLE; el subselect lo convierte en un InitPlan que se evalúa
-- una sola vez. Escribirla pelada no rompe nada y no avisa: la tabla simplemente
-- pasa a costar proporcional a sus filas. Ver 20261014090512.
--
-- QUÉ NO HACE. No siembra nada: los `sector_id` son uuid de producción y no se
-- pueden escribir de memoria en un archivo; el sembrado es un paso aparte, que
-- los resuelve por nombre contra la base. Tampoco toca `sectores`, que es del
-- núcleo y lo comparten los seis módulos: la tabla lo lee, no lo rehace. Y no
-- hay enum nuevo, así que no gasta la regla del 55P04. Se puede correr entera y
-- correr de nuevo: todo es `if not exists` y `drop policy if exists`.
-- ============================================================

create table if not exists rrhh_horas_a_realizar (
  id                 uuid primary key default gen_random_uuid(),
  sector_id          uuid not null references sectores(id),
  horas_por_empleado numeric not null check (horas_por_empleado > 0),
  desde              date not null,
  hasta              date,
  created_at         timestamptz not null default now(),
  check (hasta is null or hasta >= desde)
);

comment on table rrhh_horas_a_realizar is
  'Cuántas horas debería trabajar una persona de cada sector en el mes, con vigencia. Es un catálogo y no una fórmula: el 208 de planta sale de una cuenta, pero el 200 de oficina es una decisión de RRHH. Lleva vigencia para que cambiarlo hoy no reescriba los meses ya reportados.';
comment on column rrhh_horas_a_realizar.horas_por_empleado is
  'Horas del mes para UNA persona del sector. Las del sector entero salen de multiplicarlas por su personal.';
comment on column rrhh_horas_a_realizar.desde is
  'Primer día que rige este valor, inclusive.';
comment on column rrhh_horas_a_realizar.hasta is
  'Último día que rige, inclusive. NULL: sigue vigente. Cambiar el valor es cerrar esta fila y abrir otra, no pisarla.';

-- ── RLS ──────────────────────────────────────────────────────
-- Lectura para cualquier autenticado; escritura sólo con edición de RRHH. Las
-- funciones van envueltas en un subselect (ver el encabezado).

alter table rrhh_horas_a_realizar enable row level security;

drop policy if exists rrhh_horas_a_realizar_select on rrhh_horas_a_realizar;
create policy rrhh_horas_a_realizar_select on rrhh_horas_a_realizar
  for select to authenticated
  using (true);

drop policy if exists rrhh_horas_a_realizar_insert on rrhh_horas_a_realizar;
create policy rrhh_horas_a_realizar_insert on rrhh_horas_a_realizar
  for insert to authenticated
  with check ((select puede_editar_rrhh()));

drop policy if exists rrhh_horas_a_realizar_update on rrhh_horas_a_realizar;
create policy rrhh_horas_a_realizar_update on rrhh_horas_a_realizar
  for update to authenticated
  using ((select puede_editar_rrhh()))
  with check ((select puede_editar_rrhh()));

drop policy if exists rrhh_horas_a_realizar_delete on rrhh_horas_a_realizar;
create policy rrhh_horas_a_realizar_delete on rrhh_horas_a_realizar
  for delete to authenticated
  using ((select puede_editar_rrhh()));
