-- ============================================================
-- SdG — RRHH: el valor hora se muda a la tabla del módulo
--
-- ESTA ES LA PRIMERA DE DOS. Esta agrega y copia; la que borra las columnas
-- viejas de `empleados` es `20260922101406_empleados_se_van_el_sueldo_y_el_domicilio.sql`.
-- El orden importa y no es decorativo:
--
--   1. correr ÉSTA
--   2. desplegar el código que lee del lugar nuevo
--   3. correr la OTRA
--
-- Entre 1 y 3 las dos copias conviven y la app anda con cualquiera de los dos
-- despliegues. Si se hiciera todo en un archivo, entre el `alter` y el deploy
-- habría una ventana con el código viejo leyendo una columna que ya no existe
-- —y lo que se rompe es la liquidación de sueldos, que es lo último que
-- conviene romper para ganar un archivo.
--
-- ── POR QUÉ ─────────────────────────────────────────────────
--
-- `empleados.valor_hora_normal` lo puede leer **cualquier usuario autenticado**,
-- tenga o no acceso a RRHH. La policy es `empleados_select … using (true)` y
-- viene así desde la 002. Medido contra producción el 22/09/2026: las 70 filas
-- tienen el valor hora cargado. O sea que un usuario de Compras, de Cantera o
-- de Calidad puede leer el sueldo por hora de toda la nómina con una sola
-- consulta.
--
-- ── POR QUÉ NO SE ARREGLA CON UNA POLICY ────────────────────
--
-- Porque **RLS es por fila y esto es un problema de columna**. Se intentó el
-- camino corto —cerrar `empleados` a `tiene_acceso_rrhh() or
-- tiene_acceso_remises()`, como hizo la del 16/09 con Mantenimiento— y no
-- cierra, por dos razones que aparecieron midiendo:
--
--   * `app/api/remises/mi-remis/route.ts` embebe `empleados(nombre, apellido)`
--     para mostrarle a un empleado **quién más va en su remis**. Ese empleado
--     no tiene ningún módulo: entra sólo para eso. Cerrar `empleados` por
--     módulo lo deja con la pantalla en blanco.
--   * Y si en cambio se lo deja pasar con una policy tipo la de `choferes` de
--     la 013 —"lo ve quien comparte hoja de ruta"—, lo que se abre es la
--     **fila entera**: el compañero de viaje pasa a poder leer el valor hora.
--     Una policy de fila no sabe tapar una columna.
--
-- Así que la columna se va de `empleados` y se muda a `rrhh_empleados_datos`,
-- que ya existe, ya tiene fila para los 70 empleados y **ya está cerrada** con
-- `tiene_acceso_rrhh()` desde la 009. `empleados` queda como lo que el README
-- de esta carpeta dice que es —un catálogo del núcleo que comparten cinco
-- módulos— y deja de llevar encima un dato que no es de catálogo.
--
-- `fecha_ingreso`, `horas_teoricas_diarias` y `modalidad_pago` se quedan donde
-- están, a propósito: son antigüedad, ocho horas y jornal/mensual. Se leen
-- desde fuera de RRHH y no son un sueldo.
-- ============================================================

-- La columna nueva. `default 0` y no null para que las filas que ya existen no
-- queden en null y obliguen a un `coalesce` en cada lectura: el original en
-- `empleados` también era `not null default 0`.
alter table rrhh_empleados_datos
  add column if not exists valor_hora_normal numeric(12,2) not null default 0;

-- Fila para todo empleado que no la tenga. Hoy los 70 la tienen, pero el alta
-- de empleado sólo la creaba **si venía sindicato**
-- (`app/api/rrhh/empleados/route.ts`), así que la próxima alta sin sindicato
-- se quedaba sin fila y sin sueldo. El código de este mismo cambio pasa a
-- crearla siempre; esto cubre a los que entraron antes.
insert into rrhh_empleados_datos (empleado_id)
select e.id
  from empleados e
 where not exists (select 1 from rrhh_empleados_datos d where d.empleado_id = e.id);

-- La copia. Va adentro de un bloque que primero mira si la columna vieja sigue
-- estando, porque esta migración se va a correr dos veces —acá las aplica una
-- persona a mano y no hay tabla de control (trampa #4 del README)—. Sin el
-- guarda, una segunda corrida después de la migración que borra la columna
-- falla con `42703` y **revierte el archivo entero**, que desde afuera se ve
-- igual que si nunca se hubiera ejecutado.
--
-- El `where d.valor_hora_normal = 0` es lo que la hace repetible sin pisar
-- nada: si entre las dos corridas alguien ya editó el valor en el lugar nuevo,
-- no se lo sobreescribe con el viejo.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'empleados'
       and column_name  = 'valor_hora_normal'
  ) then
    execute $sql$
      update rrhh_empleados_datos d
         set valor_hora_normal = e.valor_hora_normal
        from empleados e
       where e.id = d.empleado_id
         and d.valor_hora_normal = 0
    $sql$;
  end if;
end $$;

-- Para mirar a ojo antes de seguir: las dos columnas tienen que coincidir en
-- las 70 filas.
--
--   select count(*) filter (where d.valor_hora_normal = e.valor_hora_normal) as iguales,
--          count(*) as total
--     from rrhh_empleados_datos d join empleados e on e.id = d.empleado_id;
