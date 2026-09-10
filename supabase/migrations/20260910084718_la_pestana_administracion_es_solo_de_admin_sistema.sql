-- ============================================================
-- SdG — La pestana Administracion es solo de admin_sistema
--
-- POR QUÉ. La pestaña Administración —usuarios y sus permisos, empresas,
-- sectores— estaba abierta a `rol in ('admin_sistema', 'admin')`, tanto en la
-- app como acá, vía `es_admin()` (002).
--
-- El único usuario con `rol = 'admin'` hoy es
-- `soporte.mantenimiento@polcecal.com`: una cuenta de soporte que entró por
-- Mantenimiento y tiene sus grants explícitos en `usuario_modulos` —admin en
-- mantenimiento, lectura en remises/inventario/produccion, nada en rrhh ni
-- compras—. Desde esa pantalla podía crear usuarios y **concederse a sí mismo
-- cualquier módulo**, incluidos RRHH (nóminas) y Compras. Un permiso que se
-- puede ampliar solo no es un permiso: lo que ese usuario tiene concedido deja
-- de significar nada si el mismo usuario puede editar la tabla de concesiones.
--
-- La 20260908083338 ya sacó a `admin` de las funciones **de módulo**, con el
-- argumento de que `admin` administra el núcleo y no cada módulo. Esta va un
-- paso más y le saca también el núcleo: `admin` queda como un rol sin poder
-- propio, y lo que puede hacer sale de `usuario_modulos`, igual que un
-- encargado. Es lo que `modulosVisibles()` y `nivelEnModulo()`
-- (lib/core/access.ts) ya hacían desde que se escribieron.
--
-- QUÉ CAMBIA. Las seis policies de **escritura** del núcleo pasan de
-- `es_admin()` a `es_admin_sistema()` (que sólo mira `admin_sistema`, creada en
-- la 20260908083338): empresas, sectores, usuarios, usuario_modulos, empleados
-- y usuario_areas_compras. Son exactamente las tablas que escribe esa pantalla.
--
-- QUÉ NO CAMBIA, Y ES A PROPÓSITO.
--
-- 1. Las dos **lecturas** del núcleo —`usuarios_select_self` y `um_select`—
--    siguen diciendo `... or es_admin()`. Decidido el 10/09/2026 después de
--    medirlo: cerrarlas rompe la lista de "a quién asignar" de Mantenimiento,
--    que `usuariosConAccesoMantenimiento()` (lib/mantenimiento/auth.ts) arma
--    con el cliente del usuario y por lo tanto contra RLS. Un `admin` ya no
--    tiene la pantalla, pero con su propio token puede seguir leyendo la lista
--    de usuarios por la API: queda dicho, no descubierto. Ver el pendiente en
--    docs/NUCLEO-COMPARTIDO.md.
--
--    (De paso quedó a la vista un bug anterior y aparte: para un encargado con
--    grant de admin en mantenimiento esa lista **hoy ya viene vacía**, porque
--    no pasa `es_admin()` y sólo se ve a sí mismo en `usuarios`. Nadie lo
--    reportó porque los que asignan son admin_sistema.)
--
-- 2. `es_admin()` sigue existiendo y sigue significando `admin_sistema o
--    admin`. La usan tres policies que no son esta pantalla y que no se tocan
--    acá: `proveedores_odoo` (20260903091434), `compras_odoo_ordenes`
--    (20260904084145) y `compras_req_delete` (018, borrar un requerimiento).
--    Para código nuevo va `es_admin_sistema()`.
--
-- 3. Las policies que los módulos suman sobre estas mismas tablas quedan
--    intactas: `empresas_update_mantenimiento` (004), `sectores_write_rrhh` y
--    `empleados_write_rrhh` (009). Las policies se suman con OR, así que un
--    admin de RRHH sigue escribiendo empleados y sectores por la suya — esto
--    sólo cierra la puerta que abría el rol.
--
-- ESPEJO EN LA APP. `esAdminDelNucleo()` en lib/core/access.ts, que usan el
-- Sidebar (la pestaña), las dos pantallas de /administracion y `es_admin_check`
-- de lib/core/route-utils.ts. Ese cambio ya está en el código: hasta que esta
-- migración corra, la app es **más estricta** que RLS, que es el lado seguro.
-- Seis de las nueve rutas de /api/administracion escriben con
-- `createAdminClient()`, que no pasa por RLS, así que para ellas el guard de la
-- app no es una segunda línea de defensa sino la única — y por eso el orden
-- (primero el código, después esto) no deja ninguna ventana abierta.
-- ============================================================

-- ── empresas y sectores (002) ────────────────────────────────
drop policy if exists empresas_write on empresas;
create policy empresas_write on empresas
  for all to authenticated
  using (es_admin_sistema())
  with check (es_admin_sistema());

drop policy if exists sectores_write on sectores;
create policy sectores_write on sectores
  for all to authenticated
  using (es_admin_sistema())
  with check (es_admin_sistema());

-- ── usuarios y sus permisos (002) ────────────────────────────
-- Las dos que abren la puerta de verdad: quien escribe `usuarios` crea cuentas,
-- y quien escribe `usuario_modulos` reparte el acceso a los siete módulos.
drop policy if exists usuarios_write_admin on usuarios;
create policy usuarios_write_admin on usuarios
  for all to authenticated
  using (es_admin_sistema())
  with check (es_admin_sistema());

drop policy if exists um_write on usuario_modulos;
create policy um_write on usuario_modulos
  for all to authenticated
  using (es_admin_sistema())
  with check (es_admin_sistema());

-- ── empleados (002) ──────────────────────────────────────────
-- La policy del núcleo. RRHH escribe empleados por `empleados_write_rrhh`
-- (009), que no se toca.
drop policy if exists empleados_write on empleados;
create policy empleados_write on empleados
  for all to authenticated
  using (es_admin_sistema())
  with check (es_admin_sistema());

-- ── de qué área de Compras es cada uno (20260904103615) ──────
-- Se carga en la misma pantalla que los permisos de módulo, así que se cierra
-- con ella.
drop policy if exists usuario_areas_compras_write on usuario_areas_compras;
create policy usuario_areas_compras_write on usuario_areas_compras
  for all to authenticated
  using (es_admin_sistema())
  with check (es_admin_sistema());

notify pgrst, 'reload schema';
