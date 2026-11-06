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
 * El orden en que se recorre la planta.
 *
 * Es el mismo de la lista del formulario de OT, que es como la nombra quien
 * trabaja ahí: de la cantera al taller, siguiendo el material.
 *
 * **Ordenar por `codigo` no alcanzaba, y no por poco.** Los tres filler y la
 * planta de 0-2 mm son PY-A1, PY-B1, PY-D1 y PY-C1: el filler 3 va antes que
 * la de 0-2 mm aunque su código sea mayor. Y los tres sectores sin código
 * —Cantera, Servicios auxiliares y Taller— caían todos al final, con Cantera
 * última cuando es la primera de la lista y la primera del proceso.
 *
 * La clave es el **código**, no el nombre, porque el código es lo estable: los
 * nombres se renombraron enteros el 19/10/2026 para que coincidieran con la
 * planilla, y un orden atado a ellos se habría desarmado solo. Los tres que no
 * tienen código van por nombre, que es lo único que tienen, y eso es
 * exactamente lo frágil que queda — está fijado con un test.
 *
 * Un sector que no esté acá va al final, ordenado por su clave. Al final y no
 * en el medio a propósito: aparecer último se ve, y colarse en el medio no.
 */
const ORDEN_DE_PLANTA = [
  "CANTERA",
  "PO-A1", "PO-A2", "PO-A3",   // trituración 1, 2 y 3
  "PO-B1",                     // calcinación
  "PO-C1",                     // hidratación
  "PO-D1",                     // molienda de cal
  // Despacho cal se unió a la molienda el 21/10/2026 (migración
  // `20261021085411`), así que esta entrada no corresponde a ningún sector.
  // Se deja igual: el libro BD Equipos sigue diciendo PO-D2 y su importación
  // recrea los sectores por código, así que si vuelve conviene que aparezca
  // acá y no al final.
  "PO-D2",
  "PY-A1", "PY-B1", "PY-D1",   // filler 1, 2 y 3
  "PY-C1",                     // planta 0-2 mm
  "AMB-C1",                    // compresores
  "AMB-EM",                    // equipos móviles
  "SERVICIOS AUXILIARES",
  "TALLER",
] as const;

/** Con qué se lo busca en el orden: el código si lo tiene, el nombre si no. */
export function claveDeOrden(s: { nombre: string; codigo?: string | null }): string {
  return (s.codigo ?? s.nombre ?? "").trim().toUpperCase();
}

/**
 * Los sectores de planta, en el orden en que se recorre la planta.
 *
 * No muta lo que recibe: devuelve una copia ordenada.
 */
export function enOrdenDePlanta<T extends { nombre: string; codigo?: string | null }>(
  sectores: readonly T[]
): T[] {
  const lugar = (s: T) => {
    const i = (ORDEN_DE_PLANTA as readonly string[]).indexOf(claveDeOrden(s));
    return i === -1 ? ORDEN_DE_PLANTA.length : i;
  };
  return [...sectores].sort((a, b) => {
    const d = lugar(a) - lugar(b);
    // Los desconocidos comparten el último lugar: entre ellos, por su clave,
    // para que dos corridas devuelvan siempre lo mismo.
    return d !== 0 ? d : claveDeOrden(a).localeCompare(claveDeOrden(b));
  });
}

/**
 * Los sectores de planta, en el orden en que se recorre la planta.
 *
 * El orden lo pone `enOrdenDePlanta()` y no la base: lo que se quiere no se
 * puede escribir como un `order by`. Se pide igual ordenado por código para
 * que la consulta sea determinista antes de ordenarla.
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

  // El doble casteo es por el `select` dinámico: con los campos en una
  // variable Supabase tipa la respuesta como `GenericStringError[]`, que es la
  // misma regla de CLAUDE.md asomando. El tipo real lo declara quien llama.
  const filas = (data ?? []) as unknown as (T & { nombre: string; codigo?: string | null })[];
  return enOrdenDePlanta(filas) as T[];
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
