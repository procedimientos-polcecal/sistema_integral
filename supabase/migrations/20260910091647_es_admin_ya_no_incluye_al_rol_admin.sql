-- ============================================================
-- SdG — es_admin() ya no incluye al rol admin
--
-- POR QUÉ. La 20260910084718 le sacó a `admin` la pestaña Administración, que
-- era lo único que tenía por rol. Después de eso `admin` y `encargado` valían
-- exactamente lo mismo —ni una policy ni una línea de código los
-- distinguía— así que se unificaron en `encargado`: el 10/09/2026 el único
-- usuario que lo tenía (`soporte.mantenimiento@polcecal.com`) pasó a
-- `encargado`, con sus cuatro grants de `usuario_modulos` intactos, y el rol
-- salió del tipo `Rol`, del desplegable de la pantalla de usuarios y de las dos
-- rutas que validan lo que llega. **No queda ningún usuario con `rol =
-- 'admin'`** (medido: 3 admin_sistema, 5 encargado, 1 operario).
--
-- Falta esta mitad. `es_admin()` (002) sigue diciendo
-- `rol in ('admin_sistema', 'admin')`, así que la base todavía cree que el rol
-- existe y significa algo. Hoy no le da nada a nadie —no hay quien lo tenga—,
-- pero deja armada una trampa: el valor sigue en el enum `user_role`, porque
-- **Postgres no deja quitar un valor de un enum**, y un `update usuarios set
-- rol = 'admin'` escrito a mano en el editor SQL le devolvería en silencio las
-- tres policies de abajo. Un rol que no se puede asignar desde ninguna pantalla
-- pero sí concede permisos si alguien lo escribe es peor que uno que no existe:
-- nadie lo va a estar mirando.
--
-- QUÉ CAMBIA, Y POR QUÉ ES UN NO-OP HOY. `es_admin()` pasa a ser lo mismo que
-- `es_admin_sistema()`. La usan tres policies, y ninguna cambia de
-- comportamiento porque el conjunto de usuarios que hoy pasan por una y por la
-- otra es el mismo:
--   - `proveedores_odoo_write` (20260903091434)
--   - `compras_odoo_ordenes_write` (20260904084145)
--   - `compras_req_delete` (018) — borrar un requerimiento. Su gemela en la app
--     (`app/api/compras/requerimientos/[id]/route.ts`) también decía
--     `admin_sistema || admin` y quedó en `admin_sistema` en el mismo commit.
--
-- POR QUÉ NO SE BORRA `es_admin()`. Porque las tres policies dependen de ella:
-- un `drop function` falla, y reescribir las tres para renombrar una función
-- que ya dice lo correcto es cambio sin beneficio. Queda como sinónimo, con el
-- comentario diciéndolo, y para código nuevo va `es_admin_sistema()`, que es la
-- que se explica sola.
--
-- Y el enum: `admin` queda ahí, inerte. Sacarlo exige recrear el tipo
-- `user_role` con las cinco tablas que lo usan, y el valor inerte no molesta a
-- nadie una vez que ninguna función lo nombra.
-- ============================================================

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select rol = 'admin_sistema' from usuarios where id = auth.uid()),
    false
  )
$$;

comment on function public.es_admin() is
  'Sólo admin_sistema, igual que es_admin_sistema(). Hasta el 10/09/2026 decía '
  'rol in (''admin_sistema'', ''admin''); el rol admin se unificó con encargado '
  'ese día y dejó de existir para el sistema, pero el valor sigue en el enum '
  'user_role porque Postgres no deja quitarlo. Se conserva el nombre porque de '
  'ella dependen proveedores_odoo_write, compras_odoo_ordenes_write y '
  'compras_req_delete; para código nuevo usar es_admin_sistema().';

notify pgrst, 'reload schema';
