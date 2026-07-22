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
