import type { Modulo, Rol, UsuarioModulo } from "./types";

// Orden canónico en que se muestran los módulos en la navegación.
export const MODULOS_ORDEN: Modulo[] = ["rrhh", "mantenimiento", "remises", "compras", "inventario", "produccion", "despacho", "facturacion", "cantera", "calidad", "taller_vial", "trituracion"];

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
 * Así que `admin` quedó como un rol sin poder propio: lo que podía hacer salía
 * de sus grants en `usuario_modulos`. Y como eso es exactamente lo que hace un
 * `encargado` —ni el código ni una policy los distinguían—, el mismo día se
 * unificaron los dos en `encargado` y `admin` dejó de existir para el sistema
 * (ver `Rol` en `./types.ts`). Espejo de `es_admin_sistema()` en la base.
 *
 * Vive acá y no en cada pantalla porque cuatro copias de una regla de permisos
 * son tres de más: la que se olvida de cambiar es la que queda abierta.
 */
export function esAdminDelNucleo(rol: Rol | null | undefined): boolean {
  return rol === "admin_sistema";
}

/**
 * Quién puede usar el asistente de IA.
 *
 * **No es un permiso de datos.** Lo que el asistente le muestra a cada uno sale
 * de RLS, igual que en las pantallas: la consulta la ejecuta la sesión del
 * usuario. Esto es un permiso de **gasto** — cada pregunta son dos o tres
 * llamadas a un modelo — y por eso arranca cerrado y se abre de a poco.
 *
 * `admin_sistema` pasa siempre, como en el resto del núcleo: es quien concede
 * el permiso, y obligarlo a concedérselo a sí mismo para poder probar no
 * protege de nada.
 *
 * Vive acá y no en la ruta por la misma razón que `esAdminDelNucleo`: cuatro
 * copias de una regla de permisos son tres de más.
 *
 * Recibe lo mínimo —un rol y la bandera— y no un `Usuario` entero a propósito:
 * quien pregunta suele venir de un `select` corto que no trae el resto de la
 * fila, y pedirle la interfaz completa lo obligaría a inventar los campos que
 * no usa. Mismo criterio que `esAdminDelNucleo`, que recibe un `Rol` pelado.
 */
export function puedeUsarAsistente(
  usuario: { rol: Rol; puede_usar_asistente?: boolean | null } | null | undefined
): boolean {
  if (!usuario) return false;
  if (usuario.rol === "admin_sistema") return true;
  return usuario.puede_usar_asistente === true;
}
