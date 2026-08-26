import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import type { PermisosCompras } from "./auth";

const SIN_ACCESO: PermisosCompras = {
  nivel: null,
  puedeEditar: false,
  puedeAprobar: false,
  tieneAcceso: false,
};

/**
 * Los permisos de Compras de quien está mirando, una sola vez por request.
 *
 * El layout del módulo los calculaba, y después cada página los volvía a
 * calcular con las mismas dos consultas. Sumado al `getUser()` repetido, una
 * navegación a Requerimientos hacía diez viajes a Supabase de los cuales cuatro
 * eran la misma pregunta.
 *
 * Además pide las tres cosas en paralelo. El rol, los grants y la lista de
 * aprobadores no dependen entre sí, y en serie eran tres esperas donde alcanza
 * con una.
 *
 * `cache()` memoiza dentro del render, no entre requests: no hay riesgo de
 * mostrarle a alguien los permisos de otro.
 *
 * Las rutas de API siguen usando `permisosComprasDe(supabase, userId)`, que
 * recibe el cliente y el usuario explícitos. Ahí no hay un render que
 * compartir, y el usuario puede no ser el de la sesión.
 */
export const permisosComprasActuales = cache(async (): Promise<PermisosCompras> => {
  const user = await usuarioActual();
  if (!user) return SIN_ACCESO;

  const supabase = await createClient();
  const [{ data: usuario }, { data: grants }, { data: enLaLista }] = await Promise.all([
    supabase.from("usuarios").select("rol").eq("id", user.id).single(),
    supabase.from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", user.id),
    // Aprobar es más estricto que el resto: exige estar en la lista, no un
    // nivel. Ser admin del sistema no alcanza.
    supabase.from("compras_aprobadores").select("usuario_id").eq("usuario_id", user.id).maybeSingle(),
  ]);

  if (!usuario) return SIN_ACCESO;

  const nivel = nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "compras");

  return {
    nivel,
    puedeEditar: nivel === "edicion" || nivel === "admin",
    puedeAprobar: Boolean(enLaLista),
    tieneAcceso: nivel !== null,
  };
});
