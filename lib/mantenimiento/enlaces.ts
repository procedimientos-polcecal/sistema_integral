/**
 * Enlazar lo que viene de una planilla con lo que ya existe en el sistema.
 *
 * Las planillas escriben el equipo y el sector como texto libre. Para que un
 * aviso o una orden de servicio sirvan de algo hay que atarlos al equipo de
 * verdad: es lo que permite después ver el historial de una máquina.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { indiceDeProveedores, buscarProveedor } from "@/lib/core/proveedores";
import { buscarCodigo } from "@/lib/mantenimiento/inventario";

export interface Enlaces {
  /** Equipo por código, en mayúsculas. */
  porCodigo: Map<string, { id: string; sector_id: string | null }>;
  /** Sector por nombre, en minúsculas y sin espacios de más. */
  porSector: Map<string, string>;
  /** Proveedor por nombre normalizado. */
  porProveedor: Map<string, string>;
  /** Los códigos de equipo que existen, para reconocerlos en un texto libre. */
  codigos: string[];
}

/** Los equipos y sectores cargados, listos para buscar. */
export async function cargarEnlaces(admin: SupabaseClient): Promise<Enlaces> {
  const equipos = await traerTodo<{ id: string; code: string | null; sector_id: string | null }>(
    (desde, hasta) => admin.from("equipos").select("id, code, sector_id").range(desde, hasta)
  );
  const sectores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    admin.from("sectores").select("id, nombre").range(desde, hasta)
  );
  const proveedores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    admin.from("proveedores").select("id, nombre").range(desde, hasta)
  );

  return {
    porCodigo: new Map(
      equipos.filter((e) => e.code).map((e) => [e.code!.toUpperCase(), { id: e.id, sector_id: e.sector_id }])
    ),
    porSector: new Map(sectores.map((s) => [s.nombre.toLowerCase().trim(), s.id])),
    porProveedor: indiceDeProveedores(proveedores),
    codigos: equipos.map((e) => e.code).filter((c): c is string => Boolean(c)),
  };
}

/**
 * El proveedor que se llama así, si lo conocemos.
 *
 * No inventa: un nombre que no está en la lista queda sin enlazar y el texto
 * crudo se conserva igual. Crear proveedores desde una sincronización llenaría
 * la lista que Compras usa todos los días con cada variante de escritura que
 * alguien tipeó en una planilla.
 */
export function proveedorDe(
  enlaces: Enlaces,
  nombre: string | null | undefined
): string | null {
  return buscarProveedor(enlaces.porProveedor, nombre);
}

/**
 * A qué equipo y sector corresponde una fila.
 *
 * El sector sale del equipo cuando se lo pudo identificar; el nombre escrito a
 * mano es el respaldo. Al revés daría el sector que alguien tipeó por sobre el
 * sector donde la máquina está de verdad.
 */
export function resolver(
  enlaces: Enlaces,
  fila: { equipo_code: string | null; equipo_raw?: string | null; sector_raw?: string | null }
): { equipment_id: string | null; sector_id: string | null } {
  let equipo = fila.equipo_code
    ? enlaces.porCodigo.get(fila.equipo_code.toUpperCase())
    : undefined;

  // El patrón no alcanza para los 21 equipos compartidos, que se llaman "C1" o
  // "EM2": ésos hay que buscarlos contra los códigos que existen de verdad.
  if (!equipo && fila.equipo_raw) {
    const code = buscarCodigo(fila.equipo_raw, enlaces.codigos);
    if (code) equipo = enlaces.porCodigo.get(code.toUpperCase());
  }

  return {
    equipment_id: equipo?.id ?? null,
    sector_id:
      equipo?.sector_id ??
      enlaces.porSector.get((fila.sector_raw ?? "").toLowerCase().trim()) ??
      null,
  };
}
