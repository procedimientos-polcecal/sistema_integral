import type { Modulo, Rol, UsuarioModulo } from "./types";

// Orden canónico en que se muestran los módulos en la navegación.
export const MODULOS_ORDEN: Modulo[] = ["rrhh", "mantenimiento", "remises", "compras", "inventario", "produccion", "despacho"];

/**
 * Devuelve los módulos que un usuario puede ver, en orden canónico.
 * admin_sistema ve todo; el resto ve solo lo que tenga concedido en usuario_modulos.
 */
export function modulosVisibles(rol: Rol, grants: UsuarioModulo[]): Modulo[] {
  if (rol === "admin_sistema") return [...MODULOS_ORDEN];
  const concedidos = new Set(grants.map((g) => g.modulo));
  return MODULOS_ORDEN.filter((m) => concedidos.has(m));
}

/**
 * Nivel de acceso del usuario dentro de un módulo puntual.
 * admin_sistema siempre tiene nivel "admin"; el resto usa su grant en
 * usuario_modulos (o null si no tiene acceso a ese módulo).
 */
export function nivelEnModulo(
  rol: Rol,
  grants: UsuarioModulo[],
  modulo: Modulo
): UsuarioModulo["nivel"] | null {
  if (rol === "admin_sistema") return "admin";
  const grant = grants.find((g) => g.modulo === modulo);
  return grant ? grant.nivel : null;
}

/**
 * Quién administra el SdG mismo: la pestaña **Administración** —usuarios y sus
 * permisos, empresas, sectores— y las tres rutas de Odoo que se gatean con la
 * misma llave.
 *
 * **Sólo `admin_sistema`.** Hasta el 10/09/2026 la regla era
 * `admin_sistema || admin`, escrita cuatro veces: el Sidebar, las dos
 * pantallas de `/administracion` y `es_admin_check` de
 * `lib/core/route-utils.ts`. Con eso, el único usuario con rol `admin` —una
 * cuenta de soporte externa que entró por Mantenimiento— podía crear usuarios
 * y concederse a sí mismo cualquier módulo. Un permiso que se puede ampliar
 * solo no es un permiso, y el resto del sistema ya no le daba nada por rol:
 * `modulosVisibles` y `nivelEnModulo` (arriba) lo tratan como a un encargado
 * desde que se escribieron.
 *
 * Así que `admin` queda como un rol sin poder propio: lo que puede hacer sale
 * de sus grants en `usuario_modulos`. Espejo de `es_admin_sistema()` en la
 * base.
 *
 * Vive acá y no en cada pantalla porque cuatro copias de una regla de permisos
 * son tres de más: la que se olvida de cambiar es la que queda abierta.
 */
export function esAdminDelNucleo(rol: Rol | null | undefined): boolean {
  return rol === "admin_sistema";
}
