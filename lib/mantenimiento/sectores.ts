/**
 * Los sectores que le importan a Mantenimiento.
 *
 * `sectores` guarda dos cosas distintas con el mismo nombre: **dónde trabaja
 * una persona** —"Administración", "Tesorería", "Compras y Pañol"— y **dónde
 * está una máquina** —"Calcinación", "Filler 2", "Compresores"—. Los primeros
 * los usan RRHH y Remises; los segundos vienen del libro BD Equipos y son los
 * únicos que este módulo tiene que mostrar.
 *
 * Está acá y no repetido en cada pantalla porque el filtro se olvida: se puso
 * en cinco lugares y faltó en el sexto, y el tablero terminó mostrando
 * "Tesorería" al lado de "Trituración 1".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Lo mínimo para un desplegable. */
export const CAMPOS_SECTOR = "id, nombre, codigo, empresas(nombre)";

/**
 * Los sectores de planta, ordenados por su código.
 *
 * El código —PO-A1, PY-B1, AMB-C1— los ordena por planta y por proceso, que es
 * el orden en que alguien los recorre; alfabéticamente quedarían mezcladas las
 * dos empresas.
 *
 * Devuelve el arreglo ya resuelto y no el `builder`: con un `select()` armado
 * en una variable, Supabase pierde la inferencia de tipos y todo lo que sale
 * queda como error de string.
 */
export async function sectoresDePlanta<T = SectorDePlanta>(
  supabase: SupabaseClient,
  campos: string = CAMPOS_SECTOR
): Promise<T[]> {
  const { data } = await supabase
    .from("sectores")
    .select(campos)
    .eq("es_de_planta", true)
    .order("codigo");

  return (data ?? []) as T[];
}

export interface SectorDePlanta {
  id: string;
  nombre: string;
  codigo: string | null;
  empresas?: { nombre: string } | { nombre: string }[] | null;
}

/**
 * El nombre de la empresa de un sector, venga el embed como objeto o arreglo.
 *
 * PostgREST devuelve una cosa o la otra según cómo esté declarada la relación,
 * y las dos formas llegan a las pantallas.
 */
export function empresaDelSector(embed: unknown): string | null {
  const uno = Array.isArray(embed) ? embed[0] : embed;
  return (uno as { nombre?: string } | null)?.nombre ?? null;
}
