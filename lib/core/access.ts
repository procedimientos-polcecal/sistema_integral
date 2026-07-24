import type { Modulo, Rol, UsuarioModulo } from "./types";

// Orden canónico en que se muestran los módulos en la navegación.
export const MODULOS_ORDEN: Modulo[] = ["rrhh", "mantenimiento", "remises"];

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
